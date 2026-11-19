import type { PublicSpectator } from './types.ts';

/**
 * Faz Esse Som!: toca um som curtinho, cada um tenta imitar no microfone,
 * depois todo mundo ouve as imitações e vota na melhor (não vale votar em si mesmo).
 */
export const SOM_ROUNDS = [3, 5, 8] as const;
/** Segundos para ouvir e gravar a imitação. */
export const SOM_RECORD_TIMES = [15, 20, 30] as const;
export const SOM_MAX_PLAYERS = [4, 6, 8] as const;
export const SOM_COUNTDOWN_MS = 3_000;
/** Duração máxima de cada gravação. */
export const SOM_MAX_REC_MS = 3_000;
/** Na votação, cada áudio (original + imitações) toca em sequência neste intervalo. */
export const SOM_SLOT_MS = 3_800;
/** Tempo extra para votar depois que todas as imitações tocaram. */
export const SOM_VOTE_EXTRA_MS = 15_000;
export const SOM_RESULTS_MS = 9_000;
/** Cada voto recebido vale isto... */
export const SOM_VOTE_POINTS = 1;
/** ...e quem tiver mais votos na rodada ganha este bônus. */
export const SOM_WIN_POINTS = 3;
/** Tamanho máximo de uma gravação enviada (bytes). */
export const SOM_MAX_CLIP_BYTES = 400_000;

export interface SomSettings {
  rounds: (typeof SOM_ROUNDS)[number];
  recordTime: (typeof SOM_RECORD_TIMES)[number];
  maxPlayers: (typeof SOM_MAX_PLAYERS)[number];
}

export type SomPhase = 'lobby' | 'record' | 'vote' | 'results' | 'ended';

export interface SomPlayer {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  left: boolean;
  score: number;
  /** Já gravou (fase record) / já votou (fase vote). */
  done: boolean;
}

export interface SomSound {
  id: string;
  title: string;
  emoji: string;
  /** Arquivo em client/public/som (padrão: <id>.mp3). */
  file?: string;
}

/** Resultado da rodada para cada imitação. */
export interface SomResult {
  playerId: string;
  /** Posição da imitação na votação (Imitação #n). */
  slot: number;
  voters: string[];
  winner: boolean;
}

export interface SomPublicRoom {
  kind: 'som';
  code: string;
  hostId: string;
  hostName: string;
  settings: SomSettings;
  phase: SomPhase;
  players: SomPlayer[];
  spectators: PublicSpectator[];
  round: number;
  sound: SomSound | null;
  /** Quando o som original toca para todos (fase record). */
  playAt: number | null;
  endsAt: number | null;
  /** Votação: quantas imitações existem (as gravações chegam pelo evento som:clips). */
  clipCount: number;
  /** Quantos sons existem agora no jogo (inclui os salvos há pouco pelo /admin). */
  soundCount: number;
  /** Quando começa a sequência original + imitações na votação. */
  playlistAt: number | null;
  results: SomResult[] | null;
  gained: Record<string, number> | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}

/** Gravações da rodada. Na votação vão sem dono (só o slot); o dono aparece no resultado. */
export interface SomClip {
  slot: number;
  mime: string;
  data: ArrayBuffer;
  /** Só preenchido para a sua própria gravação (para não votar em si mesmo). */
  mine: boolean;
}
