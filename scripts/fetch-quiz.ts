/**
 * Gera perguntas de quantidade para o Chutômetro a partir do Wikidata (CC0).
 * Uso: npm run fetch:quiz             (todas)
 *      npm run fetch:quiz -- rivers   (só um modelo)
 *
 * Cada modelo é uma consulta + um jeito de transformar cada resultado em pergunta.
 * Saída: data/quiz/wd-<modelo>.json  ->  [{ id, cat, q, a, unit }]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuizCategory, QuizQuestion } from '../shared/quiz.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'quiz');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'JogatinaQuiz/1.0 (jogo de perguntas; contato digiartsgrafica@gmail.com)';
const YEAR_NOW = new Date().getFullYear();

type Row = Record<string, string>;
interface Template {
  cat: QuizCategory;
  /** Uma consulta ou várias (somadas) — consultas grandes são divididas para não estourar o tempo. */
  query: string | string[];
  make: (r: Row) => Omit<QuizQuestion, 'id' | 'cat'> | null;
}

const PT = (v: string, l: string) => `?${v} rdfs:label ?${l} FILTER(LANG(?${l}) = "pt")`;
// Pessoas: rótulo em português ou, se não houver, em inglês.
const PERSON_LABEL = `OPTIONAL { ?item rdfs:label ?ptl FILTER(LANG(?ptl) = "pt") }
  OPTIONAL { ?item rdfs:label ?enl FILTER(LANG(?enl) = "en") }`;
const year = (iso?: string) => (iso && /^\d{4}-/.test(iso) ? Number(iso.slice(0, 4)) : NaN);
const okYear = (y: number) => y >= 1000 && y <= YEAR_NOW;
const round = (n: number) => (n >= 1000 ? Math.round(n) : Math.round(n * 10) / 10);
const clean = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

const OCC_FAMOUS = ['Q33999', 'Q10800557', 'Q177220', 'Q639669', 'Q488205', 'Q2252262', 'Q2526255', 'Q947873', 'Q245068', 'Q4610556', 'Q17125263', 'Q2066131', 'Q3665646', 'Q10833314', 'Q10873124', 'Q11338576', 'Q937857'];
const OCC_HISTORY = ['Q82955', 'Q36180', 'Q901', 'Q170790', 'Q1028181', 'Q36834', 'Q4964182', 'Q169470', 'Q593644', 'Q11063', 'Q11900058', 'Q116', 'Q39631', 'Q42973', 'Q1097498', 'Q49757'];

const people = (occs: string[], minSl: number) => occs.map((occ) => `SELECT ?item ?ptl ?enl ?birth ?death WHERE {
  ?item wdt:P106 wd:${occ} ; wdt:P31 wd:Q5 ; wdt:P569 ?birth ; wikibase:sitelinks ?sl . FILTER(?sl >= ${minSl})
  OPTIONAL { ?item wdt:P570 ?death }
  ${PERSON_LABEL}
}`);
const name = (r: Row) => clean(r.ptl ?? r.enl ?? '');

const TEMPLATES: Record<string, Template> = {
  // ---------- geografia ----------
  cityPop: {
    cat: 'geo',
    query: `SELECT ?item ?label ?pop ?cl WHERE {
      ?item wdt:P31/wdt:P279* wd:Q515 ; wdt:P1082 ?pop ; wdt:P17 ?c ; wikibase:sitelinks ?sl .
      FILTER(?pop >= 150000 && ?sl >= 20) ${PT('item', 'label')} ${PT('c', 'cl')} }`,
    make: (r) => ({ q: `Quantos habitantes tem ${clean(r.label)} (${r.cl})?`, a: Math.round(+r.pop), unit: 'habitantes' }),
  },
  brCityPop: {
    cat: 'geo',
    query: `SELECT ?item ?label ?pop ?uf WHERE {
      ?item wdt:P31 wd:Q3184121 ; wdt:P1082 ?pop ; wdt:P131 ?s . ?s wdt:P31 wd:Q485258 .
      FILTER(?pop >= 50000) ${PT('item', 'label')} ${PT('s', 'uf')} }`,
    make: (r) => ({ q: `Quantos habitantes tem ${clean(r.label)} (${r.uf})?`, a: Math.round(+r.pop), unit: 'habitantes' }),
  },
  countryPop: {
    cat: 'geo',
    query: `SELECT ?item ?label ?pop WHERE { ?item wdt:P31 wd:Q6256 ; wdt:P1082 ?pop . ${PT('item', 'label')} }`,
    make: (r) => ({ q: `${r.label}: quantos habitantes tem o país?`, a: Math.round(+r.pop), unit: 'habitantes' }),
  },
  countryArea: {
    cat: 'geo',
    query: `SELECT ?item ?label ?area WHERE { ?item wdt:P31 wd:Q6256 ; p:P2046/psn:P2046/wikibase:quantityAmount ?area . ${PT('item', 'label')} }`,
    make: (r) => ({ q: `${r.label}: qual é a área total do país?`, a: Math.round(+r.area / 1e6), unit: 'km²' }),
  },
  brStateArea: {
    cat: 'geo',
    query: `SELECT ?item ?label ?area WHERE { ?item wdt:P31 wd:Q485258 ; p:P2046/psn:P2046/wikibase:quantityAmount ?area . ${PT('item', 'label')} }`,
    make: (r) => ({ q: `${r.label} (estado): qual é a área?`, a: Math.round(+r.area / 1e6), unit: 'km²' }),
  },
  mountains: {
    cat: 'geo',
    query: `SELECT ?item ?label ?h WHERE {
      ?item wdt:P31 wd:Q8502 ; p:P2044/psn:P2044/wikibase:quantityAmount ?h ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 15 && ?h > 100) ${PT('item', 'label')} }`,
    make: (r) => ({ q: `Qual é a altitude do ${clean(r.label)}?`, a: Math.round(+r.h), unit: 'metros' }),
  },
  rivers: {
    cat: 'geo',
    query: `SELECT ?item ?label ?len WHERE {
      ?item wdt:P31 wd:Q4022 ; p:P2043/psn:P2043/wikibase:quantityAmount ?len ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 20 && ?len > 10000) ${PT('item', 'label')} }`,
    make: (r) => ({ q: `Quantos quilômetros de comprimento tem o ${clean(r.label)}?`, a: Math.round(+r.len / 1000), unit: 'km' }),
  },
  lakes: {
    cat: 'geo',
    query: `SELECT ?item ?label ?area WHERE {
      ?item wdt:P31 wd:Q23397 ; p:P2046/psn:P2046/wikibase:quantityAmount ?area ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 20) ${PT('item', 'label')} }`,
    make: (r) => ({ q: `Qual é a área do ${clean(r.label)}?`, a: Math.round(+r.area / 1e6), unit: 'km²' }),
  },
  islands: {
    cat: 'geo',
    query: `SELECT ?item ?label ?area WHERE {
      ?item wdt:P31 wd:Q23442 ; p:P2046/psn:P2046/wikibase:quantityAmount ?area ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 25) ${PT('item', 'label')} }`,
    make: (r) => ({ q: `${clean(r.label)}: qual é a área da ilha?`, a: Math.round(+r.area / 1e6), unit: 'km²' }),
  },

  // ---------- construções ----------
  heights: {
    cat: 'build',
    query: `SELECT ?item ?label ?h WHERE {
      VALUES ?t { wd:Q11303 wd:Q12518 wd:Q4989906 wd:Q11032 wd:Q179700 wd:Q16970 wd:Q44539 wd:Q11271835 }
      ?item wdt:P31 ?t ; p:P2048/psn:P2048/wikibase:quantityAmount ?h ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 10 && ?h >= 10) ${PT('item', 'label')} }`,
    make: (r) => ({ q: `${clean(r.label)}: qual é a altura?`, a: round(+r.h), unit: 'metros' }),
  },
  bridges: {
    cat: 'build',
    query: `SELECT ?item ?label ?len WHERE {
      ?item wdt:P31/wdt:P279* wd:Q12280 ; p:P2043/psn:P2043/wikibase:quantityAmount ?len ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 10 && ?len >= 100) ${PT('item', 'label')} }`,
    make: (r) => ({ q: `${clean(r.label)}: quantos metros de comprimento?`, a: Math.round(+r.len), unit: 'metros' }),
  },
  opened: {
    cat: 'build',
    query: `SELECT ?item ?label ?d WHERE {
      VALUES ?t { wd:Q11303 wd:Q12518 wd:Q4989906 wd:Q12280 wd:Q483110 wd:Q16970 wd:Q44539 wd:Q23413 wd:Q33506 wd:Q24354 wd:Q57821 }
      ?item wdt:P31 ?t ; wikibase:sitelinks ?sl . FILTER(?sl >= 25)
      { ?item wdt:P1619 ?d } UNION { ?item wdt:P571 ?d } ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `${clean(r.label)}: de que ano é?`, a: year(r.d), unit: 'ano' } : null),
  },
  stadiumCap: {
    cat: 'sport',
    query: `SELECT ?item ?label ?cap WHERE {
      ?item wdt:P31/wdt:P279* wd:Q483110 ; wdt:P1083 ?cap ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 10 && ?cap >= 5000) ${PT('item', 'label')} }`,
    make: (r) => ({ q: `${clean(r.label)}: quantos lugares tem o estádio?`, a: Math.round(+r.cap), unit: 'lugares' }),
  },

  // ---------- pessoas ----------
  famousBirth: {
    cat: 'famous',
    query: people(OCC_FAMOUS, 45),
    make: (r) => (name(r) && okYear(year(r.birth)) ? { q: `Em que ano nasceu ${name(r)}?`, a: year(r.birth), unit: 'ano' } : null),
  },
  brFamousBirth: {
    cat: 'famous',
    query: `SELECT ?item ?ptl ?enl ?birth ?death WHERE {
      ?item wdt:P27 wd:Q155 ; wdt:P31 wd:Q5 ; wdt:P569 ?birth ; wikibase:sitelinks ?sl . FILTER(?sl >= 30)
      OPTIONAL { ?item wdt:P570 ?death } ${PERSON_LABEL} }`,
    make: (r) => (name(r) && okYear(year(r.birth)) ? { q: `Em que ano nasceu ${name(r)}?`, a: year(r.birth), unit: 'ano' } : null),
  },
  historyBirth: {
    cat: 'history',
    query: people(OCC_HISTORY, 60),
    make: (r) => (name(r) && okYear(year(r.birth)) ? { q: `Em que ano nasceu ${name(r)}?`, a: year(r.birth), unit: 'ano' } : null),
  },
  historyDeath: {
    cat: 'history',
    query: people(OCC_HISTORY, 60),
    make: (r) => (name(r) && okYear(year(r.death)) ? { q: `Em que ano morreu ${name(r)}?`, a: year(r.death), unit: 'ano' } : null),
  },
  lifespan: {
    cat: 'history',
    query: people([...OCC_HISTORY, ...OCC_FAMOUS], 60),
    make: (r) => {
      if (!name(r) || !r.death || !/^\d{4}-/.test(r.birth) || !/^\d{4}-/.test(r.death)) return null;
      const age = Math.floor((Date.parse(r.death) - Date.parse(r.birth)) / (365.25 * 86400e3));
      return age > 0 && age < 120 ? { q: `Com quantos anos morreu ${name(r)}?`, a: age, unit: 'anos' } : null;
    },
  },
  battles: {
    cat: 'history',
    query: `SELECT ?item ?label ?d WHERE {
      VALUES ?t { wd:Q178561 wd:Q198 wd:Q124734 wd:Q3024240 wd:Q3839081 }
      ?item wdt:P31 ?t ; wikibase:sitelinks ?sl . FILTER(?sl >= 25)
      { ?item wdt:P585 ?d } UNION { ?item wdt:P580 ?d } ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `Em que ano começou: ${clean(r.label)}?`, a: year(r.d), unit: 'ano' } : null),
  },
  books: {
    cat: 'history',
    query: `SELECT ?item ?label ?d WHERE {
      VALUES ?t { wd:Q7725634 wd:Q8261 wd:Q571 }
      ?item wdt:P31 ?t ; wdt:P577 ?d ; wikibase:sitelinks ?sl . FILTER(?sl >= 30) ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `Em que ano foi publicado o livro "${clean(r.label)}"?`, a: year(r.d), unit: 'ano' } : null),
  },

  // ---------- cinema, TV e música ----------
  filmYear: {
    cat: 'screen',
    query: `SELECT ?item ?label ?d WHERE { ?item wdt:P31 wd:Q11424 ; wdt:P577 ?d ; wikibase:sitelinks ?sl . FILTER(?sl >= 30) ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `Em que ano foi lançado o filme "${clean(r.label)}"?`, a: year(r.d), unit: 'ano' } : null),
  },
  filmLength: {
    cat: 'screen',
    query: `SELECT ?item ?label ?dur WHERE {
      ?item wdt:P31 wd:Q11424 ; p:P2047/psn:P2047/wikibase:quantityAmount ?dur ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 35) ${PT('item', 'label')} }`,
    make: (r) => {
      const min = Math.round(+r.dur / 60);
      return min >= 30 && min <= 300 ? { q: `Quantos minutos dura o filme "${clean(r.label)}"?`, a: min, unit: 'minutos' } : null;
    },
  },
  seriesYear: {
    cat: 'screen',
    query: `SELECT ?item ?label ?d WHERE {
      VALUES ?t { wd:Q5398426 wd:Q581714 wd:Q63952888 wd:Q23739 }
      ?item wdt:P31 ?t ; wikibase:sitelinks ?sl . FILTER(?sl >= 15)
      { ?item wdt:P580 ?d } UNION { ?item wdt:P577 ?d } ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `Em que ano estreou "${clean(r.label)}"?`, a: year(r.d), unit: 'ano' } : null),
  },
  bands: {
    cat: 'screen',
    query: `SELECT ?item ?label ?d WHERE { ?item wdt:P31 wd:Q215380 ; wdt:P571 ?d ; wikibase:sitelinks ?sl . FILTER(?sl >= 40) ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `Em que ano foi formada a banda ${clean(r.label)}?`, a: year(r.d), unit: 'ano' } : null),
  },

  // ---------- esportes ----------
  clubsFounded: {
    cat: 'sport',
    query: `SELECT ?item ?label ?d WHERE { ?item wdt:P31 wd:Q476028 ; wdt:P571 ?d ; wikibase:sitelinks ?sl . FILTER(?sl >= 20) ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `${clean(r.label)}: em que ano o clube foi fundado?`, a: year(r.d), unit: 'ano' } : null),
  },
  athletesBirth: {
    cat: 'sport',
    query: people(['Q937857', 'Q3665646', 'Q10833314', 'Q10843402', 'Q11338576', 'Q2066131', 'Q13381376', 'Q11513337'], 40),
    make: (r) => (name(r) && okYear(year(r.birth)) ? { q: `Em que ano nasceu ${name(r)}?`, a: year(r.birth), unit: 'ano' } : null),
  },

  // ---------- tecnologia, games e empresas ----------
  gamesYear: {
    cat: 'tech',
    query: `SELECT ?item ?label ?d WHERE { ?item wdt:P31 wd:Q7889 ; wdt:P577 ?d ; wikibase:sitelinks ?sl . FILTER(?sl >= 20) ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `Em que ano foi lançado o jogo "${clean(r.label)}"?`, a: year(r.d), unit: 'ano' } : null),
  },
  companies: {
    cat: 'tech',
    query: `SELECT ?item ?label ?d WHERE {
      VALUES ?t { wd:Q4830453 wd:Q891723 wd:Q6881511 wd:Q431289 }
      ?item wdt:P31 ?t ; wdt:P571 ?d ; wikibase:sitelinks ?sl . FILTER(?sl >= 40) ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `${clean(r.label)}: em que ano a empresa foi fundada?`, a: year(r.d), unit: 'ano' } : null),
  },
  brCompanies: {
    cat: 'tech',
    query: `SELECT ?item ?label ?d WHERE {
      ?item wdt:P31 wd:Q4830453 ; wdt:P17 wd:Q155 ; wdt:P571 ?d ; wikibase:sitelinks ?sl . FILTER(?sl >= 6) ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `${clean(r.label)}: em que ano a empresa foi fundada?`, a: year(r.d), unit: 'ano' } : null),
  },

  // ---------- ciência ----------
  elements: {
    cat: 'science',
    query: `SELECT ?item ?label ?n WHERE { ?item wdt:P31 wd:Q11344 ; wdt:P1086 ?n . ${PT('item', 'label')} }`,
    make: (r) => (+r.n <= 118 ? { q: `Qual é o número atômico do elemento ${r.label}?`, a: +r.n, unit: '' } : null),
  },
  elementsYear: {
    cat: 'science',
    query: `SELECT ?item ?label ?d WHERE { ?item wdt:P31 wd:Q11344 ; wdt:P575 ?d . ${PT('item', 'label')} }`,
    make: (r) => (okYear(year(r.d)) ? { q: `Em que ano foi descoberto o elemento ${r.label}?`, a: year(r.d), unit: 'ano' } : null),
  },
};

async function sparql(query: string): Promise<Row[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query }),
      });
      if (res.ok) {
        const json = await res.json();
        return json.results.bindings.map((b: Record<string, { value: string }>) =>
          Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])),
        );
      }
      console.warn(`  HTTP ${res.status}, tentativa ${attempt}`);
    } catch (e) {
      console.warn(`  ${(e as Error).message}, tentativa ${attempt}`);
    }
    await new Promise((r) => setTimeout(r, 6000 * attempt));
  }
  throw new Error('Wikidata indisponível');
}

async function run(key: string) {
  const t = TEMPLATES[key];
  process.stdout.write(`▶ ${key} … `);
  const rows: Row[] = [];
  for (const q of Array.isArray(t.query) ? t.query : [t.query]) {
    rows.push(...(await sparql(q)));
    await new Promise((r) => setTimeout(r, 1500)); // gentil com o limite de requisições
  }
  // Um item pode vir várias vezes (várias datas/valores): fica a primeira pergunta válida
  // para datas (menor ano) e o maior valor para medidas.
  const byItem = new Map<string, Omit<QuizQuestion, 'id' | 'cat'>>();
  for (const r of rows) {
    const q = t.make(r);
    if (!q || !Number.isFinite(q.a) || q.a <= 0 || q.q.includes('http')) continue;
    const prev = byItem.get(r.item);
    if (!prev) byItem.set(r.item, q);
    else if (q.unit === 'ano' ? q.a < prev.a : q.a > prev.a) byItem.set(r.item, q);
  }
  const seen = new Set<string>();
  const out: QuizQuestion[] = [];
  for (const [item, q] of byItem) {
    if (seen.has(q.q)) continue; // nomes iguais para coisas diferentes geram ambiguidade
    seen.add(q.q);
    out.push({ id: `${key}:${item.split('/').pop()}`, cat: t.cat, ...q });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `wd-${key}.json`), '[\n' + out.map((q) => '  ' + JSON.stringify(q)).join(',\n') + '\n]\n');
  console.log(`${out.length} perguntas`);
}

const only = process.argv[2];
for (const key of only ? [only] : Object.keys(TEMPLATES)) {
  try {
    await run(key);
  } catch (e) {
    console.log(`falhou (${(e as Error).message})`);
  }
}
