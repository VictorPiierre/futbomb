import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIZ_CATEGORY_IDS, type QuizCategory, type QuizDifficulty, type QuizQuestion } from '../shared/quiz.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'quiz');
/** Perguntas escritas à mão contam como "bem conhecidas". */
const CURATED_FAME = 10_000;

/**
 * Todas as perguntas do Chutômetro por categoria (data/quiz/*.json), da mais conhecida
 * para a menos conhecida. "Só Brasil" junta as perguntas marcadas como brasileiras.
 */
export const QUIZ_BANK: Record<QuizCategory, QuizQuestion[]> = Object.fromEntries(QUIZ_CATEGORY_IDS.map((c) => [c, []])) as never;

if (fs.existsSync(DIR)) {
  const seen = new Set<string>();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const list: QuizQuestion[] = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    for (const q of list) {
      if (seen.has(q.id) || !QUIZ_BANK[q.cat] || !Number.isFinite(q.a)) continue;
      seen.add(q.id);
      if (q.f === undefined) q.f = file === 'curated.json' ? CURATED_FAME : 0;
      QUIZ_BANK[q.cat].push(q);
      if (q.br && q.cat !== 'brazil') QUIZ_BANK.brazil.push(q);
    }
  }
  for (const list of Object.values(QUIZ_BANK)) list.sort((a, b) => (b.f ?? 0) - (a.f ?? 0));
}

/** Fatia da lista (as mais conhecidas primeiro) que cada dificuldade usa. */
const SHARE: Record<QuizDifficulty, number> = { easy: 0.15, normal: 0.5, hard: 1 };
const MIN_POOL = 40;

export function difficultyPool(cat: QuizCategory, difficulty: QuizDifficulty) {
  const list = QUIZ_BANK[cat];
  return list.slice(0, Math.min(list.length, Math.max(MIN_POOL, Math.ceil(list.length * SHARE[difficulty]))));
}

export const QUIZ_TOTAL = new Set(Object.values(QUIZ_BANK).flat().map((q) => q.id)).size;
