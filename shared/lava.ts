import type { PublicSpectator } from './types.ts';

/**
 * Torre de Lava: cada um tem uma torre, a lava sobe a cada rodada e quem responde
 * a conta mais rápido sobe mais blocos. Ganha quem sobrar.
 *
 * Equilíbrio (torre começa com 5 blocos, lava no 0):
 *  - a lava sobe 1 + ⌊r/2⌋ blocos na rodada r e, a partir da 11ª, acelera mais 1 por rodada;
 *  - o 1º a acertar sobe 2 + ⌊r/3⌋ blocos, o 2º um a menos e assim por diante (mínimo 1);
 *  - quem erra não sobe.
 * Quem acerta sempre em 1º mantém uns 5 blocos de folga até a 10ª rodada e cai até a 12ª,
 * então a partida nunca passa de ~12 rodadas (uns 3 minutos). Errar duas ou três vezes costuma ser fatal.
 */
export const LAVA_START_HEIGHT = 5;
export function lavaRise(round: number) {
  return 1 + Math.floor(round / 2) + Math.max(0, round - 10);
}
export function maxClimb(round: number) {
  return 2 + Math.floor(round / 3);
}
/** Blocos para quem acertou na posição `place` (1 = mais rápido). */
export function climbFor(round: number, place: number) {
  return Math.max(1, maxClimb(round) - (place - 1));
}

export const LAVA_DIFFICULTIES = {
  easy: { label: 'Fácil', hint: 'somas, subtrações e tabuada até 5' },
  medium: { label: 'Médio', hint: 'números de dois dígitos, tabuada completa e divisão' },
  hard: { label: 'Difícil', hint: 'contas maiores, expressões, quadrados e porcentagem' },
} as const;
export type LavaDifficulty = keyof typeof LAVA_DIFFICULTIES;

export const LAVA_TIMES = [6, 10, 15] as const;
export const LAVA_MAX_PLAYERS = [4, 6, 8] as const;

export const LAVA_COUNTDOWN_MS = 3_000;
/** Ranking de tempo na tela. */
export const LAVA_RANKING_MS = 3_500;
/** Animação: torres sobem, depois a lava. */
export const LAVA_RISE_MS = 3_000;

export interface LavaSettings {
  difficulty: LavaDifficulty;
  answerTime: (typeof LAVA_TIMES)[number];
  maxPlayers: (typeof LAVA_MAX_PLAYERS)[number];
}

export type LavaPhase = 'lobby' | 'countdown' | 'question' | 'ranking' | 'rise' | 'ended';

export interface LavaPlayer {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  left: boolean;
  height: number;
  alive: boolean;
  /** Rodada em que a lava engoliu (null = vivo). */
  diedRound: number | null;
  answered: boolean;
}

export interface LavaResult {
  playerId: string;
  answer: number | null;
  correct: boolean;
  /** Tempo de resposta em ms (null = não respondeu). */
  timeMs: number | null;
  /** Posição entre quem acertou (1 = mais rápido). */
  place: number | null;
  climb: number;
  /** Já tinha sido engolido: responde só por diversão. */
  ghost: boolean;
}

export interface LavaPublicRoom {
  kind: 'lava';
  code: string;
  hostId: string;
  hostName: string;
  settings: LavaSettings;
  phase: LavaPhase;
  players: LavaPlayer[];
  spectators: PublicSpectator[];
  round: number;
  lava: number;
  /** Quanto a lava sobe nesta rodada. */
  rise: number;
  /** Quanto o 1º colocado sobe nesta rodada. */
  topClimb: number;
  /** Hora (servidor) em que a pergunta aparece. */
  askAt: number | null;
  endsAt: number | null;
  question: string | null;
  /** As 4 alternativas (1 certa e 3 erradas), já embaralhadas. */
  options: number[] | null;
  answer: number | null;
  results: LavaResult[] | null;
  /** Engolidos nesta rodada (para a animação). */
  swallowed: string[];
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}
