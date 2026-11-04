/**
 * Mede o quanto o público brasileiro conhece o assunto de cada pergunta do Wikidata:
 * média de visitas por mês ao artigo na Wikipédia em português nos últimos 12 meses.
 * Grava o campo "pv" em data/quiz/wd-*.json (usado na dificuldade).
 * Uso: npm run quiz:popularity
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuizQuestion } from '../shared/quiz.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'quiz');
const UA = 'JogatinaQuiz/1.0 (jogo de perguntas)';
const CONCURRENCY = 8;

const end = new Date();
end.setUTCDate(1);
const start = new Date(end);
start.setUTCFullYear(end.getUTCFullYear() - 1);
const stamp = (d: Date) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}00`;

async function getJson(url: string, init?: RequestInit) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init?.headers ?? {}) } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      /* tenta de novo */
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return null;
}

const files = fs.readdirSync(DIR).filter((f) => f.startsWith('wd-') && f.endsWith('.json'));
const data = new Map(files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as QuizQuestion[]]));
const ids = [...new Set([...data.values()].flat().map((q) => q.id.split(':')[1]).filter((id) => /^Q\d+$/.test(id)))];
console.log(`${ids.length} itens`);

// 1) título do artigo na Wikipédia em português
const titles = new Map<string, string>();
for (let i = 0; i < ids.length; i += 300) {
  const values = ids.slice(i, i + 300).map((id) => `wd:${id}`).join(' ');
  const query = `SELECT ?item ?title WHERE { VALUES ?item { ${values} }
    ?a schema:about ?item ; schema:isPartOf <https://pt.wikipedia.org/> ; schema:name ?title }`;
  const json = await getJson('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query }),
  });
  for (const b of json?.results?.bindings ?? []) titles.set(b.item.value.split('/').pop(), b.title.value);
  process.stdout.write(`\r  títulos ${Math.min(i + 300, ids.length)}/${ids.length}`);
  await new Promise((r) => setTimeout(r, 600));
}
process.stdout.write(`\n  ${titles.size} itens têm artigo em português\n`);

// 2) visitas por mês
const views = new Map<string, number>();
const queue = [...titles];
let done = 0;
async function worker() {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    const [id, title] = next;
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pt.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${stamp(start)}/${stamp(end)}`;
    const json = await getJson(url);
    const items: { views: number }[] = json?.items ?? [];
    views.set(id, items.length ? Math.round(items.reduce((s, x) => s + x.views, 0) / 12) : 0);
    if (++done % 200 === 0) process.stdout.write(`\r  visitas ${done}/${titles.size}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stdout.write('\n');

for (const [file, list] of data) {
  for (const q of list) q.pv = views.get(q.id.split(':')[1]) ?? 0;
  fs.writeFileSync(path.join(DIR, file), '[\n' + list.map((q) => '  ' + JSON.stringify(q)).join(',\n') + '\n]\n');
}
console.log('✔ popularidade gravada');
