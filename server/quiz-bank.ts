import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIZ_CATEGORY_IDS, type QuizCategory, type QuizDifficulty, type QuizQuestion } from '../shared/quiz.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'quiz');

/**
 * Quanto o público brasileiro conhece o assunto: visitas por mês ao artigo na Wikipédia
 * em português (campo pv). Perguntas escritas à mão (curated*.json) contam como conhecidas.
 */
const CURATED = Number.POSITIVE_INFINITY;
/** Mínimo de visitas/mês para entrar em cada dificuldade (Difícil aceita tudo). */
const MIN_VIEWS: Record<QuizDifficulty, number> = { easy: 25_000, normal: 4_000, hard: 0 };

const popularity = new Map<string, number>();

/** Todas as perguntas por categoria, das mais conhecidas para as menos conhecidas. */
export const QUIZ_BANK: Record<QuizCategory, QuizQuestion[]> = Object.fromEntries(QUIZ_CATEGORY_IDS.map((c) => [c, []])) as never;

if (fs.existsSync(DIR)) {
  const seen = new Set<string>();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const list: QuizQuestion[] = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    for (const q of list) {
      if (seen.has(q.id) || !QUIZ_BANK[q.cat] || !Number.isFinite(q.a)) continue;
      seen.add(q.id);
      popularity.set(q.id, file.startsWith('curated') ? CURATED : (q.pv ?? 0));
      QUIZ_BANK[q.cat].push(q);
      if (q.br && q.cat !== 'brazil') QUIZ_BANK.brazil.push(q);
    }
  }
  for (const list of Object.values(QUIZ_BANK)) list.sort((a, b) => popularity.get(b.id)! - popularity.get(a.id)!);
}

/** Perguntas da categoria que a dificuldade permite. */
export function difficultyPool(cat: QuizCategory, difficulty: QuizDifficulty) {
  const min = MIN_VIEWS[difficulty];
  return QUIZ_BANK[cat].filter((q) => popularity.get(q.id)! >= min);
}

export const QUIZ_TOTAL = new Set(Object.values(QUIZ_BANK).flat().map((q) => q.id)).size;

export function difficultyCounts() {
  return Object.fromEntries(
    (Object.keys(MIN_VIEWS) as QuizDifficulty[]).map((d) => [d, new Set(QUIZ_CATEGORY_IDS.flatMap((c) => difficultyPool(c, d).map((q) => q.id))).size]),
  );
}
