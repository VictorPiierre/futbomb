import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  SOM_COUNTDOWN_MS, SOM_MAX_CLIP_BYTES, SOM_MAX_PLAYERS, SOM_RATING_ORDER, SOM_RATINGS,
  SOM_ROUNDS, SOM_SLIDE_LEAD_MS, SOM_SLIDE_MIN_MS,
  type SomClip, type SomPhase, type SomPublicRoom, type SomRating, type SomResult, type SomSettings, type SomSound,
} from '../shared/som.ts';
import { SOM_LIBRARY } from '../shared/som-library.ts';

const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
const ALL_IN_DELAY_MS = 800;
/** Testes automáticos aceleram a partida (ex.: SOM_PACE=0.1). */
const PACE = Number(process.env.SOM_PACE) || 1;
// Testes automáticos: sons de mentira para dar para jogar sem nenhum som cadastrado (ex.: SOM_TEST_SOUNDS=1).
if (process.env.SOM_TEST_SOUNDS && !SOM_LIBRARY.length) {
  for (let i = 1; i <= 6; i++) SOM_LIBRARY.push({ id: `teste-${i}`, title: `Som de teste ${i}`, emoji: '🧪', file: 'teste.wav' });
}
const ms = (n: number) => Math.round(n * PACE);

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
  clip: { mime: string; data: Buffer } | null;
  graceTimer?: NodeJS.Timeout;
}

function shuffle<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class SomRoom {
  readonly kind = 'som';
  readonly code: string;
  hostId = '';
  settings: SomSettings = { rounds: 5, maxPlayers: 8 };
  phase: SomPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private round = 0;
  private sound: SomSound | null = null;
  private playAt: number | null = null;
  private endsAt: number | null = null;
  /** Ordem do desfile: slot (1..n) -> id do jogador. */
  private slots: string[] = [];
  /** Desfile: -1 = relembrando o original; depois uma imitação por vez. */
  private slideIndex = -1;
  private slidePlayAt = 0;
  private slideReveal = false;
  /** Notas da rodada: id de quem imitou -> (id de quem votou -> nota). */
  private votes = new Map<string, Map<string, SomRating>>();
  private results: SomResult[] | null = null;
  private gained: Record<string, number> | null = null;
  private ranking: SomPublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;
  private used = new Set<string>();

  constructor(code: string, private io: Server, private onEmpty: (room: SomRoom) => void) {
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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, clip: null,
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    this.touch();
    // Entrou no meio da votação/resultado: recebe as gravações para poder ouvir.
    if (this.phase === 'vote' || this.phase === 'results') setTimeout(() => this.sendClips(m), 0);
    return m;
  }

  reconnect(m: Member, socketId: string) {
    clearTimeout(m.graceTimer);
    m.socketId = socketId;
    m.connected = true;
    this.touch();
    setTimeout(() => this.sendMine(m), 0);
    if (this.phase === 'vote' || this.phase === 'results') setTimeout(() => this.sendClips(m), 0);
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

  updateSettings(by: string, patch: Partial<SomSettings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (SOM_ROUNDS.includes(patch.rounds as never)) s.rounds = patch.rounds!;
    if (SOM_MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) s.maxPlayers = patch.maxPlayers!;
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
    if (!SOM_LIBRARY.length) return 'Ainda não tem nenhum som no jogo. O dono do site precisa adicionar os sons primeiro.';
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
      m.clip = null;
    }
    this.phase = 'lobby';
    this.sound = null;
    this.playAt = null;
    this.slots = [];
    this.votes.clear();
    this.results = null;
    this.gained = null;
    this.ranking = null;
    this.winnerId = null;
  }

  /** Sorteia um som ainda não usado na partida (quando acabam, recomeça a lista). */
  private pickSound(): SomSound {
    let free = SOM_LIBRARY.filter((s) => !this.used.has(s.id));
    if (!free.length) {
      this.used.clear();
      free = SOM_LIBRARY;
    }
    // Evita repetir o mesmo som duas rodadas seguidas quando a lista recomeça.
    const pool = free.length > 1 ? free.filter((s) => s.id !== this.sound?.id) : free;
    const s = pool[randomInt(pool.length)];
    this.used.add(s.id);
    return { id: s.id, title: s.title, emoji: s.emoji, ...(s.file ? { file: s.file } : {}) };
  }

  private nextRound() {
    clearTimeout(this.timer);
    this.round++;
    this.sound = this.pickSound();
    this.slots = [];
    this.results = null;
    this.gained = null;
    this.votes.clear();
    for (const m of this.members) m.clip = null;
    this.phase = 'record';
    this.playAt = Date.now() + ms(SOM_COUNTDOWN_MS);
    // Sem tempo para gravar: segue quando todos apertarem "Pronto" (ou o dono encerrar).
    this.endsAt = null;
    this.broadcast();
  }

  submitClip(by: string, data: unknown, mime: unknown): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'record') return { ok: false, error: 'O tempo para gravar acabou.' };
    const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
    if (!buf || buf.length < 200) return { ok: false, error: 'Gravação vazia. Tente de novo.' };
    if (buf.length > SOM_MAX_CLIP_BYTES) return { ok: false, error: 'Gravação grande demais.' };
    const type = String(mime ?? '').toLowerCase();
    if (!/^audio\/[a-z0-9.+-]+(;\s*codecs=[a-z0-9.,"' -]+)?$/.test(type)) return { ok: false, error: 'Formato de áudio inválido.' };
    const first = m.clip === null;
    m.clip = { mime: type, data: buf };
    if (first) this.broadcast();
    this.checkAllIn();
    return { ok: true };
  }

  private startVote() {
    if (this.phase !== 'record') return;
    clearTimeout(this.timer);
    this.playAt = null;
    const withClip = this.activePlayers().filter((p) => p.clip);
    if (!withClip.length) return this.showResults();
    this.slots = shuffle(withClip.map((p) => p.id));
    this.votes = new Map(this.slots.map((id) => [id, new Map()]));
    this.phase = 'vote';
    // Primeiro relembra o original (e dá tempo das gravações chegarem a todos).
    this.slideIndex = -1;
    this.slideReveal = false;
    this.slidePlayAt = Date.now() + ms(1500);
    this.endsAt = null;
    for (const m of this.members) this.sendClips(m);
    this.broadcast();
  }

  /** Próxima imitação do desfile (ou o resultado, depois da última). */
  private nextSlide() {
    if (this.phase !== 'vote') return;
    clearTimeout(this.timer);
    this.slideIndex++;
    if (this.slideIndex >= this.slots.length) return this.showResults();
    this.slideReveal = false;
    this.slidePlayAt = Date.now() + ms(SOM_SLIDE_LEAD_MS);
    this.endsAt = null;
    this.broadcast();
    this.checkSlide();
  }

  /** Mostra as notas da imitação atual (fica na tela até o dono apertar "Próximo"). */
  private revealSlide() {
    if (this.phase !== 'vote' || this.slideReveal) return;
    clearTimeout(this.timer);
    this.slideReveal = true;
    this.broadcast();
  }

  /** Quem pode dar nota na imitação atual: jogadores ativos e conectados, menos o dono dela. */
  private eligible() {
    const target = this.slots[this.slideIndex];
    return this.activePlayers().filter((p) => p.connected && p.id !== target);
  }

  private votedNow(id: string) {
    const target = this.slots[this.slideIndex];
    return !!target && !!this.votes.get(target)?.has(id);
  }

  /** Todo mundo já votou: mostra o placar (depois de dar tempo de ouvir a imitação inteira). */
  private checkSlide() {
    if (this.phase !== 'vote' || this.slideIndex < 0 || this.slideReveal) return;
    const voters = this.eligible();
    if (voters.length && voters.every((p) => this.votedNow(p.id))) {
      clearTimeout(this.timer);
      const wait = Math.max(ms(ALL_IN_DELAY_MS), this.slidePlayAt + ms(SOM_SLIDE_MIN_MS) - Date.now());
      this.timer = setTimeout(() => this.revealSlide(), wait);
    }
  }

  private tally(target: string | undefined): Record<SomRating, string[]> {
    const t: Record<SomRating, string[]> = { ruim: [], meh: [], bom: [] };
    for (const [voter, r] of this.votes.get(target ?? '') ?? []) t[r].push(voter);
    return t;
  }

    /** Envia as gravações para um membro (cada um sabe só qual é a sua). */
  private sendClips(m: Member) {
    if (!m.socketId || !this.slots.length) return;
    const clips: SomClip[] = this.slots.map((id, i) => {
      const c = this.find(id)!.clip!;
      const data = c.data.buffer.slice(c.data.byteOffset, c.data.byteOffset + c.data.byteLength) as ArrayBuffer;
      return { slot: i + 1, mime: c.mime, data, mine: id === m.id };
    });
    this.io.to(m.socketId).emit('som:clips', { round: this.round, clips });
  }

  /** O que só o próprio jogador sabe: se já gravou e em quem votou. */
  private sendMine(m: Member) {
    if (!m.socketId) return;
    const target = this.phase === 'vote' ? this.slots[this.slideIndex] : undefined;
    this.io.to(m.socketId).emit('som:mine', { round: this.round, recorded: !!m.clip, slide: this.slideIndex, vote: (target && this.votes.get(target)?.get(m.id)) ?? null });
  }

  /** Nota para a imitação que está na tela. */
  vote(by: string, rating: unknown): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'vote' || this.slideIndex < 0) return { ok: false, error: 'Agora não é hora de votar.' };
    if (this.slideReveal) return { ok: false, error: 'A votação desta imitação já fechou.' };
    if (!SOM_RATING_ORDER.includes(rating as SomRating)) return { ok: false, error: 'Nota inválida.' };
    const target = this.slots[this.slideIndex];
    if (target === m.id) return { ok: false, error: 'Não vale votar em você mesmo! 😏' };
    this.votes.get(target)!.set(m.id, rating as SomRating);
    this.broadcast();
    this.checkSlide();
    return { ok: true };
  }

  private checkAllIn() {
    if (this.phase === 'record') {
      if (Date.now() < (this.playAt ?? 0)) return;
      const active = this.activePlayers().filter((p) => p.connected);
      if (active.length && active.every((p) => p.clip)) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.startVote(), ALL_IN_DELAY_MS);
      }
    } else if (this.phase === 'vote') this.checkSlide();
  }

  private showResults() {
    if (this.phase !== 'record' && this.phase !== 'vote') return;
    clearTimeout(this.timer);
    const players = this.activePlayers();
    const gained: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
    // Cada nota vale pontos para quem imitou: Bom +2, Meh +1, Ruim 0.
    const results: SomResult[] = this.slots.map((id, i) => {
      const votes = this.tally(id);
      const points = SOM_RATING_ORDER.reduce((n, r) => n + votes[r].length * SOM_RATINGS[r].points, 0);
      return { playerId: id, slot: i + 1, votes, points, best: false };
    });
    const top = Math.max(0, ...results.map((r) => r.points));
    for (const r of results) {
      r.best = top > 0 && r.points === top;
      if (r.playerId in gained) gained[r.playerId] += r.points;
    }
    for (const p of players) p.score += gained[p.id];
    results.sort((a, b) => b.points - a.points || a.slot - b.slot);
    this.results = results;
    this.gained = gained;
    this.phase = 'results';
    this.playAt = null;
    // Fica no resultado até o dono apertar "Próximo" (dá tempo de ouvir e baixar as gravações).
    this.endsAt = null;
    this.broadcast();
  }

  /** Botão do dono: encerra a gravação, passa a imitação do desfile, ou vai para a próxima rodada. */
  next(by: string) {
    if (by !== this.hostId) return;
    if (this.phase === 'record') this.startVote();
    else if (this.phase === 'vote') this.nextSlide();
    else if (this.phase === 'results') this.advance();
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
    this.playAt = null;
    for (const m of this.members) m.clip = null;
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

  snapshot(): SomPublicRoom {
    const host = this.find(this.hostId);
    return {
      kind: 'som',
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, connected: m.connected, left: m.left, score: m.score,
        done: this.phase === 'record' ? m.clip !== null : this.phase === 'vote' ? this.votedNow(m.id) : false,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      round: this.round,
      sound: this.phase === 'lobby' ? null : this.sound,
      playAt: this.phase === 'record' ? this.playAt : null,
      endsAt: this.endsAt,
      order: this.phase === 'vote' || this.phase === 'results' ? this.slots : [],
      slide: this.phase === 'vote' ? { index: this.slideIndex, playAt: this.slidePlayAt, reveal: this.slideReveal, votes: this.slideReveal ? this.tally(this.slots[this.slideIndex]) : null } : null,
      soundCount: SOM_LIBRARY.length,
      results: this.phase === 'results' ? this.results : null,
      gained: this.phase === 'results' ? this.gained : null,
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
