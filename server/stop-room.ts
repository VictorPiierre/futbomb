import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { normalize } from '../shared/normalize.ts';
import {
  STOP_COUNTDOWN_MS, STOP_DEFAULT_CATEGORIES, STOP_REVIEW_MS, STOP_MAX_CATEGORIES, STOP_MAX_PLAYERS, STOP_MIN_CATEGORIES,
  STOP_ROUNDS, STOP_TIMES,
  type StopAnswer, type StopPhase, type StopPublicRoom, type StopSettings,
} from '../shared/stop.ts';
import { THEMES, type Theme } from '../shared/types.ts';
import { NAME_INDEXES } from './names.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const HARD_LETTERS = new Set(['K', 'W', 'X', 'Y', 'Z', 'Q', 'U']);
const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
const COLLECT_MS = 1200;
const SCORES_MS = 9000;
const MAX_ANSWER = 40;

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
  ready: boolean;
  answers: Partial<Record<Theme, string>>;
  graceTimer?: NodeJS.Timeout;
}

export class StopRoom {
  readonly kind = 'stop';
  readonly code: string;
  hostId = '';
  settings: StopSettings = { categories: [...STOP_DEFAULT_CATEGORIES], rounds: 5, roundTime: 90, maxPlayers: 8 };
  phase: StopPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private round = 0;
  private letter = '';
  private roundStartsAt: number | null = null;
  private roundEndsAt: number | null = null;
  private stoppedBy: string | null = null;
  private reviewEndsAt: number | null = null;
  private reviewIndex = 0;
  private answers: Partial<Record<Theme, StopAnswer[]>> | null = null;
  private roundPoints: Record<string, number> | null = null;
  private ranking: StopPublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;
  private letterLastDraw = new Map<string, number>();
  private letterDraws = 0;

  constructor(code: string, private io: Server, private onEmpty: (room: StopRoom) => void) {
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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, ready: false, answers: {},
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
    // Devolve as respostas que a pessoa já tinha digitado nesta rodada.
    this.io.to(socketId).emit('stop:mine', { round: this.round, answers: m.answers });
  }

  disconnect(socketId: string) {
    const m = this.members.find((x) => x.socketId === socketId);
    if (!m) return;
    m.socketId = null;
    m.connected = false;
    const inGame = this.phase !== 'lobby' && this.phase !== 'ended' && m.role === 'player';
    m.graceTimer = setTimeout(() => this.expire(m), inGame ? GRACE_GAME_MS : GRACE_LOBBY_MS);
    this.broadcast();
    this.checkReady();
  }

  leave(id: string) {
    const m = this.find(id);
    if (m) this.expire(m);
  }

  private expire(m: Member) {
    clearTimeout(m.graceTimer);
    const inGame = this.phase !== 'lobby' && this.phase !== 'ended' && m.role === 'player';
    if (inGame) {
      // Fica na classificação, mas sai das próximas rodadas.
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
    this.checkReady();
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

  updateSettings(by: string, patch: Partial<StopSettings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (Array.isArray(patch.categories)) {
      const cats = [...new Set(patch.categories.filter((c): c is Theme => typeof c === 'string' && c in THEMES))];
      if (cats.length >= STOP_MIN_CATEGORIES && cats.length <= STOP_MAX_CATEGORIES) s.categories = cats;
    }
    if (STOP_ROUNDS.includes(patch.rounds as never)) s.rounds = patch.rounds!;
    if (STOP_TIMES.includes(patch.roundTime as never)) s.roundTime = patch.roundTime!;
    if (STOP_MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) s.maxPlayers = patch.maxPlayers!;
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
      m.answers = {};
      m.ready = false;
    }
    this.phase = 'lobby';
    this.round = 0;
    this.answers = null;
    this.roundPoints = null;
    this.ranking = null;
    this.winnerId = null;
  }

  private nextRound() {
    clearTimeout(this.timer);
    this.round++;
    this.letter = this.drawLetter();
    this.phase = 'playing';
    this.stoppedBy = null;
    this.answers = null;
    this.roundPoints = null;
    this.reviewEndsAt = null;
    for (const m of this.members) {
      m.answers = {};
      m.ready = false;
    }
    const now = Date.now();
    this.roundStartsAt = now + STOP_COUNTDOWN_MS;
    this.roundEndsAt = this.roundStartsAt + this.settings.roundTime * 1000;
    this.timer = setTimeout(() => this.endRound(null), this.roundEndsAt - now);
    this.io.to(this.code).emit('stop:mine', { round: this.round, answers: {} });
    this.broadcast();
  }

  /** Letra em que todas as categorias têm respostas; prioriza as que estão há mais tempo sem sair. */
  private drawLetter(): string {
    const cats = this.settings.categories;
    const score = (l: string) => Math.min(...cats.map((c) => NAME_INDEXES[c].available(l, new Set())));
    let eligible = LETTERS.filter((l) => score(l) >= (HARD_LETTERS.has(l) ? 4 : 2));
    if (!eligible.length) eligible = [...LETTERS].sort((a, b) => score(b) - score(a)).slice(0, 8);
    const age = (l: string) => this.letterLastDraw.get(l) ?? -1;
    const byAge = [...eligible].sort((a, b) => age(a) - age(b));
    const never = byAge.filter((l) => age(l) < 0);
    const pool = never.length ? never : byAge.slice(0, Math.max(1, Math.ceil(byAge.length / 3)));
    const letter = pool[randomInt(pool.length)];
    this.letterLastDraw.set(letter, ++this.letterDraws);
    return letter;
  }

  answer(by: string, payload: { category?: unknown; text?: unknown }) {
    const m = this.find(by);
    // Continua aceitando durante o breve "recolhimento" depois do STOP.
    if (!m || m.role !== 'player' || m.left || this.phase !== 'playing') return;
    if (this.roundStartsAt && Date.now() < this.roundStartsAt) return;
    const cat = String(payload?.category) as Theme;
    if (!this.settings.categories.includes(cat)) return;
    const text = String(payload?.text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, MAX_ANSWER);
    const before = m.answers[cat]?.trim() ? 1 : 0;
    m.answers[cat] = text;
    const after = text.trim() ? 1 : 0;
    if (before !== after) this.broadcast(); // atualiza o progresso dos outros
  }

  /** Botão STOP: só vale com todas as categorias preenchidas. */
  stop(by: string, finalAnswers: unknown): string | null {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left || this.phase !== 'playing' || this.stoppedBy) return 'Agora não dá.';
    if (finalAnswers && typeof finalAnswers === 'object') {
      for (const cat of this.settings.categories) {
        const v = (finalAnswers as Record<string, unknown>)[cat];
        if (typeof v === 'string') m.answers[cat] = v.slice(0, MAX_ANSWER);
      }
    }
    if (this.settings.categories.some((c) => !m.answers[c]?.trim())) return 'Preencha todas as categorias antes de dar STOP!';
    this.endRound(m.id);
    return null;
  }

  private endRound(stoppedBy: string | null) {
    if (this.phase !== 'playing' || this.stoppedBy) return;
    clearTimeout(this.timer);
    this.stoppedBy = stoppedBy ?? 'time';
    this.roundEndsAt = Date.now();
    // Pede para todos enviarem o que digitaram e dá um instante para chegar.
    this.io.to(this.code).emit('stop:collect', { by: stoppedBy });
    this.broadcast();
    this.timer = setTimeout(() => this.startReview(), COLLECT_MS);
  }

  private startReview() {
    const letter = this.letter.toLowerCase();
    const answers: Partial<Record<Theme, StopAnswer[]>> = {};
    for (const cat of this.settings.categories) {
      answers[cat] = this.activePlayers().map((p) => {
        const text = (p.answers[cat] ?? '').trim();
        const key = normalize(text);
        // Como no StopotS: quem decide são os jogadores. Tudo começa valendo,
        // exceto em branco ou com a letra errada.
        const status: StopAnswer['status'] = !key ? 'empty' : key[0] !== letter ? 'wrong-letter' : 'ok';
        return { playerId: p.id, text, status, against: [], valid: status === 'ok' };
      });
    }
    this.answers = answers;
    this.phase = 'review';
    this.reviewIndex = 0;
    this.startCategoryReview();
  }

  /** Todos corrigem a mesma categoria; passa quando todos confirmam ou o tempo acaba. */
  private startCategoryReview() {
    clearTimeout(this.timer);
    for (const m of this.members) m.ready = false;
    this.reviewEndsAt = Date.now() + STOP_REVIEW_MS;
    this.timer = setTimeout(() => this.nextCategory(), STOP_REVIEW_MS);
    this.broadcast();
  }

  private nextCategory() {
    if (this.phase !== 'review') return;
    this.reviewIndex++;
    if (this.reviewIndex >= this.settings.categories.length) this.score();
    else this.startCategoryReview();
  }

  /** valid=false: "não vale" (👎); valid=null/true: retira o voto. */
  vote(by: string, payload: { category?: unknown; playerId?: unknown; valid?: unknown }) {
    if (this.phase !== 'review' || !this.answers) return;
    const voter = this.find(by);
    if (!voter || voter.role !== 'player' || voter.left) return;
    const cat = String(payload?.category) as Theme;
    if (cat !== this.settings.categories[this.reviewIndex]) return; // só a categoria em correção
    const a = this.answers[cat]?.find((x) => x.playerId === payload?.playerId);
    if (!a || a.playerId === by || a.status !== 'ok') return;
    a.against = a.against.filter((id) => id !== by);
    if (payload.valid === false) a.against.push(by);
    this.recompute(a);
    this.broadcast();
  }

  /** Não vale quando a maioria dos outros jogadores votou contra. */
  private recompute(a: StopAnswer) {
    if (a.status !== 'ok') {
      a.valid = false;
      return;
    }
    const voters = this.activePlayers().filter((p) => p.id !== a.playerId && p.connected).length;
    a.valid = !(voters > 0 && a.against.length > voters / 2);
  }

  ready(by: string) {
    const m = this.find(by);
    if (!m || this.phase !== 'review') return;
    m.ready = !m.ready;
    this.broadcast();
    this.checkReady();
  }

  private checkReady() {
    if (this.phase !== 'review') return;
    const voters = this.activePlayers().filter((p) => p.connected);
    if (voters.length && voters.every((p) => p.ready)) this.nextCategory();
  }

  private score() {
    if (this.phase !== 'review' || !this.answers) return;
    clearTimeout(this.timer);
    const points: Record<string, number> = Object.fromEntries(this.activePlayers().map((p) => [p.id, 0]));
    for (const list of Object.values(this.answers)) {
      for (const a of list!) this.recompute(a);
      const groups = new Map<string, StopAnswer[]>();
      for (const a of list!) {
        if (!a.valid) {
          a.points = 0;
          continue;
        }
        const key = normalize(a.text);
        groups.set(key, [...(groups.get(key) ?? []), a]);
      }
      for (const g of groups.values()) for (const a of g) a.points = g.length === 1 ? 10 : 5;
      for (const a of list!) points[a.playerId] = (points[a.playerId] ?? 0) + (a.points ?? 0);
    }
    for (const p of this.players) p.score += points[p.id] ?? 0;
    this.roundPoints = points;
    this.phase = 'scores';
    this.reviewEndsAt = Date.now() + SCORES_MS;
    this.timer = setTimeout(() => this.advance(), SCORES_MS);
    this.broadcast();
  }

  /** Anfitrião pode pular a espera do placar. */
  next(by: string) {
    if (by === this.hostId && this.phase === 'scores') this.advance();
  }

  private advance() {
    clearTimeout(this.timer);
    if (this.round >= this.settings.rounds || this.activePlayers().length < 2) this.finish();
    else this.nextRound();
  }

  private finish() {
    clearTimeout(this.timer);
    this.phase = 'ended';
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

  snapshot(): StopPublicRoom {
    const host = this.find(this.hostId);
    const showAnswers = this.phase === 'review' || this.phase === 'scores';
    return {
      kind: 'stop',
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, connected: m.connected, left: m.left, score: m.score, ready: m.ready,
        filled: this.settings.categories.filter((c) => m.answers[c]?.trim()).length,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      round: this.round,
      letter: this.phase === 'lobby' ? '' : this.letter,
      roundStartsAt: this.roundStartsAt,
      roundEndsAt: this.roundEndsAt,
      stoppedBy: this.stoppedBy,
      reviewIndex: this.reviewIndex,
      reviewEndsAt: this.reviewEndsAt,
      answers: showAnswers ? this.answers : null,
      roundPoints: this.phase === 'scores' ? this.roundPoints : null,
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
