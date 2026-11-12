import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  LIE_FOOL_POINTS, LIE_MAX_LEN, LIE_MAX_PLAYERS, LIE_PICK_MS, LIE_REVEAL_STEP_MS, LIE_REVEAL_TAIL_MS, LIE_ROUNDS, LIE_TRUTH_POINTS, LIE_WRITE_TIMES,
  lieNorm, tooClose,
  type LiePhase, type LiePublicRoom, type LieReveal, type LieSettings,
} from '../shared/lie.ts';
import { LIE_BANK, type LieQuestion } from './lie-bank.ts';

const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
const ALL_IN_DELAY_MS = 600;
/** Sempre pelo menos este número de alternativas (completa com "mentiras da casa"). */
const MIN_OPTIONS = 4;

interface Member {
  id: string;
  token: string;
  name: string;
  avatar: string;
  socketId: string | null;
  connected: boolean;
  role: 'player' | 'spectator';
  left: boolean;
  score: number;
  lie: string | null;
  pick: string | null;
  graceTimer?: NodeJS.Timeout;
}

interface Option {
  id: string;
  text: string;
  truth: boolean;
  authors: string[];
}

/** Tipo da resposta, para a "mentira da casa" combinar com a pergunta. */
function kindOf(answer: string) {
  if (/d/.test(answer) || /^(um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez)/i.test(answer)) return 'num';
  if (/^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(answer)) return 'name';
  return 'word';
}

function shuffle<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class LieRoom {
  readonly kind = 'lie';
  readonly code: string;
  hostId = '';
  settings: LieSettings = { rounds: 8, writeTime: 45, maxPlayers: 10 };
  phase: LiePhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private round = 0;
  private current: LieQuestion | null = null;
  private options: Option[] = [];
  private reveal: LieReveal[] | null = null;
  private gained: Record<string, number> | null = null;
  private endsAt: number | null = null;
  private ranking: LiePublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;
  private used = new Set<number>();

  constructor(code: string, private io: Server, private onEmpty: (room: LieRoom) => void) {
    this.code = code;
  }

  // ---------- membros ----------

  get players() {
    return this.members.filter((m) => m.role === 'player');
  }

  private activePlayers() {
    return this.players.filter((m) => !m.left);
  }

  find(id: string) {
    return this.members.find((m) => m.id === id);
  }

  findByToken(token: string) {
    return this.members.find((m) => m.token === token);
  }

  addMember(name: string, avatar: string, socketId: string): Member | string {
    if (this.members.length >= MAX_MEMBERS) return 'A sala está lotada.';
    const canPlay = this.phase === 'lobby' && this.players.length < this.settings.maxPlayers;
    const taken = new Set(this.members.map((m) => m.name.toLowerCase()));
    let unique = name;
    for (let i = 2; taken.has(unique.toLowerCase()); i++) unique = `${name} ${i}`;
    const m: Member = {
      id: randomUUID().slice(0, 8), token: randomBytes(16).toString('hex'), name: unique, avatar, socketId,
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, lie: null, pick: null,
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    this.touch();
    return m;
  }

  reconnect(m: Member, socketId: string) {
    clearTimeout(m.graceTimer);
    m.socketId = socketId;
    m.connected = true;
    this.touch();
    this.sendMine(m);
  }

  /** O que só o próprio jogador pode ver: a mentira que escreveu e qual alternativa é dele. */
  private sendMine(m: Member) {
    if (!m.socketId) return;
    const own = this.options.find((o) => o.authors.includes(m.id))?.id ?? null;
    this.io.to(m.socketId).emit('lie:mine', { round: this.round, lie: m.lie, pick: m.pick, own });
  }

  disconnect(socketId: string) {
    const m = this.members.find((x) => x.socketId === socketId);
    if (!m) return;
    m.socketId = null;
    m.connected = false;
    const inGame = this.phase !== 'lobby' && this.phase !== 'ended' && m.role === 'player';
    m.graceTimer = setTimeout(() => this.expire(m), inGame ? GRACE_GAME_MS : GRACE_LOBBY_MS);
    this.broadcast();
    this.checkAllIn();
  }

  leave(id: string) {
    const m = this.find(id);
    if (m) this.expire(m);
  }

  private expire(m: Member) {
    clearTimeout(m.graceTimer);
    const inGame = this.phase !== 'lobby' && this.phase !== 'ended' && m.role === 'player';
    if (inGame) {
      m.left = true;
      m.connected = false;
      m.socketId = null;
    } else {
      this.members = this.members.filter((x) => x !== m);
    }
    if (this.hostId === m.id) {
      const next = this.members.find((x) => x.connected && x.role === 'player' && !x.left) ?? this.members.find((x) => x.connected);
      this.hostId = next?.id ?? '';
    }
    if (!this.members.some((x) => x.connected)) return this.onEmpty(this);
    if (inGame && this.activePlayers().length < 2) return this.finish();
    this.broadcast();
    this.checkAllIn();
  }

  claimSeat(id: string) {
    const m = this.find(id);
    if (!m || m.role === 'player' || this.phase !== 'lobby' || this.players.length >= this.settings.maxPlayers) return;
    m.role = 'player';
    this.broadcast();
  }

  leaveSeat(id: string) {
    const m = this.find(id);
    if (!m || m.role === 'spectator' || this.phase !== 'lobby') return;
    m.role = 'spectator';
    this.broadcast();
  }

  updateSettings(by: string, patch: Partial<LieSettings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (LIE_ROUNDS.includes(patch.rounds as never)) s.rounds = patch.rounds!;
    if (LIE_WRITE_TIMES.includes(patch.writeTime as never)) s.writeTime = patch.writeTime!;
    if (LIE_MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) s.maxPlayers = patch.maxPlayers!;
    this.settings = s;
    this.broadcast();
  }

  // ---------- partida ----------

  start(by: string): string | null {
    if (by !== this.hostId) return 'Só o anfitrião pode iniciar.';
    if (this.phase !== 'lobby' && this.phase !== 'ended') return 'A partida já começou.';
    if (this.phase === 'ended') this.resetToLobby();
    for (const m of this.players) if (!m.connected) m.role = 'spectator';
    if (this.players.length < 2) return 'São necessários pelo menos 2 jogadores conectados.';
    for (const p of this.players) {
      p.score = 0;
      p.left = false;
    }
    this.round = 0;
    this.ranking = null;
    this.winnerId = null;
    this.nextRound();
    return null;
  }

  restart(by: string, startNow: boolean): string | null {
    if (by !== this.hostId) return 'Só o anfitrião pode reiniciar.';
    if (this.phase !== 'ended') return null;
    this.resetToLobby();
    if (startNow) return this.start(by);
    this.broadcast();
    return null;
  }

  private resetToLobby() {
    clearTimeout(this.timer);
    this.members = this.members.filter((m) => !m.left);
    for (const s of this.members.filter((m) => m.role === 'spectator' && m.connected)) {
      if (this.players.length < this.settings.maxPlayers) s.role = 'player';
    }
    for (const m of this.members) {
      m.score = 0;
      m.lie = null;
      m.pick = null;
    }
    this.phase = 'lobby';
    this.current = null;
    this.options = [];
    this.reveal = null;
    this.gained = null;
    this.ranking = null;
    this.winnerId = null;
  }

  private pickQuestion() {
    let free = LIE_BANK.filter((q) => !this.used.has(q.id));
    if (!free.length) {
      this.used.clear();
      free = LIE_BANK;
    }
    const q = free[randomInt(free.length)];
    this.used.add(q.id);
    return q;
  }

  private nextRound() {
    clearTimeout(this.timer);
    this.round++;
    this.current = this.pickQuestion();
    this.options = [];
    this.reveal = null;
    this.gained = null;
    for (const m of this.members) {
      m.lie = null;
      m.pick = null;
    }
    this.phase = 'write';
    const ms = this.settings.writeTime * 1000;
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => this.startPick(), ms);
    this.broadcast();
  }

  writeLie(by: string, raw: unknown): { ok: boolean; error?: string; truth?: boolean } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'write') return { ok: false, error: 'Agora não é hora de escrever.' };
    const text = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIE_MAX_LEN);
    if (!lieNorm(text)) return { ok: false, error: 'Escreva uma resposta.' };
    if (tooClose(text, this.current!.truths)) return { ok: false, truth: true, error: 'Essa é a resposta certa! 🤫 Invente uma mentira.' };
    const first = m.lie === null;
    m.lie = text;
    if (first) this.broadcast();
    this.checkAllIn();
    return { ok: true };
  }

  /** Mentiras iguais viram uma alternativa só (os autores dividem os pontos). */
  private buildOptions() {
    const q = this.current!;
    const groups = new Map<string, Option>();
    for (const p of this.activePlayers()) {
      if (!p.lie) continue;
      const key = lieNorm(p.lie);
      const g = groups.get(key);
      if (g) g.authors.push(p.id);
      else groups.set(key, { id: randomBytes(4).toString('hex'), text: p.lie, truth: false, authors: [p.id] });
    }
    const options: Option[] = [{ id: randomBytes(4).toString('hex'), text: q.answer, truth: true, authors: [] }, ...groups.values()];
    // Poucas mentiras? Completa com respostas de outras perguntas ("mentira da casa").
    const kind = kindOf(q.answer);
    const others = shuffle(LIE_BANK.filter((x) => x.id !== q.id)).sort((x, y) => Number(kindOf(y.answer) === kind) - Number(kindOf(x.answer) === kind));
    for (const o of others) {
      if (options.length >= MIN_OPTIONS) break;
      const key = lieNorm(o.answer);
      if (options.some((x) => lieNorm(x.text) === key) || tooClose(o.answer, q.truths)) continue;
      options.push({ id: randomBytes(4).toString('hex'), text: o.answer, truth: false, authors: [] });
    }
    this.options = shuffle(options);
  }

  private startPick() {
    if (this.phase !== 'write') return;
    clearTimeout(this.timer);
    this.buildOptions();
    this.phase = 'pick';
    this.endsAt = Date.now() + LIE_PICK_MS;
    this.timer = setTimeout(() => this.showReveal(), LIE_PICK_MS);
    // Primeiro avisa a cada um qual alternativa é a dele, depois muda a tela.
    for (const m of this.members) this.sendMine(m);
    this.broadcast();
  }

  pick(by: string, optionId: unknown): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'pick') return { ok: false, error: 'Agora não é hora de escolher.' };
    const o = this.options.find((x) => x.id === optionId);
    if (!o) return { ok: false, error: 'Alternativa inválida.' };
    if (o.authors.includes(m.id)) return { ok: false, error: 'Essa é a sua mentira! 😏' };
    const first = m.pick === null;
    m.pick = o.id;
    if (first) this.broadcast();
    this.checkAllIn();
    return { ok: true };
  }

  private checkAllIn() {
    if (this.phase !== 'write' && this.phase !== 'pick') return;
    const active = this.activePlayers().filter((p) => p.connected);
    const done = (p: Member) => (this.phase === 'write' ? p.lie !== null : p.pick !== null);
    if (active.length && active.every(done)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => (this.phase === 'write' ? this.startPick() : this.showReveal()), ALL_IN_DELAY_MS);
    }
  }

  private showReveal() {
    if (this.phase !== 'pick') return;
    clearTimeout(this.timer);
    const players = this.activePlayers();
    const gained: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
    const reveal: LieReveal[] = this.options.map((o) => ({
      id: o.id,
      text: o.text,
      truth: o.truth,
      authors: o.authors,
      pickedBy: players.filter((p) => p.pick === o.id).map((p) => p.id),
    }));
    for (const r of reveal) {
      if (r.truth) for (const id of r.pickedBy) gained[id] += LIE_TRUTH_POINTS;
      else for (const a of r.authors) if (a in gained) gained[a] += LIE_FOOL_POINTS * r.pickedBy.length;
    }
    for (const p of players) p.score += gained[p.id];
    // Suspense: primeiro as mentiras que ninguém escolheu, depois as que mais enganaram, e a verdade por último.
    reveal.sort((a, b) => Number(a.truth) - Number(b.truth) || a.pickedBy.length - b.pickedBy.length);
    const shown = reveal.filter((r) => r.truth || r.pickedBy.length > 0 || r.authors.length > 0);
    this.reveal = shown;
    this.gained = gained;
    this.phase = 'reveal';
    const ms = shown.length * LIE_REVEAL_STEP_MS + LIE_REVEAL_TAIL_MS;
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => this.advance(), ms);
    this.broadcast();
  }

  next(by: string) {
    if (by === this.hostId && this.phase === 'reveal') this.advance();
  }

  private advance() {
    clearTimeout(this.timer);
    if (this.activePlayers().length < 2 || this.round >= this.settings.rounds) return this.finish();
    this.nextRound();
  }

  private finish() {
    clearTimeout(this.timer);
    this.phase = 'ended';
    this.endsAt = null;
    const sorted = [...this.players].sort((a, b) => b.score - a.score || Number(a.left) - Number(b.left));
    let place = 0;
    let last = -1;
    this.ranking = sorted.map((p, i) => {
      if (p.score !== last) place = i + 1;
      last = p.score;
      return { playerId: p.id, name: p.name, avatar: p.avatar, place, score: p.score, left: p.left };
    });
    this.winnerId = sorted[0]?.id ?? null;
    this.broadcast();
  }

  destroy() {
    clearTimeout(this.timer);
    for (const m of this.members) clearTimeout(m.graceTimer);
  }

  // ---------- comunicação ----------

  private touch() {
    this.lastActivity = Date.now();
  }

  snapshot(): LiePublicRoom {
    const host = this.find(this.hostId);
    return {
      kind: 'lie',
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, connected: m.connected, left: m.left, score: m.score,
        done: this.phase === 'write' ? m.lie !== null : this.phase === 'pick' ? m.pick !== null : false,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      round: this.round,
      question: this.phase === 'lobby' ? null : (this.current?.q ?? null),
      endsAt: this.endsAt,
      options: this.phase === 'pick' ? this.options.map((o) => ({ id: o.id, text: o.text })) : null,
      reveal: this.phase === 'reveal' ? this.reveal : null,
      gained: this.phase === 'reveal' ? this.gained : null,
      ranking: this.ranking,
      winnerId: this.winnerId,
      serverNow: Date.now(),
    };
  }

  broadcast() {
    this.touch();
    this.io.to(this.code).emit('room:state', this.snapshot());
  }
}
