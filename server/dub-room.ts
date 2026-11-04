import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'socket.io';
import {
  DUB_MAX_AUDIO_BYTES, DUB_MAX_CLIP_S, DUB_MAX_PLAYERS, DUB_RESULTS_MS, DUB_ROUNDS, DUB_SHOW_GAP_MS, DUB_VOTE_MS,
  parseTime, youtubeId,
  type DubPhase, type DubPublicRoom, type DubScene, type DubSettings,
} from '../shared/dub.ts';

const SCENES: DubScene[] = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dub', 'scenes.json'), 'utf8'),
);
const MAX_MEMBERS = 12;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
/** Tempo para todos carregarem o vídeo antes de começar a tocar. */
const PREP_MS = 3000;
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|aac|x-m4a)/;

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
  vote: string | null;
  graceTimer?: NodeJS.Timeout;
}

export class DubRoom {
  readonly kind = 'dub';
  readonly code: string;
  hostId = '';
  settings: DubSettings = { rounds: 3, maxPlayers: 8 };
  phase: DubPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private round = 0;
  private scene: DubScene | null = null;
  private queue: DubScene[] = [];
  private usedScenes = new Set<string>();
  private startsAt: number | null = null;
  private endsAt: number | null = null;
  private audios = new Map<string, { mime: string; data: Buffer }>();
  private showOrder: string[] = [];
  private showIndex = 0;
  private votes: Record<string, number> | null = null;
  private ranking: DubPublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;

  constructor(code: string, private io: Server, private onEmpty: (room: DubRoom) => void) {
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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, vote: null,
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
    // Quem voltou no meio da exibição/votação recebe as gravações de novo.
    if (this.phase === 'show' || this.phase === 'vote' || this.phase === 'results') this.sendClips(socketId);
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

  updateSettings(by: string, patch: Partial<DubSettings>) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const s = { ...this.settings };
    if (DUB_ROUNDS.includes(patch.rounds as never)) s.rounds = patch.rounds!;
    if (DUB_MAX_PLAYERS.includes(patch.maxPlayers as never) && patch.maxPlayers! >= this.players.length) s.maxPlayers = patch.maxPlayers!;
    this.settings = s;
    this.broadcast();
  }

  /** Anfitrião coloca uma cena própria (link do YouTube) na fila. */
  addScene(by: string, payload: { link?: unknown; start?: unknown; end?: unknown }): { ok: boolean; error?: string } {
    if (by !== this.hostId) return { ok: false, error: 'Só o anfitrião escolhe as cenas.' };
    if (this.queue.length >= 10) return { ok: false, error: 'A fila já tem 10 cenas.' };
    const video = youtubeId(String(payload?.link ?? ''));
    if (!video) return { ok: false, error: 'Link do YouTube inválido.' };
    const start = parseTime(String(payload?.start ?? '0')) ?? 0;
    let end = parseTime(String(payload?.end ?? '')) ?? start + 30;
    if (end <= start) return { ok: false, error: 'O fim precisa ser depois do início.' };
    end = Math.min(end, start + DUB_MAX_CLIP_S);
    this.queue.push({ id: `custom-${randomUUID().slice(0, 6)}`, video, start, end, title: 'Cena escolhida pelo anfitrião' });
    this.broadcast();
    return { ok: true };
  }

  removeScene(by: string, index: unknown) {
    if (by !== this.hostId || typeof index !== 'number') return;
    this.queue.splice(index, 1);
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
      m.vote = null;
    }
    this.phase = 'lobby';
    this.scene = null;
    this.audios.clear();
    this.votes = null;
    this.ranking = null;
    this.winnerId = null;
  }

  private pickScene(): DubScene {
    const fromQueue = this.queue.shift();
    if (fromQueue) return fromQueue;
    let pool = SCENES.filter((s) => !this.usedScenes.has(s.id));
    if (!pool.length) {
      this.usedScenes.clear();
      pool = SCENES;
    }
    const s = pool[randomInt(pool.length)];
    this.usedScenes.add(s.id);
    return s;
  }

  private clipMs() {
    return (this.scene!.end - this.scene!.start) * 1000;
  }

  private nextRound() {
    clearTimeout(this.timer);
    this.round++;
    this.scene = this.pickScene();
    this.audios.clear();
    this.votes = null;
    for (const m of this.members) m.vote = null;
    // 1) Todos assistem à cena original.
    this.phase = 'watch';
    this.startsAt = Date.now() + PREP_MS;
    this.endsAt = this.startsAt + this.clipMs() + 1500;
    this.timer = setTimeout(() => this.startRecording(), this.endsAt - Date.now());
    this.broadcast();
  }

  /** Anfitrião pode pedir para ver a cena original de novo. */
  rewatch(by: string) {
    if (by !== this.hostId || this.phase !== 'watch') return;
    clearTimeout(this.timer);
    this.startsAt = Date.now() + 1500;
    this.endsAt = this.startsAt + this.clipMs() + 1500;
    this.timer = setTimeout(() => this.startRecording(), this.endsAt - Date.now());
    this.broadcast();
  }

  private startRecording() {
    clearTimeout(this.timer);
    this.phase = 'record';
    this.startsAt = Date.now();
    // Tempo para gravar, ouvir e regravar algumas vezes.
    const ms = Math.min(240_000, this.clipMs() * 3 + 45_000);
    this.endsAt = this.startsAt + ms;
    this.timer = setTimeout(() => this.startShow(), ms);
    this.broadcast();
  }

  audio(by: string, payload: { round?: unknown; mime?: unknown; data?: unknown }): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'record' || payload?.round !== this.round) return { ok: false, error: 'A gravação desta rodada já acabou.' };
    const mime = String(payload?.mime ?? '');
    const data = payload?.data;
    if (!AUDIO_TYPES.test(mime)) return { ok: false, error: 'Formato de áudio não suportado.' };
    const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : null;
    if (!buf || buf.length < 500) return { ok: false, error: 'A gravação veio vazia.' };
    if (buf.length > DUB_MAX_AUDIO_BYTES) return { ok: false, error: 'A gravação ficou grande demais.' };
    this.audios.set(m.id, { mime, data: buf });
    this.broadcast();
    this.checkAllIn();
    return { ok: true };
  }

  private checkAllIn() {
    const active = this.activePlayers().filter((p) => p.connected);
    if (this.phase === 'record' && active.length && active.every((p) => this.audios.has(p.id))) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.startShow(), 1200);
    }
    if (this.phase === 'vote') {
      const voters = active.filter((p) => this.canVote(p.id));
      if (voters.every((p) => p.vote)) this.showResults();
    }
  }

  private sendClips(target: string) {
    const clips = this.showOrder.map((id) => {
      const a = this.audios.get(id)!;
      return { playerId: id, mime: a.mime, data: a.data };
    });
    this.io.to(target).emit('dub:clips', { round: this.round, clips });
  }

  private startShow() {
    clearTimeout(this.timer);
    this.showOrder = [...this.audios.keys()].sort(() => Math.random() - 0.5);
    if (!this.showOrder.length) {
      // Ninguém gravou: segue para a próxima rodada.
      return this.round >= this.settings.rounds ? this.finish() : this.nextRound();
    }
    this.phase = 'show';
    this.sendClips(this.code);
    this.showIndex = -1;
    this.nextShow();
  }

  private nextShow() {
    clearTimeout(this.timer);
    this.showIndex++;
    if (this.showIndex >= this.showOrder.length) return this.startVote();
    this.startsAt = Date.now() + PREP_MS;
    this.endsAt = this.startsAt + this.clipMs() + DUB_SHOW_GAP_MS;
    this.timer = setTimeout(() => this.nextShow(), this.endsAt - Date.now());
    this.broadcast();
  }

  /** Anfitrião pode pular para a próxima dublagem. */
  skip(by: string) {
    if (by !== this.hostId) return;
    if (this.phase === 'watch') this.startRecording();
    else if (this.phase === 'show') this.nextShow();
    else if (this.phase === 'results') this.advance();
  }

  /** Só vota quem tem pelo menos uma dublagem de outra pessoa para escolher. */
  private canVote(id: string) {
    return this.showOrder.some((x) => x !== id);
  }

  private startVote() {
    clearTimeout(this.timer);
    this.phase = 'vote';
    this.startsAt = Date.now();
    this.endsAt = this.startsAt + DUB_VOTE_MS;
    this.timer = setTimeout(() => this.showResults(), DUB_VOTE_MS);
    this.broadcast();
    this.checkAllIn();
  }

  vote(by: string, target: unknown) {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left || this.phase !== 'vote') return;
    if (typeof target !== 'string' || target === by || !this.showOrder.includes(target)) return;
    m.vote = target;
    this.broadcast();
    this.checkAllIn();
  }

  private showResults() {
    if (this.phase !== 'vote') return;
    clearTimeout(this.timer);
    const votes: Record<string, number> = Object.fromEntries(this.showOrder.map((id) => [id, 0]));
    for (const p of this.activePlayers()) if (p.vote && p.vote in votes) votes[p.vote]++;
    // Cada voto vale 1 ponto; a dublagem mais votada da rodada ganha +1.
    const best = Math.max(...Object.values(votes));
    for (const [id, n] of Object.entries(votes)) {
      const p = this.find(id);
      if (p) p.score += n + (best > 0 && n === best ? 1 : 0);
    }
    this.votes = votes;
    this.phase = 'results';
    this.startsAt = Date.now();
    this.endsAt = this.startsAt + DUB_RESULTS_MS;
    this.timer = setTimeout(() => this.advance(), DUB_RESULTS_MS);
    this.broadcast();
  }

  private advance() {
    clearTimeout(this.timer);
    if (this.round >= this.settings.rounds || this.activePlayers().length < 2) this.finish();
    else this.nextRound();
  }

  private finish() {
    clearTimeout(this.timer);
    this.phase = 'ended';
    this.startsAt = this.endsAt = null;
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

  snapshot(): DubPublicRoom {
    const host = this.find(this.hostId);
    return {
      kind: 'dub',
      code: this.code,
      hostId: this.hostId,
      hostName: host?.name ?? '',
      settings: this.settings,
      phase: this.phase,
      players: this.players.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, connected: m.connected, left: m.left, score: m.score,
        submitted: this.audios.has(m.id), voted: !!m.vote,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      round: this.round,
      scene: this.scene,
      queue: this.queue,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      showOrder: this.phase === 'show' || this.phase === 'vote' || this.phase === 'results' ? this.showOrder : [],
      showIndex: this.showIndex,
      votes: this.phase === 'results' ? this.votes : null,
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
