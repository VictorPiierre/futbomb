import type { PublicSpectator } from './types.ts';

export const QUIZ_CATEGORIES = {
  brazil: { label: 'Só Brasil', icon: '🇧🇷' },
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
  /** Fama do assunto (nº de Wikipédias com artigo); maior = mais conhecido. */
  f?: number;
  /** Visitas por mês ao artigo na Wikipédia em português (quanto o Brasil conhece). */
  pv?: number;
  /** Pergunta sobre algo do Brasil (categoria "Só Brasil"). */
  br?: boolean;
}

export const QUIZ_DIFFICULTIES = {
  easy: { label: 'Fácil', hint: 'só coisas que todo mundo conhece' },
  normal: { label: 'Normal', hint: 'inclui coisas menos conhecidas' },
  hard: { label: 'Difícil', hint: 'vale tudo, até o obscuro' },
} as const;
export type QuizDifficulty = keyof typeof QUIZ_DIFFICULTIES;

export const QUIZ_TARGETS = [15, 25, 40, 60] as const;
export const QUIZ_TIMES = [15, 20, 30, 45] as const;
export const QUIZ_MAX_PLAYERS = [4, 6, 8, 10] as const;

/** Pontos do 1º, 2º e 3º mais perto — só para quem não errou feio. */
export const QUIZ_POINTS = [5, 3, 1] as const;
export const QUIZ_EXACT_BONUS = 2;
export const QUIZ_CLOSE_BONUS = 1;
/** "Mais ou menos": acertar o lado vale isto. */
export const QUIZ_HIGHLOW_POINTS = 3;
/** Fichas "🔥 Tô certo!" por partida e quanto custa errar com elas. */
export const QUIZ_BETS = 2;
export const QUIZ_BET_PENALTY = 3;
/** Azarão: acertar quem foi o pior da rodada dá bônus; apontar quem foi o melhor tira pontos. */
export const QUIZ_UNDERDOG_BONUS = 1;
export const QUIZ_UNDERDOG_PENALTY = 1;
export const QUIZ_LIGHTNING_S = 7;
export const QUIZ_REVEAL_MS = 12_000;
/** Duração do suspense (tambor) antes de mostrar o número. */
export const QUIZ_SUSPENSE_MS = 2200;

export type QuizSpecial = 'lightning' | 'double' | 'highlow';
export const QUIZ_SPECIALS: Record<QuizSpecial, { icon: string; label: string; text: string }> = {
  lightning: { icon: '⚡', label: 'Rodada relâmpago', text: `só ${QUIZ_LIGHTNING_S} segundos para chutar!` },
  double: { icon: '✖️2', label: 'Rodada dobrada', text: 'todos os pontos valem o dobro!' },
  highlow: { icon: '⬆️⬇️', label: 'Mais ou menos?', text: `a resposta é maior ou menor que o número? Acertar vale ${QUIZ_HIGHLOW_POINTS}.` },
};

export interface QuizSettings {
  categories: QuizCategory[];
  difficulty: QuizDifficulty;
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
  /** Fichas "🔥 Tô certo!" que ainda tem. */
  bets: number;
  /** Apostou nesta pergunta (todos veem o 🔥, para dar suspense). */
  betting: boolean;
  /** Já escolheu um azarão nesta pergunta (quem foi só aparece na revelação). */
  picked: boolean;
}

/** Quão perto o chute ficou: exato, muito perto, ok ou longe demais (não pontua). */
export type QuizCloseness = 'exact' | 'close' | 'ok' | 'far';

export interface QuizResult {
  playerId: string;
  /** Chute numérico, ou no "mais ou menos": 1 = maior, -1 = menor. */
  guess: number | null;
  diff: number | null;
  place: number | null;
  closeness: QuizCloseness | null;
  bet: boolean;
  points: number;
  /** Quem este jogador apontou como azarão, e quanto ganhou/perdeu com isso. */
  pick: string | null;
  pickPoints: number;
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
  question: { cat: QuizCategory; q: string; unit: string; special: QuizSpecial | null; reference: number | null } | null;
  answer: number | null;
  endsAt: number | null;
  results: QuizResult[] | null;
  /** Pior(es) e melhor(es) da rodada, para o Azarão. */
  roundWorst: string[] | null;
  roundBest: string[] | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}

/**
 * Anos: exato, até 2 anos = muito perto, mais de 30 = longe demais.
 * Demais medidas: até 5% = muito perto, mais de 50% = longe demais.
 */
export function closeness(answer: number, guess: number, unit: string): QuizCloseness {
  const diff = Math.abs(guess - answer);
  if (diff === 0) return 'exact';
  if (unit === 'ano') return diff <= 2 ? 'close' : diff > 30 ? 'far' : 'ok';
  const rel = diff / Math.max(Math.abs(answer), 1e-9);
  return rel <= 0.05 ? 'close' : rel > 0.5 ? 'far' : 'ok';
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
