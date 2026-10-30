/**
 * Baixa listas grandes do Wikidata (CC0) para data/extra/<tema>.json.
 * Uso: npm run fetch:wikidata            (todos)
 *      npm run fetch:wikidata -- movies  (só um tema)
 *
 * As listas "extra" ampliam o reconhecimento; o sorteio de letras usa só o banco principal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../shared/normalize.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'extra');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'PavioCurtoWordlist/1.0 (jogo de palavras; contato digiartsgrafica@gmail.com)';

// Cada consulta devolve ?item e ?sl (sitelinks); os rótulos são buscados depois.
const pt = (where: string) => `SELECT DISTINCT ?item WHERE { ${where} }`;
const QUERIES: Record<string, string[]> = {
  // Por profissão (consultar "todos os humanos" estoura o tempo limite do Wikidata).
  famous: [
    ...[
      'Q33999', 'Q10800557', 'Q177220', 'Q639669', 'Q488205', 'Q2252262', 'Q36834', 'Q753110', 'Q82955', 'Q36180',
      'Q1028181', 'Q2526255', 'Q947873', 'Q245068', 'Q4610556', 'Q17125263', 'Q13474373', 'Q2066131', 'Q3665646',
      'Q10833314', 'Q10873124', 'Q378622', 'Q11338576', 'Q901', 'Q170790', 'Q39631', 'Q42973', 'Q116', 'Q1097498',
    ].map((occ) => pt(`?item wdt:P106 wd:${occ} ; wikibase:sitelinks ?sl . FILTER(?sl >= 35)`)),
    pt('?item wdt:P27 wd:Q155 ; wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl . FILTER(?sl >= 12)'),
  ],
  players: [
    pt('?item wdt:P106 wd:Q937857 ; wikibase:sitelinks ?sl . FILTER(?sl >= 30)'),
    pt('?item wdt:P106 wd:Q937857 ; wdt:P27 wd:Q155 ; wikibase:sitelinks ?sl . FILTER(?sl >= 8)'),
  ],
  clubs: [pt('?item wdt:P31 wd:Q476028 ; wikibase:sitelinks ?sl . FILTER(?sl >= 12)')],
  movies: [
    pt('?item wdt:P31 wd:Q11424 ; wikibase:sitelinks ?sl . FILTER(?sl >= 25)'),
    pt('?item wdt:P31 wd:Q11424 ; wdt:P495 wd:Q155 ; wikibase:sitelinks ?sl . FILTER(?sl >= 4)'),
  ],
  shows: [
    pt('?item wdt:P31 wd:Q5398426 ; wikibase:sitelinks ?sl . FILTER(?sl >= 15)'),
    pt('?item wdt:P31 wd:Q581714 ; wikibase:sitelinks ?sl . FILTER(?sl >= 8)'),
    pt('?item wdt:P31 wd:Q63952888 ; wikibase:sitelinks ?sl . FILTER(?sl >= 8)'),
    pt('?item wdt:P31 wd:Q23739 ; wdt:P495 wd:Q155 .'),
  ],
  games: [
    pt('?item wdt:P31 wd:Q7889 ; wikibase:sitelinks ?sl . FILTER(?sl >= 12)'),
    pt('?item wdt:P31 wd:Q131436 ; wikibase:sitelinks ?sl . FILTER(?sl >= 8)'),
  ],
  brands: [
    pt('?item wdt:P31 wd:Q431289 ; wikibase:sitelinks ?sl . FILTER(?sl >= 6)'),
    pt('?item wdt:P31 wd:Q4830453 ; wikibase:sitelinks ?sl . FILTER(?sl >= 40)'),
    pt('?item wdt:P31 wd:Q891723 ; wikibase:sitelinks ?sl . FILTER(?sl >= 25)'),
    pt('?item wdt:P31 wd:Q6881511 ; wikibase:sitelinks ?sl . FILTER(?sl >= 30)'),
    pt('?item wdt:P31 wd:Q4830453 ; wdt:P17 wd:Q155 ; wikibase:sitelinks ?sl . FILTER(?sl >= 5)'),
    pt('?item wdt:P31 wd:Q891723 ; wdt:P17 wd:Q155 .'),
  ],
  cities: [
    pt('?item wdt:P31/wdt:P279* wd:Q515 ; wdt:P1082 ?pop . FILTER(?pop >= 250000)'),
  ],
};

async function sparql(query: string): Promise<Record<string, { value: string }>[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    console.warn(`  consulta falhou (${res.status}), tentativa ${attempt}`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error('Wikidata indisponível');
}

/** Rótulos em português (ou inglês) e apelidos em português, em lotes. */
async function labels(ids: string[]) {
  const out = new Map<string, { name: string; aliases: Set<string> }>();
  for (let i = 0; i < ids.length; i += 400) {
    const values = ids.slice(i, i + 400).map((id) => `wd:${id}`).join(' ');
    const rows = await sparql(`SELECT ?item ?ptl ?enl ?alt WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item rdfs:label ?ptl FILTER(LANG(?ptl) = "pt" || LANG(?ptl) = "pt-br") }
      OPTIONAL { ?item rdfs:label ?enl FILTER(LANG(?enl) = "en") }
      OPTIONAL { ?item skos:altLabel ?alt FILTER(LANG(?alt) = "pt" || LANG(?alt) = "pt-br") }
    }`);
    for (const r of rows) {
      const id = r.item.value.split('/').pop()!;
      const name = r.ptl?.value ?? r.enl?.value;
      if (!name || /^Q\d+$/.test(name)) continue;
      const e = out.get(id) ?? { name, aliases: new Set<string>() };
      if (r.ptl && e.name !== r.ptl.value) e.name = r.ptl.value;
      if (r.enl && r.enl.value !== e.name) e.aliases.add(r.enl.value);
      if (r.alt && r.alt.value.length <= 40) e.aliases.add(r.alt.value);
      out.set(id, e);
    }
    process.stdout.write(`\r  rótulos ${Math.min(i + 400, ids.length)}/${ids.length}`);
  }
  process.stdout.write('\n');
  return out;
}

// Remove desambiguações do tipo "Titanic (filme de 1997)".
const clean = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

async function run(theme: string) {
  console.log(`▶ ${theme}`);
  const ids = new Set<string>();
  for (const q of QUERIES[theme]) {
    const rows = await sparql(q);
    rows.forEach((r) => ids.add(r.item.value.split('/').pop()!));
    console.log(`  +${rows.length} itens`);
  }
  const map = await labels([...ids]);
  const byKey = new Map<string, { name: string; aliases: string[] }>();
  for (const { name, aliases } of map.values()) {
    const n = clean(name);
    const key = normalize(n);
    if (key.length < 2 || key.length > 60) continue;
    const al = [...aliases].map(clean).filter((a) => normalize(a).length >= 2 && normalize(a) !== key);
    const prev = byKey.get(key);
    if (prev) prev.aliases = [...new Set([...prev.aliases, ...al])];
    else byKey.set(key, { name: n, aliases: [...new Set(al)].slice(0, 8) });
  }
  const records = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${theme}.json`), '[\n' + records.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
  console.log(`  ✔ ${records.length} nomes em data/extra/${theme}.json`);
}

const only = process.argv[2];
for (const theme of only ? [only] : Object.keys(QUERIES)) await run(theme);
