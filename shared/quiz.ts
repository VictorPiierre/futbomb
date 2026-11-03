import type { PublicSpectator } from './types.ts';

export const QUIZ_CATEGORIES = {
  curio: { label: 'Curiosidades', icon: '💡' },
  geo: { label: 'Geografia', icon: '🌍' },
  build: { label: 'Construções', icon: '🏗️' },
  history: { label: 'História', icon: '📜' },
  famous: { label: 'Famosos', icon: '⭐' },
  screen: { label: 'Cinema, TV e música', icon: '🎬' },
  sport: { label: 'Esportes', icon: '⚽' },
  tech: { label: 'Games e empresas', icon: '🎮' },
  science: { label: 'Ciência e corpo', icon: '🔬' },
} as const;
export type QuizCategory = keyof typeof QUIZ_CATEGORIES;
export const QUIZ_CATEGORY_IDS = Object.keys(QUIZ_CATEGORIES) as QuizCategory[];

export interface QuizQuestion {
  id: string;
  cat: QuizCategory;
  q: string;
  /** Resposta certa. */
  a: number;
  /** "metros", "ano", "habitantes"… ('' quando não há unidade). */
  unit: string;
}

export const QUIZ_TARGETS = [15, 25, 40, 60] as const;
export const QUIZ_TIMES = [15, 20, 30, 45] as const;
export const QUIZ_MAX_PLAYERS = [4, 6, 8, 10] as const;
/** Pontos do 1º, 2º e 3º mais perto; acerto exato ganha bônus. */
export const QUIZ_POINTS = [5, 3, 1] as const;
export const QUIZ_EXACT_BONUS = 2;
export const QUIZ_REVEAL_MS = 9000;

export interface QuizSettings {
  categories: QuizCategory[];
  target: (typeof QUIZ_TARGETS)[number];
  questionTime: (typeof QUIZ_TIMES)[number];
  maxPlayers: (typeof QUIZ_MAX_PLAYERS)[number];
}

export type QuizPhase = 'lobby' | 'question' | 'reveal' | 'ended';

export interface QuizPlayer {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  left: boolean;
  score: number;
  /** Já chutou nesta pergunta (o valor só aparece na revelação). */
  answered: boolean;
}

export interface QuizResult {
  playerId: string;
  guess: number | null;
  diff: number | null;
  place: number | null;
  points: number;
  exact: boolean;
}

export interface QuizPublicRoom {
  kind: 'quiz';
  code: string;
  hostId: string;
  hostName: string;
  settings: QuizSettings;
  phase: QuizPhase;
  players: QuizPlayer[];
  spectators: PublicSpectator[];
  number: number;
  question: { cat: QuizCategory; q: string; unit: string } | null;
  answer: number | null;
  endsAt: number | null;
  results: QuizResult[] | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}

/** Formata números no padrão brasileiro (anos sem separador). */
export function formatQuizNumber(n: number, unit: string) {
  if (unit === 'ano') return String(n);
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/**
 * Entende chutes como "1.500", "1,5 mil", "2 milhões", "330m", "12000000".
 * Ponto é separador de milhar; vírgula é decimal (padrão brasileiro).
 */
export function parseGuess(raw: string): number | null {
  let s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let mult = 1;
  const words: [RegExp, number][] = [
    [/\b(bilh(ão|ao|ões|oes)|bi)\b/, 1e9],
    [/\b(milh(ão|ao|ões|oes)|mi)\b/, 1e6],
    [/\b(mil|k)\b/, 1e3],
  ];
  for (const [re, m] of words) {
    if (re.test(s)) {
      mult = m;
      s = s.replace(re, '');
      break;
    }
  }
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  // "1.234.567" -> milhar; "1,5" -> decimal; "1.5" com multiplicador -> decimal
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (mult === 1 && /^\d+\.\d{3}$/.test(s)) s = s.replace('.', '');
  const n = Number(s) * mult;
  return Number.isFinite(n) ? n : null;
}
