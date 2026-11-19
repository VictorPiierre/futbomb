import type { PublicSpectator } from './types.ts';

/**
 * Faz Esse Som!: toca um som curtinho, cada um tenta imitar no microfone,
 * depois todo mundo ouve as imitações e vota na melhor (não vale votar em si mesmo).
 */
export const SOM_ROUNDS = [3, 5, 8] as const;
export const SOM_MAX_PLAYERS = [4, 6, 8] as const;
export const SOM_COUNTDOWN_MS = 3_000;
/**
 * Gravação: sem tempo correndo — a rodada segue quando todo mundo aperta "Pronto"
 * (ou quando o dono encerra). Cada gravação tem só um limite de segurança.
 */
export const SOM_MAX_REC_MS = 10_000;
/**
 * Desfile das imitações: aparece uma pessoa por vez (foto e nome em destaque), toca a gravação dela
 * e todo mundo dá a nota — Ruim, Meh ou Bom. Antes, toca o original de novo para relembrar.
 * Quem passa para a próxima é o dono da sala (botão "Próximo"); nada avança sozinho.
 */
/** Da troca de tela até a gravação tocar. */
export const SOM_SLIDE_LEAD_MS = 700;
/** Quando todos já votaram, as notas aparecem depois de pelo menos isto (dá para ouvir a imitação inteira). */
export const SOM_SLIDE_MIN_MS = 3_500;

export type SomRating = 'ruim' | 'meh' | 'bom';
export const SOM_RATING_ORDER: SomRating[] = ['ruim', 'meh', 'bom'];
export const SOM_RATINGS: Record<SomRating, { emoji: string; label: string; points: number }> = {
  ruim: { emoji: '😬', label: 'Ruim', points: 0 },
  meh: { emoji: '😐', label: 'Meh', points: 1 },
  bom: { emoji: '🔥', label: 'Bom', points: 2 },
};
/** Tamanho máximo de uma gravação enviada (bytes). */
export const SOM_MAX_CLIP_BYTES = 700_000;

export interface SomSettings {
  rounds: (typeof SOM_ROUNDS)[number];
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
  /** Posição da imitação no desfile (a gravação chega com este número). */
  slot: number;
  /** Quem deu cada nota. */
  votes: Record<SomRating, string[]>;
  points: number;
  /** Maior pontuação da rodada. */
  best: boolean;
}

/** Imitação que está na tela no desfile. */
export interface SomSlide {
  /** -1 = relembrando o original; 0.. = posição em `order`. */
  index: number;
  /** Quando o áudio deste slide toca para todos. */
  playAt: number;
  /** Mostrando o placar deste slide. */
  reveal: boolean;
  /** Notas recebidas (só aparecem no placar do slide). */
  votes: Record<SomRating, string[]> | null;
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
  /** Ordem do desfile (ids dos jogadores que gravaram); a gravação de order[i] é o slot i+1. */
  order: string[];
  slide: SomSlide | null;
  /** Quantos sons existem agora no jogo (inclui os salvos há pouco pelo /admin). */
  soundCount: number;
  results: SomResult[] | null;
  gained: Record<string, number> | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}

/** Gravações da rodada (o dono de cada slot está em `order`). */
export interface SomClip {
  slot: number;
  mime: string;
  data: ArrayBuffer;
  mine: boolean;
}
