import type { PublicSpectator, Theme } from './types.ts';

export const STOP_ROUNDS = [3, 5, 7, 10] as const;
export const STOP_TIMES = [60, 90, 120, 180] as const;
export const STOP_MAX_PLAYERS = [4, 6, 8, 10] as const;
export const STOP_MIN_CATEGORIES = 3;
export const STOP_MAX_CATEGORIES = 12;
export const STOP_DEFAULT_CATEGORIES: Theme[] = ['names', 'animals', 'foods', 'colors', 'objects', 'cities', 'brands', 'professions'];
/** Contagem regressiva antes de liberar a digitação. */
export const STOP_COUNTDOWN_MS = 3000;
/** Tempo de correção de cada categoria. */
export const STOP_REVIEW_MS = 25_000;

export interface StopSettings {
  categories: Theme[];
  rounds: (typeof STOP_ROUNDS)[number];
  roundTime: (typeof STOP_TIMES)[number];
  maxPlayers: (typeof STOP_MAX_PLAYERS)[number];
}

/** lobby -> playing -> review -> scores -> (playing | ended) */
export type StopPhase = 'lobby' | 'playing' | 'review' | 'scores' | 'ended';

export interface StopPlayer {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  left: boolean;
  score: number;
  /** Quantas categorias já preencheu na rodada (sem revelar o quê). */
  filled: number;
  ready: boolean;
}

/** ok = vale até a maioria votar contra; empty/wrong-letter nunca valem. */
export type StopAnswerStatus = 'ok' | 'empty' | 'wrong-letter';

export interface StopAnswer {
  playerId: string;
  text: string;
  status: StopAnswerStatus;
  /** Quem votou que NÃO vale. */
  against: string[];
  valid: boolean;
  /** Só existe depois da pontuação da rodada. */
  points?: number;
}

export interface StopPublicRoom {
  kind: 'stop';
  code: string;
  hostId: string;
  hostName: string;
  settings: StopSettings;
  phase: StopPhase;
  players: StopPlayer[];
  spectators: PublicSpectator[];
  round: number;
  letter: string;
  /** Digitação liberada a partir daqui (contagem regressiva antes). */
  roundStartsAt: number | null;
  roundEndsAt: number | null;
  stoppedBy: string | null;
  /** Categoria em correção agora (todos veem a mesma, uma por vez). */
  reviewIndex: number;
  reviewEndsAt: number | null;
  /** Respostas por categoria — só aparecem na revisão e no placar da rodada. */
  answers: Partial<Record<Theme, StopAnswer[]>> | null;
  roundPoints: Record<string, number> | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}
