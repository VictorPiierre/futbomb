import type { PublicSpectator } from './types.ts';

export interface DubScene {
  id: string;
  /** ID do vídeo no YouTube. */
  video: string;
  /** Trecho usado, em segundos. */
  start: number;
  end: number;
  title: string;
}

export const DUB_ROUNDS = [3, 5, 8] as const;
export const DUB_MAX_PLAYERS = [4, 6, 8] as const;
/** Trecho máximo de uma cena (cenas maiores são cortadas). */
export const DUB_MAX_CLIP_S = 60;
/** Tamanho máximo da gravação enviada. */
export const DUB_MAX_AUDIO_BYTES = 3_000_000;
/** Pausa entre uma dublagem e outra na exibição. */
export const DUB_SHOW_GAP_MS = 2500;
export const DUB_VOTE_MS = 30_000;
export const DUB_RESULTS_MS = 12_000;

export interface DubSettings {
  rounds: (typeof DUB_ROUNDS)[number];
  maxPlayers: (typeof DUB_MAX_PLAYERS)[number];
}

/** lobby -> watch (cena original) -> record -> show (dublagens) -> vote -> results -> ... -> ended */
export type DubPhase = 'lobby' | 'watch' | 'record' | 'show' | 'vote' | 'results' | 'ended';

export interface DubPlayer {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  left: boolean;
  score: number;
  /** Já enviou a dublagem desta rodada. */
  submitted: boolean;
  voted: boolean;
}

export interface DubPublicRoom {
  kind: 'dub';
  code: string;
  hostId: string;
  hostName: string;
  settings: DubSettings;
  phase: DubPhase;
  players: DubPlayer[];
  spectators: PublicSpectator[];
  round: number;
  scene: DubScene | null;
  /** Cenas próprias que o anfitrião colocou na fila. */
  queue: DubScene[];
  /** Momento em que a fase atual começou/acaba (relógio do servidor). */
  startsAt: number | null;
  endsAt: number | null;
  /** Exibição: ordem das dublagens e qual está passando. */
  showOrder: string[];
  showIndex: number;
  /** Votos recebidos por dublagem (só nos resultados). */
  votes: Record<string, number> | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}

/** Extrai o ID de um link do YouTube (watch, youtu.be, shorts, embed). */
export function youtubeId(link: string): string | null {
  const s = link.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/** "1:23" ou "83" -> segundos. */
export function parseTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
