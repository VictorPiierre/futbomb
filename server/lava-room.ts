import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  LAVA_COUNTDOWN_MS, LAVA_DIFFICULTIES, LAVA_MAX_PLAYERS, LAVA_RANKING_MS, LAVA_RISE_MS, LAVA_START_HEIGHT, LAVA_TIMES,
  climbFor, lavaRise, maxClimb, parseLavaAnswer,
  type LavaDifficulty, type LavaPhase, type LavaPublicRoom, type LavaResult, type LavaSettings,
} from '../shared/lava.ts';

const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
const ALL_IN_DELAY_MS = 400;
/** Trava de segurança: nunca deveria chegar aqui (a lava acelera). */
const MAX_ROUNDS = 30;
/** Só para testes automáticos: acelera contagem, ranking e animação. */
const PACE = Number(process.env.LAVA_PACE ?? 1);

interface Member {
  id: string;
  token: string;
  name: string;
  avatar: string;
  socketId: string | null;
  connected: boolean;
  role: 'player' | 'spectator';
  left: boolean;
  height: number;
  alive: boolean;
  diedRound: number | null;
  answer: number | null;
  answeredAt: number | null;
  graceTimer?: NodeJS.Timeout;
}

const r = (min: number, max: number) => randomInt(min, max + 1);

/** Gera uma conta de resposta inteira. */
export function makeQuestion(d: LavaDifficulty): { text: string; answer: number } {
  const kinds = d === 'easy' ? ['add', 'sub', 'mul'] : d === 'medium' ? ['add', 'sub', 'mul', 'mul', 'div'] : ['mul2', 'three', 'paren', 'sq', 'div3', 'pct'];
  const k = kinds[randomInt(kinds.length)];
  switch (k) {
    case 'add': {
      const [a, b] = d === 'easy' ? [r(1, 20), r(1, 20)] : [r(12, 99), r(12, 99)];
      return { text: `${a} + ${b}`, answer: a + b };
    }
    case 'sub': {
      const a = d === 'easy' ? r(5, 20) : r(30, 99);
      const b = d === 'easy' ? r(1, a) : r(11, a - 5);
      return { text: `${a} − ${b}`, answer: a - b };
    }
    case 'mul': {
      const [a, b] = d === 'easy' ? [r(2, 5), r(1, 10)] : [r(3, 12), r(3, 12)];
      return { text: `${a} × ${b}`, answer: a * b };
    }
    case 'div': {
      const b = r(2, 10);
      const q = r(2, 12);
      return { text: `${b * q} ÷ ${b}`, answer: q };
    }
    case 'mul2': {
      const a = r(12, 29);
      const b = r(3, 9);
      return { text: `${a} × ${b}`, answer: a * b };
    }
    case 'three': {
      const a = r(50, 200);
      const b = r(20, 150);
      const c = r(10, Math.min(99, a + b - 1));
      return { text: `${a} + ${b} − ${c}`, answer: a + b - c };
    }
    case 'paren': {
      const a = r(2, 15);
      const b = r(2, 15);
      const c = r(2, 6);
      return { text: `(${a} + ${b}) × ${c}`, answer: (a + b) * c };
    }
    case 'sq': {
      const a = r(11, 20);
      return { text: `${a}²`, answer: a * a };
    }
    case 'div3': {
      const b = r(3, 9);
      const q = r(15, 60);
      return { text: `${b * q} ÷ ${b}`, answer: q };
    }
    default: {
      const p = [10, 20, 25, 50][randomInt(4)];
      const base = p === 25 ? r(2, 24) * 20 : r(2, 30) * 10;
      return { text: `${p}% de ${base}`, answer: (base * p) / 100 };
    }
  }
}

export class LavaRoom {
  readonly kind = 'lava';
  readonly code: string;
  hostId = '';
  settings: LavaSettings = { difficulty: 'easy', answerTime: 10, maxPlayers: 8 };
  phase: LavaPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private round = 0;
  private lava = 0;
  private question: { text: string; answer: number } | null = null;
  private askAt: number | null = null;
  private endsAt: number | null = null;
  private results: LavaResult[] | null = null;
  private swallowed: string[] = [];
  private ranking: LavaPublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;

  constructor(code: string, private io: Server, private onEmpty: (room: LavaRoom) => void) {
    this.code = code;
  }

  // ---------- membros ----------

  get players() {
    return this.members.filter((m) => m.role === 'player');
  }

  private alivePlayers() {
    return this.players.filter((m) => m.alive && !m.left);
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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false,
      height: LAVA_START_HEIGHT, alive: true, diedRound: null, answer: null, answeredAt: null,
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
    this.io.to(socketId).emit('lava:mine', { round: this.round, answer: m.answer });
  }

  disconnect(socketId: string) {
    const m = this.members.find((x) => x.socketId === socketId);
    if (!m) return;
    m.socketId = null;
    m.connected = false;
    m.graceTimer = setTimeout(() => this.expire(m), this.inGame() && m.role === 'player' ? GRACE_GAME_MS : GRACE_LOBBY_MS);
    this.broadcast();
    this.checkAllIn();
  }

  leave(id: string) {
    const m = this.find(id);
    if (m) this.expire(m);
  }

  private inGame() {
    return this.phase !== 'lobby' && this.phase !== 'ended';
  }

  private expire(m: Member) {
    clearTimeout(m.graceTimer);
    if (this.inGame() && m.role === 'player') {
      m.left = true;
      m.connected = false;
      m.socketId = null;
      if (m.alive) {
        m.alive = false;
        m.diedRound = this.round;
      }
    } else {
      this.members = this.members.filter((x) => x !== m);
    }
    if (this.hostId === m.id) {
      const next = this.members.find((x) => x.connected && x.role === 'player' && !x.left) ?? this.members.find((x) => x.connected);
      this.hostId = next?.id ?? '';
    }
    if (!this.members.some((x) => x.connected)) return this.onEmpty(this);
    if (this.inGame() && this.alivePlayers().length < 2) return this.finish();
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

  updateSettings(by: string, patch: Partial<LavaSettings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (patch.difficulty && patch.difficulty in LAVA_DIFFICULTIES) s.difficulty = patch.difficulty;
    if (LAVA_TIMES.includes(patch.answerTime as never)) s.answerTime = patch.answerTime!;
    if (LAVA_MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) s.maxPlayers = patch.maxPlayers!;
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
      p.left = false;
      p.alive = true;
      p.diedRound = null;
      p.height = LAVA_START_HEIGHT;
    }
    this.round = 0;
    this.lava = 0;
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
      m.height = LAVA_START_HEIGHT;
      m.alive = true;
      m.diedRound = null;
      m.answer = null;
      m.answeredAt = null;
    }
    this.phase = 'lobby';
    this.round = 0;
    this.lava = 0;
    this.question = null;
    this.results = null;
    this.swallowed = [];
    this.ranking = null;
    this.winnerId = null;
  }

  private nextRound() {
    clearTimeout(this.timer);
    this.round++;
    this.question = makeQuestion(this.settings.difficulty);
    this.results = null;
    this.swallowed = [];
    for (const m of this.members) {
      m.answer = null;
      m.answeredAt = null;
    }
    this.phase = 'countdown';
    this.askAt = Date.now() + LAVA_COUNTDOWN_MS * PACE;
    this.endsAt = this.askAt;
    this.timer = setTimeout(() => this.ask(), LAVA_COUNTDOWN_MS * PACE);
    this.broadcast();
  }

  /** A pergunta só vai para os navegadores na hora de aparecer (ninguém vê antes). */
  private ask() {
    this.phase = 'question';
    this.askAt = Date.now();
    this.endsAt = this.askAt + this.settings.answerTime * 1000;
    this.timer = setTimeout(() => this.showRanking(), this.settings.answerTime * 1000);
    this.broadcast();
  }

  answer(by: string, raw: unknown): { ok: boolean; correct?: boolean; timeMs?: number; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player') return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'question') return { ok: false, error: 'Agora não dá para responder.' };
    if (m.answer !== null) return { ok: false, error: 'Você já respondeu.' };
    const value = parseLavaAnswer(String(raw ?? '').slice(0, 20));
    if (value === null) return { ok: false, error: 'Digite só o número.' };
    m.answer = value;
    m.answeredAt = Date.now();
    this.broadcast();
    this.checkAllIn();
    return { ok: true, correct: value === this.question!.answer, timeMs: m.answeredAt - this.askAt! };
  }

  /** Fecha quando todos os vivos (conectados) já responderam. */
  private checkAllIn() {
    if (this.phase !== 'question') return;
    const alive = this.alivePlayers().filter((p) => p.connected);
    if (alive.length && alive.every((p) => p.answer !== null)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.showRanking(), ALL_IN_DELAY_MS);
    }
  }

  private showRanking() {
    if (this.phase !== 'question') return;
    clearTimeout(this.timer);
    const correct = this.question!.answer;
    const all = this.players.filter((p) => !p.left || p.answer !== null);
    const res: LavaResult[] = all.map((p) => ({
      playerId: p.id,
      answer: p.answer,
      correct: p.answer === correct,
      timeMs: p.answeredAt === null ? null : p.answeredAt - this.askAt!,
      place: null,
      climb: 0,
      ghost: !p.alive,
    }));
    // Ordem: acertos por tempo, depois erros por tempo, depois quem não respondeu.
    const key = (x: LavaResult) => (x.correct ? 0 : x.answer !== null ? 1 : 2);
    res.sort((a, b) => key(a) - key(b) || (a.timeMs ?? 0) - (b.timeMs ?? 0));
    // Posição e blocos: só os vivos disputam a escada (fantasmas aparecem, mas não tiram lugar de ninguém).
    let place = 0;
    for (const x of res) {
      if (!x.correct || x.ghost) continue;
      place++;
      x.place = place;
      x.climb = climbFor(this.round, place);
    }
    this.results = res;
    this.phase = 'ranking';
    this.endsAt = Date.now() + LAVA_RANKING_MS * PACE;
    this.timer = setTimeout(() => this.rise(), LAVA_RANKING_MS * PACE);
    this.broadcast();
  }

  private rise() {
    clearTimeout(this.timer);
    for (const x of this.results ?? []) {
      const p = this.find(x.playerId);
      if (p && p.alive) p.height += x.climb;
    }
    this.lava += lavaRise(this.round);
    const alive = this.alivePlayers();
    const doomed = alive.filter((p) => p.height <= this.lava);
    if (doomed.length === alive.length && alive.length > 0) {
      // A lava pegaria todo mundo: quem estava mais alto vence (empate: quem foi mais rápido nesta rodada).
      const order = (this.results ?? []).map((x) => x.playerId);
      const best = [...alive].sort((a, b) => b.height - a.height || order.indexOf(a.id) - order.indexOf(b.id))[0];
      for (const p of alive) if (p !== best) this.kill(p);
      this.kill(best, false);
    } else {
      for (const p of doomed) this.kill(p);
    }
    this.phase = 'rise';
    this.endsAt = Date.now() + LAVA_RISE_MS * PACE;
    this.timer = setTimeout(() => this.afterRise(), LAVA_RISE_MS * PACE);
    this.broadcast();
  }

  private kill(p: Member, really = true) {
    if (!really) return;
    p.alive = false;
    p.diedRound = this.round;
    this.swallowed.push(p.id);
  }

  private afterRise() {
    if (this.alivePlayers().length <= 1 || this.round >= MAX_ROUNDS) return this.finish();
    this.nextRound();
  }

  private finish() {
    clearTimeout(this.timer);
    this.phase = 'ended';
    this.endsAt = null;
    this.askAt = null;
    // Quem sobreviveu mais tempo fica na frente; empate na mesma rodada: torre mais alta.
    const survived = (p: Member) => (p.alive && !p.left ? Infinity : (p.diedRound ?? 0));
    const sorted = [...this.players].sort((a, b) => survived(b) - survived(a) || b.height - a.height);
    let place = 0;
    let last = '';
    this.ranking = sorted.map((p, i) => {
      const k = `${survived(p)}|${p.height}`;
      if (k !== last) place = i + 1;
      last = k;
      return { playerId: p.id, name: p.name, avatar: p.avatar, place, score: p.height, left: p.left };
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

  snapshot(): LavaPublicRoom {
    const host = this.find(this.hostId);
    const asked = this.phase === 'question' || this.phase === 'ranking' || this.phase === 'rise';
    const revealed = this.phase === 'ranking' || this.phase === 'rise';
    return {
      kind: 'lava',
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, connected: m.connected, left: m.left,
        height: m.height, alive: m.alive, diedRound: m.diedRound, answered: m.answer !== null,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      round: this.round,
      lava: this.lava,
      rise: this.round ? lavaRise(this.round) : 0,
      topClimb: this.round ? maxClimb(this.round) : 0,
      askAt: this.phase === 'countdown' || this.phase === 'question' ? this.askAt : null,
      endsAt: this.endsAt,
      question: asked ? (this.question?.text ?? null) : null,
      answer: revealed ? (this.question?.answer ?? null) : null,
      results: revealed ? this.results : null,
      swallowed: this.phase === 'rise' ? this.swallowed : [],
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
