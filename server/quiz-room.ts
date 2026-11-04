import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  QUIZ_BETS, QUIZ_BET_PENALTY, QUIZ_CATEGORIES, QUIZ_CLOSE_BONUS, QUIZ_DIFFICULTIES, QUIZ_EXACT_BONUS, QUIZ_HIGHLOW_POINTS,
  QUIZ_LIGHTNING_S, QUIZ_MAX_PLAYERS, QUIZ_UNDERDOG_BONUS, QUIZ_UNDERDOG_PENALTY, QUIZ_POINTS, QUIZ_REVEAL_MS, QUIZ_TARGETS, QUIZ_TIMES,
  closeness, parseGuess,
  type QuizCategory, type QuizPhase, type QuizPublicRoom, type QuizQuestion, type QuizResult, type QuizSettings,
  type QuizDifficulty, type QuizSpecial,
} from '../shared/quiz.ts';
import { difficultyPool } from './quiz-bank.ts';

const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
/** Quando todos já chutaram, espera um instante antes de revelar. */
const ALL_IN_DELAY_MS = 700;
/** Chance de uma pergunta (a partir da 3ª) ser especial. */
const SPECIAL_CHANCE = Number(process.env.QUIZ_SPECIAL_CHANCE ?? 0.3);

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
  bets: number;
  betting: boolean;
  /** Azarão escolhido nesta pergunta. */
  pick: string | null;
  graceTimer?: NodeJS.Timeout;
}

export class QuizRoom {
  readonly kind = 'quiz';
  readonly code: string;
  hostId = '';
  settings: QuizSettings = {
    categories: (Object.keys(QUIZ_CATEGORIES) as QuizCategory[]).filter((c) => c !== 'brazil'),
    difficulty: 'easy',
    target: 25,
    questionTime: 20,
    maxPlayers: 10,
  };
  phase: QuizPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private number = 0;
  private current: QuizQuestion | null = null;
  private special: QuizSpecial | null = null;
  private reference: number | null = null;
  private lastSpecial = 0;
  private endsAt: number | null = null;
  private results: QuizResult[] | null = null;
  private roundWorst: string[] | null = null;
  private roundBest: string[] | null = null;
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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, guess: null, bets: QUIZ_BETS, betting: false, pick: null,
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
    this.io.to(socketId).emit('quiz:mine', { number: this.number, guess: m.guess, betting: m.betting });
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
    if (patch.difficulty && patch.difficulty in QUIZ_DIFFICULTIES) s.difficulty = patch.difficulty;
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
      p.bets = QUIZ_BETS;
    }
    this.number = 0;
    this.lastSpecial = 0;
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
      m.bets = QUIZ_BETS;
      m.betting = false;
    }
    this.phase = 'lobby';
    this.current = null;
    this.results = null;
    this.ranking = null;
    this.winnerId = null;
  }

  /** Sorteia a categoria (evitando repetir a anterior) e uma pergunta ainda não feita nesta sala. */
  private pickQuestion(): QuizQuestion | null {
    const order: QuizDifficulty[] = ['easy', 'normal', 'hard'];
    let pools = new Map<QuizCategory, QuizQuestion[]>();
    let cats: QuizCategory[] = [];
    // Se a dificuldade escolhida acabar nas categorias da sala, passa para a seguinte.
    for (const d of order.slice(order.indexOf(this.settings.difficulty))) {
      pools = new Map(this.settings.categories.map((c) => [c, difficultyPool(c, d)]));
      cats = this.settings.categories.filter((c) => pools.get(c)!.some((q) => !this.used.has(q.id)));
      if (cats.length) break;
    }
    if (!cats.length) {
      // Esgotou tudo (improvável): libera as perguntas de novo.
      this.used.clear();
      return this.pickQuestion();
    }
    const pool = cats.length > 1 ? cats.filter((c) => c !== this.lastCat) : cats;
    const cat = pool[randomInt(pool.length)];
    const list = pools.get(cat)!;
    for (let tries = 0; tries < 50; tries++) {
      const q = list[randomInt(list.length)];
      if (!this.used.has(q.id)) return q;
    }
    return list.find((q) => !this.used.has(q.id)) ?? null;
  }

  /** Rodadas especiais: nunca nas duas primeiras perguntas nem duas seguidas. */
  private drawSpecial(q: QuizQuestion): QuizSpecial | null {
    if (this.number < 3 || this.number - this.lastSpecial < 2 || Math.random() > SPECIAL_CHANCE) return null;
    const options: QuizSpecial[] = ['lightning', 'double', 'highlow'];
    const sp = options[randomInt(options.length)];
    return sp === 'highlow' && q.a < 3 ? 'double' : sp;
  }

  /** Número de referência do "mais ou menos": um pouco acima ou abaixo da resposta. */
  private makeReference(a: number, unit: string): number {
    const up = Math.random() < 0.5;
    if (unit === 'ano') {
      const delta = 3 + randomInt(28);
      return up && a + delta <= new Date().getFullYear() ? a + delta : a - delta;
    }
    const factor = 0.25 + Math.random() * 0.35;
    let ref = up ? a * (1 + factor) : a * (1 - factor);
    // Arredonda para um número "bonito" e garante que não coincide com a resposta.
    const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(ref))) - 1));
    ref = Math.round(ref / mag) * mag;
    if (ref === a) ref = up ? a + mag : a - mag;
    return ref;
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
    this.special = this.drawSpecial(q);
    if (this.special) this.lastSpecial = this.number;
    this.reference = this.special === 'highlow' ? this.makeReference(q.a, q.unit) : null;
    this.roundWorst = null;
    this.roundBest = null;
    for (const m of this.members) {
      m.guess = null;
      m.betting = false;
      m.pick = null;
    }
    this.phase = 'question';
    const ms = (this.special === 'lightning' ? QUIZ_LIGHTNING_S : this.settings.questionTime) * 1000;
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => this.reveal(), ms);
    this.broadcast();
  }

  guess(by: string, raw: unknown): { ok: boolean; value?: number; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'question') return { ok: false, error: 'Agora não dá para chutar.' };
    const highlow = this.special === 'highlow';
    const value = highlow ? (raw === 'up' ? 1 : raw === 'down' ? -1 : null) : parseGuess(String(raw ?? '').slice(0, 40));
    if (value === null || (!highlow && value < 0)) {
      return { ok: false, error: highlow ? 'Escolha maior ou menor.' : 'Digite um número (ex.: 330, 1.500 ou 2 milhões).' };
    }
    const first = m.guess === null;
    m.guess = value;
    if (first) this.broadcast();
    this.checkAllIn();
    return { ok: true, value };
  }

  /** Liga/desliga a ficha "🔥 Tô certo!" nesta pergunta. */
  bet(by: string): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left || this.phase !== 'question') return { ok: false, error: 'Agora não dá.' };
    if (!m.betting && m.bets <= 0) return { ok: false, error: 'Você já usou suas fichas.' };
    m.betting = !m.betting;
    this.broadcast();
    return { ok: true };
  }

  /** Escolhe (ou tira) quem vai ser o azarão — o pior da rodada. */
  pickUnderdog(by: string, target: unknown): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left || this.phase !== 'question') return { ok: false, error: 'Agora não dá.' };
    if (target === null || target === m.pick) {
      m.pick = null;
    } else {
      const t = this.activePlayers().find((p) => p.id === target);
      if (!t || t.id === m.id) return { ok: false, error: 'Escolha outro jogador.' };
      m.pick = t.id;
    }
    this.broadcast();
    return { ok: true };
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
    const { a: answer, unit } = this.current;
    const players = this.activePlayers();
    const mult = this.special === 'double' ? 2 : 1;
    const results: QuizResult[] = [];

    if (this.special === 'highlow') {
      const right = answer > this.reference! ? 1 : -1;
      for (const p of players) {
        const hit = p.guess === right;
        const points = p.guess === null ? 0 : hit ? QUIZ_HIGHLOW_POINTS * (p.betting ? 2 : 1) : p.betting ? -QUIZ_BET_PENALTY : 0;
        results.push({ playerId: p.id, guess: p.guess, diff: null, place: null, closeness: p.guess === null ? null : hit ? 'exact' : 'far', bet: p.betting, points, pick: null, pickPoints: 0 });
      }
    } else {
      const guessed = players
        .filter((p) => p.guess !== null)
        .map((p) => ({ p, diff: Math.abs(p.guess! - answer), c: closeness(answer, p.guess!, unit) }))
        .sort((x, y) => x.diff - y.diff);
      // Empates na mesma distância dividem a colocação; quem errou feio não pontua.
      let place = 0;
      let lastDiff = -1;
      guessed.forEach(({ p, diff, c }, i) => {
        if (diff !== lastDiff) place = i + 1;
        lastDiff = diff;
        let base = c === 'far' ? 0 : (QUIZ_POINTS[place - 1] ?? 0);
        if (c === 'exact') base += QUIZ_EXACT_BONUS;
        if (c === 'close') base += QUIZ_CLOSE_BONUS;
        let points = base * mult;
        if (p.betting) points = base > 0 ? points * 2 : -QUIZ_BET_PENALTY;
        results.push({ playerId: p.id, guess: p.guess, diff, place, closeness: c, bet: p.betting, points, pick: null, pickPoints: 0 });
      });
      for (const p of players.filter((x) => x.guess === null)) {
        results.push({ playerId: p.id, guess: null, diff: null, place: null, closeness: null, bet: false, points: 0, pick: null, pickPoints: 0 });
      }
    }

    // Azarão: pior = mais longe (ou não respondeu / errou o lado); melhor = 1º lugar (ou acertou o lado).
    const badness = (r: QuizResult) =>
      r.guess === null ? Infinity : this.special === 'highlow' ? (r.closeness === 'exact' ? 0 : 1) : (r.diff ?? Infinity);
    const scores = results.map((r) => ({ id: r.playerId, v: badness(r) }));
    const maxV = Math.max(...scores.map((x) => x.v));
    const minV = Math.min(...scores.map((x) => x.v));
    // Se todos empataram, não há azarão nem destaque.
    const worst = maxV === minV ? [] : scores.filter((x) => x.v === maxV).map((x) => x.id);
    const best = maxV === minV ? [] : scores.filter((x) => x.v === minV).map((x) => x.id);
    for (const r of results) {
      const p = this.find(r.playerId)!;
      r.pick = p.pick;
      r.pickPoints = !p.pick ? 0 : worst.includes(p.pick) ? QUIZ_UNDERDOG_BONUS : best.includes(p.pick) ? -QUIZ_UNDERDOG_PENALTY : 0;
    }
    this.roundWorst = worst;
    this.roundBest = best;

    for (const r of results) {
      const p = this.find(r.playerId)!;
      p.score = Math.max(0, p.score + r.points + r.pickPoints);
      if (r.bet) p.bets = Math.max(0, p.bets - 1);
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
        bets: m.bets, betting: m.betting, picked: m.pick !== null,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      number: this.number,
      question: q && this.phase !== 'lobby' ? { cat: q.cat, q: q.q, unit: q.unit, special: this.special, reference: this.reference } : null,
      answer: this.phase === 'reveal' || this.phase === 'ended' ? (q?.a ?? null) : null,
      endsAt: this.endsAt,
      results: this.phase === 'reveal' || this.phase === 'ended' ? this.results : null,
      roundWorst: this.phase === 'reveal' || this.phase === 'ended' ? this.roundWorst : null,
      roundBest: this.phase === 'reveal' || this.phase === 'ended' ? this.roundBest : null,
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
