/**
 * Marca cada pergunta do Wikidata com:
 *  - f:  "fama" do item (número de Wikipédias que têm artigo sobre ele), usada na dificuldade;
 *  - br: true quando o item é do Brasil (país, nacionalidade ou origem), usado em "Só Brasil".
 * Uso: npm run quiz:fame   (rodar depois de npm run fetch:quiz)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuizQuestion } from '../shared/quiz.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'quiz');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'JogatinaQuiz/1.0 (jogo de perguntas; contato digiartsgrafica@gmail.com)';
// Modelos que já são só de coisas brasileiras.
const BR_TEMPLATES = new Set(['brCityPop', 'brStateArea', 'brFamousBirth', 'brCompanies']);

async function sparql(query: string) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query }),
      });
      if (res.ok) return (await res.json()).results.bindings as Record<string, { value: string }>[];
    } catch {
      /* tenta de novo */
    }
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error('Wikidata indisponível');
}

const files = fs.readdirSync(DIR).filter((f) => f.startsWith('wd-') && f.endsWith('.json'));
const data = new Map(files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as QuizQuestion[]]));
const ids = [...new Set([...data.values()].flat().map((q) => q.id.split(':')[1]).filter((id) => /^Q\d+$/.test(id)))];
console.log(`${ids.length} itens para consultar`);

const fame = new Map<string, number>();
const brazil = new Set<string>();
for (let i = 0; i < ids.length; i += 350) {
  const values = ids.slice(i, i + 350).map((id) => `wd:${id}`).join(' ');
  const rows = await sparql(`SELECT ?item ?sl ?br WHERE {
    VALUES ?item { ${values} }
    ?item wikibase:sitelinks ?sl .
    OPTIONAL { ?item wdt:P17|wdt:P27|wdt:P495 wd:Q155 . BIND(1 AS ?br) }
  }`);
  for (const r of rows) {
    const id = r.item.value.split('/').pop()!;
    fame.set(id, Number(r.sl.value));
    if (r.br) brazil.add(id);
  }
  process.stdout.write(`\r  ${Math.min(i + 350, ids.length)}/${ids.length}`);
  await new Promise((r) => setTimeout(r, 800));
}
process.stdout.write('\n');

for (const [file, list] of data) {
  const template = file.slice(3, -5);
  for (const q of list) {
    const id = q.id.split(':')[1];
    q.f = fame.get(id) ?? 0;
    if (BR_TEMPLATES.has(template) || brazil.has(id)) q.br = true;
    else delete q.br;
  }
  fs.writeFileSync(path.join(DIR, file), '[\n' + list.map((q) => '  ' + JSON.stringify(q)).join(',\n') + '\n]\n');
}
console.log(`✔ fama marcada; ${[...data.values()].flat().filter((q) => q.br).length} perguntas sobre o Brasil`);
