import { normalize } from './normalize.ts';
import type { PublicSpectator } from './types.ts';

/** Idiomas (temas). Os áudios são gerados pelo Piper (scripts/gen-ear-audio.ts). */
export const EAR_LANGS = {
  en: { label: 'Inglês', flag: '🇺🇸' },
  es: { label: 'Espanhol', flag: '🇪🇸' },
  fr: { label: 'Francês', flag: '🇫🇷' },
  it: { label: 'Italiano', flag: '🇮🇹' },
  de: { label: 'Alemão', flag: '🇩🇪' },
} as const;
export type EarLang = keyof typeof EAR_LANGS;
export const EAR_LANG_IDS = Object.keys(EAR_LANGS) as EarLang[];

export const EAR_DIFFICULTIES = {
  easy: { label: 'Fácil', hint: 'palavras curtas e conhecidas, faladas devagar' },
  medium: { label: 'Médio', hint: 'palavras maiores e menos comuns' },
  hard: { label: 'Difícil', hint: 'frases e palavras cabeludas, na velocidade normal' },
} as const;
export type EarDifficulty = keyof typeof EAR_DIFFICULTIES;

export const EAR_ROUNDS = [5, 10, 15] as const;
export const EAR_TIMES = [10, 15, 20] as const;
export const EAR_MAX_PLAYERS = [4, 6, 8, 10] as const;

/** Contagem "Palavra em 3… 2… 1…" antes da voz. */
export const EAR_COUNTDOWN_MS = 3_000;
/** Tempo reservado para a voz falar antes de começar a contar o tempo de resposta. */
export const EAR_SPEAK_MS = 2_800;
export const EAR_REVEAL_MS = 10_000;
/** Pontos: escrita perfeita, e o máximo para quem chegou perto. */
export const EAR_EXACT_POINTS = 10;
export const EAR_NEAR_MAX = 7;
/** Abaixo disto de semelhança não pontua. */
export const EAR_MIN_SIMILARITY = 0.4;
/** Bônus para quem chegou mais perto na rodada. */
export const EAR_BEST_BONUS = 2;

export interface EarSettings {
  langs: EarLang[];
  difficulty: EarDifficulty;
  rounds: (typeof EAR_ROUNDS)[number];
  answerTime: (typeof EAR_TIMES)[number];
  maxPlayers: (typeof EAR_MAX_PLAYERS)[number];
}

export type EarPhase = 'lobby' | 'question' | 'reveal' | 'ended';

export interface EarPlayer {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  left: boolean;
  score: number;
  answered: boolean;
}

export interface EarResult {
  playerId: string;
  answer: string | null;
  /** 0–100 */
  similarity: number;
  exact: boolean;
  best: boolean;
  points: number;
}

export interface EarPublicRoom {
  kind: 'ear';
  code: string;
  hostId: string;
  hostName: string;
  settings: EarSettings;
  phase: EarPhase;
  players: EarPlayer[];
  spectators: PublicSpectator[];
  round: number;
  lang: EarLang | null;
  /** Hora (do servidor) em que a voz fala a palavra. */
  speakAt: number | null;
  endsAt: number | null;
  /** Só aparece na revelação. */
  word: { say: string; answers: string[]; meaning: string; audio: string } | null;
  results: EarResult[] | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}

/** Aviso da palavra da rodada: só o nome do arquivo de áudio (não revela a palavra). */
export interface EarSay {
  round: number;
  lang: EarLang;
  speakAt: number;
  audio: string;
}

/** Compara ignorando acentos, maiúsculas, pontuação e espaços. */
export function earNorm(text: string) {
  return normalize(text).replace(/\s+/g, '');
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Semelhança 0–1 com a melhor das respostas aceitas. */
export function similarity(guess: string, answers: string[]) {
  const g = earNorm(guess);
  if (!g) return 0;
  let best = 0;
  for (const a of answers) {
    const n = earNorm(a);
    const s = 1 - levenshtein(g, n) / Math.max(g.length, n.length, 1);
    if (s > best) best = s;
  }
  return best;
}

/** Pontos de uma resposta (sem o bônus de mais perto). */
export function earPoints(sim: number) {
  if (sim >= 1) return EAR_EXACT_POINTS;
  if (sim < EAR_MIN_SIMILARITY) return 0;
  return Math.max(1, Math.round(((sim - EAR_MIN_SIMILARITY) / (1 - EAR_MIN_SIMILARITY)) * EAR_NEAR_MAX));
}

/**
 * Alinha a resposta com a palavra certa para colorir letra por letra:
 * 'ok' = letra certa, 'bad' = letra trocada/sobrando, 'miss' = faltou (letra da palavra certa).
 */
export function diffLetters(guess: string, answer: string): { ch: string; k: 'ok' | 'bad' | 'miss' }[] {
  const a = normalize(guess).replace(/\s+/g, '');
  const b = normalize(answer).replace(/\s+/g, '');
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const out: { ch: string; k: 'ok' | 'bad' | 'miss' }[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      out.push({ ch: a[i - 1], k: a[i - 1] === b[j - 1] ? 'ok' : 'bad' });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out.push({ ch: a[i - 1], k: 'bad' });
      i--;
    } else {
      out.push({ ch: b[j - 1], k: 'miss' });
      j--;
    }
  }
  return out.reverse();
}
