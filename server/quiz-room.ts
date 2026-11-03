import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  QUIZ_CATEGORIES, QUIZ_EXACT_BONUS, QUIZ_MAX_PLAYERS, QUIZ_POINTS, QUIZ_REVEAL_MS, QUIZ_TARGETS, QUIZ_TIMES,
  parseGuess,
  type QuizCategory, type QuizPhase, type QuizPublicRoom, type QuizQuestion, type QuizResult, type QuizSettings,
} from '../shared/quiz.ts';
import { QUIZ_BANK } from './quiz-bank.ts';

const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
/** Quando todos já chutaram, espera um instante antes de revelar. */
const ALL_IN_DELAY_MS = 700;

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
  guess: number | null;
  graceTimer?: NodeJS.Timeout;
}

export class QuizRoom {
  readonly kind = 'quiz';
  readonly code: string;
  hostId = '';
  settings: QuizSettings = {
    categories: Object.keys(QUIZ_CATEGORIES) as QuizCategory[],
    target: 25,
    questionTime: 20,
    maxPlayers: 10,
  };
  phase: QuizPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private number = 0;
  private current: QuizQuestion | null = null;
  private endsAt: number | null = null;
  private results: QuizResult[] | null = null;
  private ranking: QuizPublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;
  /** Perguntas já feitas nesta sala (vale entre partidas). */
  private used = new Set<string>();
  private lastCat: QuizCategory | null = null;

  constructor(code: string, private io: Server, private onEmpty: (room: QuizRoom) => void) {
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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, guess: null,
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
    this.io.to(socketId).emit('quiz:mine', { number: this.number, guess: m.guess });
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

  updateSettings(by: string, patch: Partial<QuizSettings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (Array.isArray(patch.categories)) {
      const cats = [...new Set(patch.categories.filter((c): c is QuizCategory => typeof c === 'string' && c in QUIZ_CATEGORIES))];
      if (cats.length >= 1) s.categories = cats;
    }
    if (QUIZ_TARGETS.includes(patch.target as never)) s.target = patch.target!;
    if (QUIZ_TIMES.includes(patch.questionTime as never)) s.questionTime = patch.questionTime!;
    if (QUIZ_MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) s.maxPlayers = patch.maxPlayers!;
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
    this.number = 0;
    this.ranking = null;
    this.winnerId = null;
    this.nextQuestion();
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
      m.guess = null;
    }
    this.phase = 'lobby';
    this.current = null;
    this.results = null;
    this.ranking = null;
    this.winnerId = null;
  }

  /** Sorteia a categoria (evitando repetir a anterior) e uma pergunta ainda não feita nesta sala. */
  private pickQuestion(): QuizQuestion | null {
    const cats = this.settings.categories.filter((c) => QUIZ_BANK[c].some((q) => !this.used.has(q.id)));
    if (!cats.length) {
      // Esgotou tudo (improvável): libera as perguntas de novo.
      this.used.clear();
      return this.pickQuestion();
    }
    const pool = cats.length > 1 ? cats.filter((c) => c !== this.lastCat) : cats;
    const cat = pool[randomInt(pool.length)];
    const list = QUIZ_BANK[cat];
    for (let tries = 0; tries < 50; tries++) {
      const q = list[randomInt(list.length)];
      if (!this.used.has(q.id)) return q;
    }
    return list.find((q) => !this.used.has(q.id)) ?? null;
  }

  private nextQuestion() {
    clearTimeout(this.timer);
    const q = this.pickQuestion();
    if (!q) return this.finish();
    this.used.add(q.id);
    this.lastCat = q.cat;
    this.current = q;
    this.number++;
    this.results = null;
    for (const m of this.members) m.guess = null;
    this.phase = 'question';
    const ms = this.settings.questionTime * 1000;
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => this.reveal(), ms);
    this.broadcast();
  }

  guess(by: string, raw: unknown): { ok: boolean; value?: number; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'question') return { ok: false, error: 'Agora não dá para chutar.' };
    const value = parseGuess(String(raw ?? '').slice(0, 40));
    if (value === null || value < 0) return { ok: false, error: 'Digite um número (ex.: 330, 1.500 ou 2 milhões).' };
    const first = m.guess === null;
    m.guess = value;
    if (first) this.broadcast();
    this.checkAllIn();
    return { ok: true, value };
  }

  private checkAllIn() {
    if (this.phase !== 'question') return;
    const active = this.activePlayers().filter((p) => p.connected);
    if (active.length && active.every((p) => p.guess !== null)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reveal(), ALL_IN_DELAY_MS);
    }
  }

  private reveal() {
    if (this.phase !== 'question' || !this.current) return;
    clearTimeout(this.timer);
    const answer = this.current.a;
    const players = this.activePlayers();
    const guessed = players
      .filter((p) => p.guess !== null)
      .map((p) => ({ p, diff: Math.abs(p.guess! - answer) }))
      .sort((a, b) => a.diff - b.diff);
    // Empates na mesma distância dividem a mesma colocação.
    const results: QuizResult[] = [];
    let place = 0;
    let lastDiff = -1;
    guessed.forEach(({ p, diff }, i) => {
      if (diff !== lastDiff) place = i + 1;
      lastDiff = diff;
      const exact = diff === 0;
      const points = (QUIZ_POINTS[place - 1] ?? 0) + (exact ? QUIZ_EXACT_BONUS : 0);
      p.score += points;
      results.push({ playerId: p.id, guess: p.guess, diff, place, points, exact });
    });
    for (const p of players.filter((x) => x.guess === null)) {
      results.push({ playerId: p.id, guess: null, diff: null, place: null, points: 0, exact: false });
    }
    this.results = results;
    this.phase = 'reveal';
    this.endsAt = Date.now() + QUIZ_REVEAL_MS;
    this.timer = setTimeout(() => this.advance(), QUIZ_REVEAL_MS);
    this.broadcast();
  }

  /** Anfitrião pode pular a espera da revelação. */
  next(by: string) {
    if (by === this.hostId && this.phase === 'reveal') this.advance();
  }

  private advance() {
    clearTimeout(this.timer);
    const players = this.activePlayers();
    if (players.length < 2) return this.finish();
    const best = Math.max(...players.map((p) => p.score));
    const leaders = players.filter((p) => p.score === best);
    // Chegou na meta e não está empatado no topo: acabou. Empate = pergunta de desempate.
    if (best >= this.settings.target && leaders.length === 1) this.finish();
    else this.nextQuestion();
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

  snapshot(): QuizPublicRoom {
    const host = this.find(this.hostId);
    const q = this.current;
    return {
      kind: 'quiz',
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, connected: m.connected, left: m.left, score: m.score, answered: m.guess !== null,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      number: this.number,
      question: q && this.phase !== 'lobby' ? { cat: q.cat, q: q.q, unit: q.unit } : null,
      answer: this.phase === 'reveal' || this.phase === 'ended' ? (q?.a ?? null) : null,
      endsAt: this.endsAt,
      results: this.phase === 'reveal' || this.phase === 'ended' ? this.results : null,
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
