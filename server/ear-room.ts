import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  EAR_BEST_BONUS, EAR_COUNTDOWN_MS, EAR_DIFFICULTIES, EAR_LANGS, EAR_MAX_PLAYERS, EAR_REVEAL_MS, EAR_ROUNDS, EAR_SPEAK_MS, EAR_TIMES,
  earPoints, similarity,
  type EarLang, type EarPhase, type EarPublicRoom, type EarResult, type EarSay, type EarSettings,
} from '../shared/ear.ts';
import { EAR_WORDS, type EarWord } from './ear-words.ts';

const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
const ALL_IN_DELAY_MS = 700;
const MAX_ANSWER = 60;

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
  answer: string | null;
  graceTimer?: NodeJS.Timeout;
}

export class EarRoom {
  readonly kind = 'ear';
  readonly code: string;
  hostId = '';
  settings: EarSettings = { langs: ['en', 'es', 'fr', 'it', 'de'], difficulty: 'easy', rounds: 10, answerTime: 15, maxPlayers: 10 };
  phase: EarPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private round = 0;
  private current: EarWord | null = null;
  private speakAt: number | null = null;
  private endsAt: number | null = null;
  private results: EarResult[] | null = null;
  private ranking: EarPublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;
  private used = new Set<string>();
  private lastLang: EarLang | null = null;

  constructor(code: string, private io: Server, private onEmpty: (room: EarRoom) => void) {
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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, answer: null,
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
    this.io.to(socketId).emit('ear:mine', { round: this.round, answer: m.answer });
    // Voltou antes da palavra ser dita: ainda dá tempo de ouvir (só uma vez, como todo mundo).
    if (this.phase === 'question' && this.speakAt && Date.now() < this.speakAt) this.io.to(socketId).emit('ear:say', this.sayPayload());
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

  updateSettings(by: string, patch: Partial<EarSettings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (Array.isArray(patch.langs)) {
      const langs = [...new Set(patch.langs.filter((l): l is EarLang => typeof l === 'string' && l in EAR_LANGS))];
      if (langs.length >= 1) s.langs = langs;
    }
    if (patch.difficulty && patch.difficulty in EAR_DIFFICULTIES) s.difficulty = patch.difficulty;
    if (EAR_ROUNDS.includes(patch.rounds as never)) s.rounds = patch.rounds!;
    if (EAR_TIMES.includes(patch.answerTime as never)) s.answerTime = patch.answerTime!;
    if (EAR_MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) s.maxPlayers = patch.maxPlayers!;
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
      m.answer = null;
    }
    this.phase = 'lobby';
    this.current = null;
    this.results = null;
    this.ranking = null;
    this.winnerId = null;
  }

  /** Sorteia o idioma (evitando repetir o anterior) e uma palavra ainda não usada nesta sala. */
  private pickWord(): EarWord {
    const d = this.settings.difficulty;
    let langs = this.settings.langs.filter((l) => EAR_WORDS[l][d].some((w) => !this.used.has(w.id)));
    if (!langs.length) {
      for (const l of this.settings.langs) for (const w of EAR_WORDS[l][d]) this.used.delete(w.id);
      langs = this.settings.langs;
    }
    const pool = langs.length > 1 ? langs.filter((l) => l !== this.lastLang) : langs;
    const lang = pool[randomInt(pool.length)];
    const free = EAR_WORDS[lang][d].filter((w) => !this.used.has(w.id));
    return free[randomInt(free.length)];
  }

  private nextRound() {
    clearTimeout(this.timer);
    const w = this.pickWord();
    this.used.add(w.id);
    this.lastLang = w.lang;
    this.current = w;
    this.round++;
    this.results = null;
    for (const m of this.members) m.answer = null;
    this.phase = 'question';
    this.speakAt = Date.now() + EAR_COUNTDOWN_MS;
    const ms = EAR_COUNTDOWN_MS + EAR_SPEAK_MS + this.settings.answerTime * 1000;
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => this.reveal(), ms);
    this.broadcast();
    this.io.to(this.code).emit('ear:say', this.sayPayload());
  }

  private sayPayload(): EarSay {
    return {
      round: this.round,
      lang: this.current!.lang,
      speakAt: this.speakAt!,
      audio: this.current!.audio,
    };
  }

  answer(by: string, raw: unknown): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'question') return { ok: false, error: 'Agora não dá para responder.' };
    if (Date.now() < this.speakAt!) return { ok: false, error: 'Espere a palavra!' };
    const text = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_ANSWER);
    if (!text) return { ok: false, error: 'Escreva o que você ouviu.' };
    const first = m.answer === null;
    m.answer = text;
    if (first) this.broadcast();
    this.checkAllIn();
    return { ok: true };
  }

  private checkAllIn() {
    if (this.phase !== 'question') return;
    const active = this.activePlayers().filter((p) => p.connected);
    if (active.length && active.every((p) => p.answer !== null)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reveal(), ALL_IN_DELAY_MS);
    }
  }

  private reveal() {
    if (this.phase !== 'question' || !this.current) return;
    clearTimeout(this.timer);
    const w = this.current;
    const results: EarResult[] = this.activePlayers().map((p) => {
      const sim = p.answer === null ? 0 : similarity(p.answer, w.answers);
      return { playerId: p.id, answer: p.answer, similarity: Math.round(sim * 100), exact: sim >= 1, best: false, points: earPoints(sim) };
    });
    // Bônus para quem chegou mais perto (empate: todos levam).
    const top = Math.max(0, ...results.map((r) => r.similarity));
    if (top > 0) {
      for (const r of results) {
        if (r.similarity === top && r.points > 0) {
          r.best = true;
          r.points += EAR_BEST_BONUS;
        }
      }
    }
    for (const r of results) this.find(r.playerId)!.score += r.points;
    results.sort((a, b) => b.similarity - a.similarity);
    this.results = results;
    this.phase = 'reveal';
    this.speakAt = null;
    this.endsAt = Date.now() + EAR_REVEAL_MS;
    this.timer = setTimeout(() => this.advance(), EAR_REVEAL_MS);
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
    this.speakAt = null;
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

  snapshot(): EarPublicRoom {
    const host = this.find(this.hostId);
    const w = this.current;
    const shown = this.phase === 'reveal' || this.phase === 'ended';
    return {
      kind: 'ear',
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, connected: m.connected, left: m.left, score: m.score, answered: m.answer !== null,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      round: this.round,
      lang: this.phase === 'lobby' ? null : (w?.lang ?? null),
      speakAt: this.phase === 'question' ? this.speakAt : null,
      endsAt: this.endsAt,
      word: shown && w ? { say: w.say, answers: w.answers, meaning: w.meaning, audio: w.audio } : null,
      results: shown ? this.results : null,
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
