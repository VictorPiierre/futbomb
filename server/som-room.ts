import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  SOM_COUNTDOWN_MS, SOM_MAX_CLIP_BYTES, SOM_MAX_PLAYERS, SOM_RECORD_TIMES, SOM_RESULTS_MS, SOM_ROUNDS, SOM_SLOT_MS,
  SOM_CUSTOM_MAX, SOM_CUSTOM_MAX_BYTES, SOM_CUSTOM_TITLE_MAX, SOM_VOTE_EXTRA_MS, SOM_VOTE_POINTS, SOM_WIN_POINTS,
  type SomClip, type SomCustomSound, type SomPhase, type SomPublicRoom, type SomResult, type SomSettings, type SomSound,
} from '../shared/som.ts';
import { SOM_CATEGORIES, SOM_DIFFICULTIES, SOM_LIBRARY, type SomCategory, type SomDifficulty } from '../shared/som-library.ts';
import { SOM_DIFF_WEIGHTS } from '../shared/som.ts';

const MAX_MEMBERS = 16;
const GRACE_LOBBY_MS = 20_000;
const GRACE_GAME_MS = 60_000;
const ALL_IN_DELAY_MS = 800;
/** Testes automáticos aceleram a partida (ex.: SOM_PACE=0.1). */
const PACE = Number(process.env.SOM_PACE) || 1;
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
  /** Slot da imitação em que votou. */
  vote: number | null;
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
  settings: SomSettings = { theme: 'mix', difficulty: 'sortear', rounds: 5, recordTime: 20, maxPlayers: 8 };
  phase: SomPhase = 'lobby';
  members: Member[] = [];
  lastActivity = Date.now();

  private round = 0;
  private sound: SomSound | null = null;
  private playAt: number | null = null;
  private endsAt: number | null = null;
  private playlistAt: number | null = null;
  /** Ordem das imitações na votação: slot (1..n) -> id do jogador. */
  private slots: string[] = [];
  private results: SomResult[] | null = null;
  private gained: Record<string, number> | null = null;
  private ranking: SomPublicRoom['ranking'] = null;
  private winnerId: string | null = null;
  private timer?: NodeJS.Timeout;
  private used = new Set<string>();
  /** Sons enviados pelos jogadores (o áudio fica só na memória do servidor). */
  private custom: (SomCustomSound & { data: Buffer })[] = [];

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
      connected: true, role: canPlay ? 'player' : 'spectator', left: false, score: 0, clip: null, vote: null,
    };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    this.touch();
    // Entrou no meio da votação/resultado: recebe as gravações para poder ouvir.
    if (this.phase === 'vote' || this.phase === 'results') setTimeout(() => this.sendClips(m), 0);
    setTimeout(() => this.sendCustom(m.socketId), 0);
    return m;
  }

  reconnect(m: Member, socketId: string) {
    clearTimeout(m.graceTimer);
    m.socketId = socketId;
    m.connected = true;
    this.touch();
    setTimeout(() => this.sendMine(m), 0);
    setTimeout(() => this.sendCustom(m.socketId), 0);
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
    if (patch.theme === 'mix' || (patch.theme === 'sala' && this.custom.length) || (typeof patch.theme === 'string' && SOM_LIBRARY.some((x) => x.cat === patch.theme))) s.theme = patch.theme;
    if (patch.difficulty === 'sortear' || (typeof patch.difficulty === 'string' && patch.difficulty in SOM_DIFFICULTIES)) s.difficulty = patch.difficulty;
    if (SOM_ROUNDS.includes(patch.rounds as never)) s.rounds = patch.rounds!;
    if (SOM_RECORD_TIMES.includes(patch.recordTime as never)) s.recordTime = patch.recordTime!;
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
      m.vote = null;
    }
    this.phase = 'lobby';
    this.sound = null;
    this.playAt = null;
    this.playlistAt = null;
    this.slots = [];
    this.results = null;
    this.gained = null;
    this.ranking = null;
    this.winnerId = null;
  }

  /**
   * Sorteia um som ainda não usado do tema escolhido, na dificuldade escolhida (ou sorteada).
   * Se faltar som naquela dificuldade, usa qualquer dificuldade do tema. No "misturado", evita repetir a categoria seguida.
   */
  private pickSound(): SomSound {
    const theme = this.settings.theme === 'sala' && !this.custom.length ? 'mix' : this.settings.theme;
    const lib: SomSound[] = [...SOM_LIBRARY, ...this.custom.map((c) => ({ id: c.id, title: c.title, emoji: c.emoji, cat: c.cat, diff: c.diff, custom: true }))];
    // No "misturado", os sons enviados pelos amigos aparecem com prioridade (metade das vezes, enquanto houver inéditos).
    const freshCustom = lib.filter((s) => s.custom && !this.used.has(s.id));
    if (theme === 'mix' && freshCustom.length && randomInt(2) === 0) {
      const s = freshCustom[randomInt(freshCustom.length)];
      this.used.add(s.id);
      return s;
    }
    const inTheme = lib.filter((s) => (theme === 'sala' ? s.custom : theme === 'mix' || s.cat === theme));
    const all = inTheme.length ? inTheme : lib;
    let free = all.filter((s) => !this.used.has(s.id));
    if (!free.length) {
      for (const s of all) this.used.delete(s.id);
      free = all;
    }
    let diff: SomDifficulty;
    if (this.settings.difficulty === 'sortear') {
      const available = (Object.keys(SOM_DIFF_WEIGHTS) as SomDifficulty[]).filter((d) => free.some((s) => s.diff === d));
      const total = available.reduce((n, d) => n + SOM_DIFF_WEIGHTS[d], 0);
      let r = randomInt(Math.max(1, total));
      diff = available.find((d) => (r -= SOM_DIFF_WEIGHTS[d]) < 0) ?? 'dificil';
    } else diff = this.settings.difficulty;
    const ofDiff = free.filter((s) => s.diff === diff);
    let pool = ofDiff.length ? ofDiff : free;
    if (theme === 'mix') {
      const other = pool.filter((s) => s.cat !== this.sound?.cat);
      if (other.length) pool = other;
    }
    const s = pool[randomInt(pool.length)];
    this.used.add(s.id);
    return { id: s.id, title: s.title, emoji: s.emoji, cat: s.cat, diff: s.diff, ...(s.custom ? { custom: true } : {}) };
  }

  // ---------- sons enviados pela sala ----------

  addCustom(by: string, meta: { title?: unknown; emoji?: unknown; cat?: unknown; diff?: unknown }, data: unknown): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m) return { ok: false, error: 'Sala não encontrada.' };
    if (this.phase !== 'lobby' && this.phase !== 'ended') return { ok: false, error: 'Dá para adicionar sons só na sala de espera.' };
    if (this.custom.length >= SOM_CUSTOM_MAX) return { ok: false, error: `A sala já tem ${SOM_CUSTOM_MAX} sons enviados.` };
    const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
    if (!buf || buf.length < 500) return { ok: false, error: 'Áudio vazio.' };
    if (buf.length > SOM_CUSTOM_MAX_BYTES) return { ok: false, error: 'Áudio grande demais.' };
    // Só aceitamos o WAV que o próprio site gera (cortado e com volume ajustado).
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, error: 'Formato de áudio inválido.' };
    const title = String(meta?.title ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, SOM_CUSTOM_TITLE_MAX);
    if (!title) return { ok: false, error: 'Dê um nome para o som.' };
    const emoji = [...String(meta?.emoji ?? '')].slice(0, 2).join('') || '🔊';
    const cat = String(meta?.cat) as SomCategory;
    const diff = String(meta?.diff) as SomDifficulty;
    if (!(cat in SOM_CATEGORIES)) return { ok: false, error: 'Tema inválido.' };
    if (!(diff in SOM_DIFFICULTIES)) return { ok: false, error: 'Dificuldade inválida.' };
    const sound = { id: `sala-${randomBytes(5).toString('hex')}`, title, emoji, cat, diff, byId: m.id, byName: m.name, data: buf };
    this.custom.push(sound);
    this.io.to(this.code).emit('som:custom', { sounds: [{ id: sound.id, data: this.arrayOf(buf) }] });
    this.broadcast();
    return { ok: true };
  }

  removeCustom(by: string, id: unknown) {
    const s = this.custom.find((c) => c.id === id);
    if (!s || (by !== s.byId && by !== this.hostId)) return;
    this.custom = this.custom.filter((c) => c !== s);
    if (this.settings.theme === 'sala' && !this.custom.length) this.settings = { ...this.settings, theme: 'mix' };
    this.broadcast();
  }

  private arrayOf(buf: Buffer) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  /** Manda os áudios enviados na sala para quem acabou de entrar/voltar. */
  private sendCustom(socketId: string | null) {
    if (!socketId || !this.custom.length) return;
    this.io.to(socketId).emit('som:custom', { sounds: this.custom.map((c) => ({ id: c.id, data: this.arrayOf(c.data) })) });
  }

  private nextRound() {
    clearTimeout(this.timer);
    this.round++;
    this.sound = this.pickSound();
    this.slots = [];
    this.results = null;
    this.gained = null;
    this.playlistAt = null;
    for (const m of this.members) {
      m.clip = null;
      m.vote = null;
    }
    this.phase = 'record';
    const now = Date.now();
    this.playAt = now + ms(SOM_COUNTDOWN_MS);
    this.endsAt = this.playAt + ms(this.settings.recordTime * 1000);
    this.timer = setTimeout(() => this.startVote(), this.endsAt - now);
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
    this.phase = 'vote';
    const now = Date.now();
    // Um tempinho para as gravações chegarem a todos antes de começar a tocar.
    this.playlistAt = now + ms(1500);
    const playlistEnd = this.playlistAt + ms(SOM_SLOT_MS) * (this.slots.length + 1);
    this.endsAt = playlistEnd + ms(SOM_VOTE_EXTRA_MS);
    this.timer = setTimeout(() => this.showResults(), this.endsAt - now);
    for (const m of this.members) this.sendClips(m);
    this.broadcast();
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
    this.io.to(m.socketId).emit('som:mine', { round: this.round, recorded: !!m.clip, vote: m.vote });
  }

  vote(by: string, slot: unknown): { ok: boolean; error?: string } {
    const m = this.find(by);
    if (!m || m.role !== 'player' || m.left) return { ok: false, error: 'Você está assistindo.' };
    if (this.phase !== 'vote') return { ok: false, error: 'Agora não é hora de votar.' };
    const n = Number(slot);
    const target = Number.isInteger(n) ? this.slots[n - 1] : undefined;
    if (!target) return { ok: false, error: 'Imitação inválida.' };
    if (target === m.id) return { ok: false, error: 'Não vale votar em você mesmo! 😏' };
    const first = m.vote === null;
    m.vote = n;
    if (first) this.broadcast();
    this.checkAllIn();
    return { ok: true };
  }

  /** Quem pode votar: jogador ativo e conectado que tenha alguma imitação que não seja a dele. */
  private voters() {
    return this.activePlayers().filter((p) => p.connected && this.slots.some((id) => id !== p.id));
  }

  private checkAllIn() {
    if (this.phase === 'record') {
      if (Date.now() < (this.playAt ?? 0)) return;
      const active = this.activePlayers().filter((p) => p.connected);
      if (active.length && active.every((p) => p.clip)) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.startVote(), ALL_IN_DELAY_MS);
      }
    } else if (this.phase === 'vote') {
      const voters = this.voters();
      if (voters.length && voters.every((p) => p.vote !== null)) {
        // Todos votaram: espera a sequência de áudios terminar (para ninguém perder nenhuma imitação).
        clearTimeout(this.timer);
        const playlistEnd = (this.playlistAt ?? 0) + ms(SOM_SLOT_MS) * (this.slots.length + 1);
        this.timer = setTimeout(() => this.showResults(), Math.max(ALL_IN_DELAY_MS, playlistEnd - Date.now()));
      }
    }
  }

  private showResults() {
    if (this.phase !== 'record' && this.phase !== 'vote') return;
    clearTimeout(this.timer);
    const players = this.activePlayers();
    const gained: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
    const results: SomResult[] = this.slots.map((id, i) => ({
      playerId: id,
      slot: i + 1,
      voters: players.filter((p) => p.vote === i + 1).map((p) => p.id),
      winner: false,
    }));
    const top = Math.max(0, ...results.map((r) => r.voters.length));
    for (const r of results) {
      r.winner = top > 0 && r.voters.length === top;
      if (r.playerId in gained) gained[r.playerId] += r.voters.length * SOM_VOTE_POINTS + (r.winner ? SOM_WIN_POINTS : 0);
    }
    for (const p of players) p.score += gained[p.id];
    results.sort((a, b) => b.voters.length - a.voters.length || a.slot - b.slot);
    this.results = results;
    this.gained = gained;
    this.phase = 'results';
    this.playAt = null;
    const wait = ms(SOM_RESULTS_MS);
    this.endsAt = Date.now() + wait;
    this.timer = setTimeout(() => this.advance(), wait);
    this.broadcast();
  }

  next(by: string) {
    if (by === this.hostId && this.phase === 'results') this.advance();
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
        done: this.phase === 'record' ? m.clip !== null : this.phase === 'vote' ? m.vote !== null : false,
      })),
      spectators: this.members
        .filter((m) => m.role === 'spectator')
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connected })),
      round: this.round,
      sound: this.phase === 'lobby' ? null : this.sound,
      playAt: this.phase === 'record' ? this.playAt : null,
      endsAt: this.endsAt,
      clipCount: this.slots.length,
      customSounds: this.custom.map(({ data: _data, ...meta }) => meta),
      playlistAt: this.phase === 'vote' ? this.playlistAt : null,
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
