export type Theme = 'players' | 'clubs';
export const TURN_TIMES = [5, 10, 15, 20, 30] as const;
export const MAX_PLAYERS = [2, 3, 4] as const;
export const START_LIVES = 2;

export interface Settings {
  theme: Theme;
  turnTime: (typeof TURN_TIMES)[number];
  maxPlayers: (typeof MAX_PLAYERS)[number];
}

export type Phase = 'lobby' | 'playing' | 'ended';

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  lives: number;
  connected: boolean;
  eliminated: boolean;
  left: boolean;
  correct: number;
}

export interface PublicSpectator {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
}

export interface HistoryItem {
  id: number;
  playerId: string;
  playerName: string;
  typed: string;
  canonical: string;
}

export interface PublicGame {
  letter: string;
  round: number;
  currentPlayerId: string | null;
  /** 'turn' = cronômetro correndo; 'pause' = intervalo após explosão */
  status: 'turn' | 'pause';
  turnEndsAt: number | null;
  turnDuration: number;
  history: HistoryItem[];
}

export interface RankingEntry {
  playerId: string;
  name: string;
  avatar: string;
  place: number;
  correct: number;
  left: boolean;
}

export interface PublicRoom {
  code: string;
  hostId: string;
  hostName: string;
  settings: Settings;
  phase: Phase;
  players: PublicPlayer[];
  spectators: PublicSpectator[];
  game: PublicGame | null;
  ranking: RankingEntry[] | null;
  winnerId: string | null;
  serverNow: number;
}

export type GameFx =
  | { type: 'start' }
  | { type: 'letter'; letter: string; round: number }
  | { type: 'turn'; playerId: string }
  | { type: 'correct'; playerId: string; canonical: string; typed: string }
  | { type: 'explode'; playerId: string; lives: number }
  | { type: 'eliminated'; playerId: string; reason: 'lives' | 'left' }
  | { type: 'winner'; playerId: string | null };

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: string;
  memberId?: string;
  token?: string;
}

export interface AnswerResult {
  ok: boolean;
  reason?: string;
  canonical?: string;
}

export const AVATARS = ['⚽', '🦁', '🐯', '🦅', '🐺', '🦊', '🐻', '🐲', '🦈', '🐝', '🔥', '⚡', '👑', '🧤', '🥅', '🏆'];
