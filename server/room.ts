import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { normalize } from '../shared/normalize.ts';
import {
  START_LIVES, MAX_PLAYERS, TURN_TIMES, THEMES, THEME_IDS, ADULT_THEMES, type Theme,
  type AnswerResult, type GameFx, type HistoryItem, type PublicRoom, type Settings,
} from '../shared/types.ts';
import { NAME_INDEXES, recordRejected } from './names.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const HARD_LETTERS = new Set(['K', 'W', 'X', 'Y', 'Z', 'Q', 'U']);
const MAX_MEMBERS = 12;
const PAUSE_AFTER_EXPLOSION_MS = 1800;
const END_DELAY_MS = 1500;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 45_000;
const MIN_ANSWER_INTERVAL_MS = 250;

interface Member {
  id: string;
  token: string;
  name: string;
  avatar: string;
  socketId: string | null;
  connected: boolean;
  role: 'player' | 'spectator';
  lives: number;
  eliminated: boolean;
  eliminatedOrder: number;
  left: boolean;
  correct: number;
  lastAnswerAt: number;
  graceTimer?: NodeJS.Timeout;
}

interface GameState {
  theme: Theme;
  lastTheme: Theme | null;
  letter: string;
  lastLetter: string;
  /** Quem abriu a volta atual: a próxima volta começa com o jogador seguinte. */
  lapStarter: string;
  round: number;
  queue: string[];
  currentId: string | null;
  status: 'turn' | 'pause';
  turnEndsAt: number | null;
  used: Set<string>;
  history: HistoryItem[];
  historySeq: number;
  eliminatedCount: number;
  timer?: NodeJS.Timeout;
}

export class Room {
  readonly code: string;
  hostId = '';
  settings: Settings = { theme: 'mixed', turnTime: 10, maxPlayers: 4 };
  phase: 'lobby' | 'playing' | 'ended' = 'lobby';
  members: Member[] = [];
  game: GameState | null = null;
  winnerId: string | null = null;
  ranking: PublicRoom['ranking'] = null;
  /** Quando cada letra saiu pela última vez nesta sala (vale entre partidas e temas). */
  private letterLastDraw = new Map<string, number>();
  private letterDraws = 0;
  private lastGameStarter = '';
  lastActivity = Date.now();

  constructor(code: string, private io: Server, private onEmpty: (room: Room) => void) {
    this.code = code;
  }

  // ---------- membros ----------

  get players() {
    return this.members.filter((m) => m.role === 'player');
  }

  private activePlayers() {
    return this.players.filter((m) => !m.eliminated);
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
    const m: Member = {
      id: randomUUID().slice(0, 8),
      token: randomBytes(16).toString('hex'),
      name: this.uniqueName(name),
      avatar,
      socketId,
      connected: true,
      role: canPlay ? 'player' : 'spectator',
      lives: START_LIVES,
      eliminated: false,
      eliminatedOrder: 0,
      left: false,
      correct: 0,
      lastAnswerAt: 0,
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    this.touch();
    return m;
  }

  private uniqueName(name: string) {
    const taken = new Set(this.members.map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  }

  reconnect(m: Member, socketId: string) {
    clearTimeout(m.graceTimer);
    m.socketId = socketId;
    m.connected = true;
    this.touch();
  }

  disconnect(socketId: string) {
    const m = this.members.find((x) => x.socketId === socketId);
    if (!m) return;
    m.socketId = null;
    m.connected = false;
    const inGame = this.phase === 'playing' && m.role === 'player' && !m.eliminated;
    m.graceTimer = setTimeout(() => this.expire(m), inGame ? GRACE_GAME_MS : GRACE_LOBBY_MS);
    this.broadcast();
  }

  /** Saída voluntária (botão "Sair") ou fim do tempo de reconexão. */
  leave(id: string) {
    const m = this.find(id);
    if (m) this.expire(m);
  }

  private expire(m: Member) {
    clearTimeout(m.graceTimer);
    if (this.phase === 'playing' && m.role === 'player') {
      // Mantém na lista para a classificação final, mas fora da partida.
      m.left = true;
      m.connected = false;
      m.socketId = null;
      if (!m.eliminated) this.eliminate(m, 'left');
    } else {
      this.members = this.members.filter((x) => x !== m);
    }
    if (this.hostId === m.id) this.pickNewHost();
    if (!this.members.some((x) => x.connected)) {
      this.onEmpty(this);
      return;
    }
    this.broadcast();
  }

  private pickNewHost() {
    const next = this.members.find((x) => x.connected && x.role === 'player') ?? this.members.find((x) => x.connected);
    this.hostId = next?.id ?? '';
  }

  claimSeat(id: string) {
    const m = this.find(id);
    if (!m || m.role === 'player' || this.phase !== 'lobby') return;
    if (this.players.length >= this.settings.maxPlayers) return;
    m.role = 'player';
    this.broadcast();
  }

  leaveSeat(id: string) {
    const m = this.find(id);
    if (!m || m.role === 'spectator' || this.phase !== 'lobby') return;
    m.role = 'spectator';
    this.members = [...this.members.filter((x) => x !== m), m];
    this.broadcast();
  }

  updateSettings(by: string, patch: Partial<Settings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (patch.theme === 'mixed' || (typeof patch.theme === 'string' && patch.theme in THEMES)) s.theme = patch.theme;
    if (TURN_TIMES.includes(patch.turnTime as never)) s.turnTime = patch.turnTime!;
    if (MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) {
      s.maxPlayers = patch.maxPlayers!;
    }
    this.settings = s;
    this.broadcast();
  }

  // ---------- partida ----------

  start(by: string): string | null {
    if (by !== this.hostId) return 'Só o anfitrião pode iniciar.';
    if (this.phase === 'playing') return 'A partida já começou.';
    if (this.phase === 'ended') this.resetToLobby(false);
    // Jogadores desconectados na sala de espera não entram na partida.
    for (const m of this.players) if (!m.connected) m.role = 'spectator';
    const players = this.players;
    if (players.length < 2) return 'São necessários pelo menos 2 jogadores conectados.';

    for (const p of players) {
      p.lives = START_LIVES;
      p.eliminated = false;
      p.eliminatedOrder = 0;
      p.left = false;
      p.correct = 0;
    }
    this.phase = 'playing';
    this.winnerId = null;
    this.ranking = null;
    this.game = {
      theme: 'players', lastTheme: null,
      letter: '', lastLetter: '', lapStarter: '', round: 0, queue: [], currentId: null, status: 'turn',
      turnEndsAt: null, used: new Set(), history: [], historySeq: 0, eliminatedCount: 0,
    };
    this.fx({ type: 'start' });
    // Quem começa é sorteado, mas nunca o mesmo da partida anterior.
    const candidates = players.length > 1 ? players.filter((p) => p.id !== this.lastGameStarter) : players;
    const first = candidates[randomInt(candidates.length)];
    this.lastGameStarter = first.id;
    this.startLap(first.id);
    return null;
  }

  private startLap(startId: string) {
    const g = this.game!;
    const active = this.activePlayers();
    const idx = Math.max(0, active.findIndex((p) => p.id === startId));
    g.queue = [...active.slice(idx), ...active.slice(0, idx)].map((p) => p.id);
    g.lapStarter = g.queue[0];
    g.round++;
    g.lastLetter = g.letter;
    g.lastTheme = g.round > 1 ? g.theme : null;
    g.theme = this.drawTheme(active.length);
    g.letter = this.drawLetter(g.theme, active.length);
    this.fx({ type: 'letter', letter: g.letter, round: g.round, theme: g.theme });
    this.beginTurn(g.queue.shift()!);
  }

  /** No modo Surpresa sorteia um tema diferente do anterior que ainda tenha letras jogáveis. */
  private drawTheme(activeCount: number): Theme {
    if (this.settings.theme !== 'mixed') return this.settings.theme;
    const g = this.game!;
    const playable = THEME_IDS.filter((t) => t !== g.lastTheme && !ADULT_THEMES.includes(t) && this.eligibleLetters(t, activeCount).length > 0);
    const pool = playable.length ? playable : THEME_IDS.filter((t) => !ADULT_THEMES.includes(t));
    return pool[randomInt(pool.length)];
  }

  private eligibleLetters(theme: Theme, activeCount: number) {
    const index = NAME_INDEXES[theme];
    return LETTERS.map((l) => ({ l, n: index.available(l, this.game!.used) })).filter(
      // Basta ter respostas para a volta inteira, com um pouco de folga nas letras difíceis.
      ({ l, n }) => n >= activeCount + (HARD_LETTERS.has(l) ? 2 : 1),
    );
  }

  private drawLetter(theme: Theme, activeCount: number): string {
    const index = NAME_INDEXES[theme];
    const counts = LETTERS.map((l) => ({ l, n: index.available(l, this.game!.used) }));
    const eligible = this.eligibleLetters(theme, activeCount);
    if (!eligible.length) return counts.sort((a, b) => b.n - a.n)[0].l;
    // Prioriza as letras que estão há mais tempo sem sair (nunca sorteadas primeiro) e
    // sorteia entre o terço "mais esquecido", para não virar uma sequência previsível.
    const age = (l: string) => this.letterLastDraw.get(l) ?? -1;
    const byAge = [...eligible].sort((a, b) => age(a.l) - age(b.l));
    const never = byAge.filter(({ l }) => age(l) < 0);
    const pool = never.length ? never : byAge.slice(0, Math.max(1, Math.ceil(byAge.length / 3)));
    const letter = pool[randomInt(pool.length)].l;
    this.letterLastDraw.set(letter, ++this.letterDraws);
    return letter;
  }

  private beginTurn(playerId: string) {
    const g = this.game!;
    clearTimeout(g.timer);
    const ms = this.settings.turnTime * 1000;
    g.currentId = playerId;
    g.status = 'turn';
    g.turnEndsAt = Date.now() + ms;
    g.timer = setTimeout(() => this.explode(), ms);
    this.fx({ type: 'turn', playerId });
    this.broadcast();
  }

  private nextTurn() {
    const g = this.game!;
    if (this.phase !== 'playing') return;
    if (this.activePlayers().length <= 1) return this.finish();
    g.queue = g.queue.filter((id) => this.activePlayers().some((p) => p.id === id));
    if (g.queue.length) return this.beginTurn(g.queue.shift()!);
    // Volta completa: nova letra, e quem abre é o jogador seguinte a quem abriu a volta anterior.
    const seats = this.players;
    const curIdx = seats.findIndex((p) => p.id === g.lapStarter);
    for (let step = 1; step <= seats.length; step++) {
      const p = seats[(curIdx + step) % seats.length];
      if (!p.eliminated) return this.startLap(p.id);
    }
  }

  private explode() {
    const g = this.game;
    if (!g || this.phase !== 'playing' || g.status !== 'turn') return;
    const p = this.find(g.currentId ?? '');
    g.status = 'pause';
    g.turnEndsAt = null;
    if (p && !p.eliminated) {
      p.lives = Math.max(0, p.lives - 1);
      this.fx({ type: 'explode', playerId: p.id, lives: p.lives });
      if (p.lives === 0) this.eliminate(p, 'lives', false);
    }
    this.broadcast();
    g.timer = setTimeout(
      () => this.nextTurn(),
      this.activePlayers().length <= 1 ? END_DELAY_MS : PAUSE_AFTER_EXPLOSION_MS,
    );
  }

  private eliminate(p: Member, reason: 'lives' | 'left', advance = true) {
    const g = this.game!;
    p.eliminated = true;
    p.lives = 0;
    p.eliminatedOrder = ++g.eliminatedCount;
    this.fx({ type: 'eliminated', playerId: p.id, reason });
    // Se quem saiu estava com a bomba, passa a vez sem travar a partida.
    if (advance && g.currentId === p.id && g.status === 'turn') {
      clearTimeout(g.timer);
      g.status = 'pause';
      g.turnEndsAt = null;
      g.timer = setTimeout(() => this.nextTurn(), 600);
    } else if (advance && this.activePlayers().length <= 1) {
      clearTimeout(g.timer);
      g.timer = setTimeout(() => this.finish(), END_DELAY_MS);
    }
  }

  answer(by: string, raw: unknown): AnswerResult {
    const g = this.game;
    const m = this.find(by);
    if (!g || !m || this.phase !== 'playing') return { ok: false, reason: 'Nenhuma partida em andamento.' };
    if (m.role !== 'player' || m.eliminated) return { ok: false, reason: 'Você está assistindo esta partida.' };
    if (g.currentId !== m.id || g.status !== 'turn') return { ok: false, reason: 'Não é a sua vez!' };
    const now = Date.now();
    if (now - m.lastAnswerAt < MIN_ANSWER_INTERVAL_MS) return { ok: false, reason: 'Calma! Uma resposta por vez.' };
    m.lastAnswerAt = now;

    const text = String(raw ?? '').trim().slice(0, 60);
    const key = normalize(text);
    const kind = THEMES[g.theme].noun;
    if (!key) return { ok: false, reason: 'Digite uma resposta.' };
    if (key[0].toUpperCase() !== g.letter) return { ok: false, reason: `Precisa começar com a letra ${g.letter}.` };

    const result = NAME_INDEXES[g.theme].lookup(text, g.used);
    if (result.status === 'unknown') recordRejected(g.theme, text);
    if (result.status === 'unknown') return { ok: false, reason: `"${text}" não foi reconhecido como ${kind}. Tente outro!` };
    if (result.status === 'used') return { ok: false, reason: `${result.entity.name} já foi usado nesta partida.` };

    clearTimeout(g.timer);
    g.used.add(result.entity.id);
    m.correct++;
    g.history.unshift({ id: ++g.historySeq, playerId: m.id, playerName: m.name, typed: text, canonical: result.entity.name });
    g.history = g.history.slice(0, 30);
    this.fx({ type: 'correct', playerId: m.id, canonical: result.entity.name, typed: text });
    this.nextTurn();
    return { ok: true, canonical: result.entity.name };
  }

  typing(by: string, raw: unknown) {
    const g = this.game;
    if (!g || g.currentId !== by || g.status !== 'turn') return;
    this.io.to(this.code).emit('game:typing', { playerId: by, text: String(raw ?? '').slice(0, 60) });
  }

  private finish() {
    const g = this.game!;
    clearTimeout(g.timer);
    g.status = 'pause';
    g.turnEndsAt = null;
    g.currentId = null;
    this.phase = 'ended';
    const winner = this.activePlayers()[0] ?? null;
    this.winnerId = winner?.id ?? null;
    const others = this.players
      .filter((p) => p !== winner)
      .sort((a, b) => b.eliminatedOrder - a.eliminatedOrder);
    this.ranking = [...(winner ? [winner] : []), ...others].map((p, i) => ({
      playerId: p.id, name: p.name, avatar: p.avatar, place: i + 1, correct: p.correct, left: p.left,
    }));
    this.fx({ type: 'winner', playerId: this.winnerId });
    this.broadcast();
  }

  /** "Jogar novamente": volta à sala de espera (ou reinicia direto). */
  restart(by: string, startNow: boolean): string | null {
    if (by !== this.hostId) return 'Só o anfitrião pode reiniciar.';
    if (this.phase !== 'ended') return null;
    this.resetToLobby(true);
    return startNow ? this.start(by) : null;
  }

  private resetToLobby(broadcast: boolean) {
    // Remove quem saiu durante a partida e dá lugar aos espectadores.
    this.members = this.members.filter((m) => !m.left);
    for (const m of this.members) {
      m.lives = START_LIVES;
      m.eliminated = false;
      m.correct = 0;
    }
    for (const s of this.members.filter((m) => m.role === 'spectator' && m.connected)) {
      if (this.players.length < this.settings.maxPlayers) s.role = 'player';
    }
    this.phase = 'lobby';
    this.game = null;
    this.winnerId = null;
    this.ranking = null;
    if (!this.find(this.hostId)) this.pickNewHost();
    if (broadcast) this.broadcast();
  }

  destroy() {
    clearTimeout(this.game?.timer);
    for (const m of this.members) clearTimeout(m.graceTimer);
  }

  // ---------- comunicação ----------

  private touch() {
    this.lastActivity = Date.now();
  }

  private fx(fx: GameFx) {
    this.io.to(this.code).emit('game:fx', fx);
  }

  snapshot(): PublicRoom {
    const g = this.game;
    const host = this.find(this.hostId);
    return {
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, lives: m.lives, connected: m.connected,
        eliminated: m.eliminated, left: m.left, correct: m.correct,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      game: g && {
        theme: g.theme, letter: g.letter, round: g.round, currentPlayerId: g.currentId, status: g.status,
        turnEndsAt: g.turnEndsAt, turnDuration: this.settings.turnTime * 1000, history: g.history.slice(0, 12),
      },
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
