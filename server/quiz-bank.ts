import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIZ_CATEGORY_IDS, type QuizCategory, type QuizQuestion } from '../shared/quiz.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'quiz');

/** Todas as perguntas do Chutômetro, agrupadas por categoria (data/quiz/*.json). */
export const QUIZ_BANK: Record<QuizCategory, QuizQuestion[]> = Object.fromEntries(QUIZ_CATEGORY_IDS.map((c) => [c, []])) as never;

if (fs.existsSync(DIR)) {
  const seen = new Set<string>();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const list: QuizQuestion[] = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    for (const q of list) {
      if (seen.has(q.id) || !QUIZ_BANK[q.cat] || !Number.isFinite(q.a)) continue;
      seen.add(q.id);
      QUIZ_BANK[q.cat].push(q);
    }
  }
}

export const QUIZ_TOTAL = Object.values(QUIZ_BANK).reduce((n, l) => n + l.length, 0);
