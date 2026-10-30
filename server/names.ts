import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../shared/normalize.ts';
import { THEMES, THEME_IDS, type Theme } from '../shared/types.ts';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export interface Entity {
  id: string;
  name: string;
  /** Letras iniciais possíveis (nome + apelidos). */
  letters: Set<string>;
}

export type LookupResult =
  | { status: 'ok'; entity: Entity }
  | { status: 'used'; entity: Entity }
  | { status: 'unknown' };

// Prefixos/sufixos comuns de clubes que o jogador pode omitir ("FC Porto" -> "Porto").
const CLUB_AFFIXES = new Set([
  'fc', 'cf', 'sc', 'ac', 'afc', 'as', 'ss', 'ssc', 'cd', 'ec', 'se', 'sd', 'ca', 'cr', 'rc', 'rcd', 'ud',
  'club', 'clube', 'futebol', 'football', 'calcio', 'vfb', 'vfl', 'tsg', 'sv', 'fk', 'sk', 'bk', 'ogc', 'cp', 'sl',
]);

function clubVariants(key: string): string[] {
  const tokens = key.split(' ');
  let start = 0;
  let end = tokens.length;
  while (end - start > 1 && CLUB_AFFIXES.has(tokens[start])) start++;
  while (end - start > 1 && CLUB_AFFIXES.has(tokens[end - 1])) end--;
  const stripped = tokens.slice(start, end).join(' ');
  return stripped !== key && stripped.length >= 3 ? [stripped] : [];
}

function singular(w: string) {
  if (w.length < 4) return w;
  if (/(oes|aes)$/.test(w)) return w.slice(0, -3) + 'ao';
  if (/[aeo]is$/.test(w)) return w.slice(0, -2) + 'l';
  if (w.endsWith('ns')) return w.slice(0, -2) + 'm';
  if (/[rzs]es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function masculine(w: string) {
  if (w.length < 4) return w;
  if (w.endsWith('ora')) return w.slice(0, -1);
  if (w.endsWith('a')) return w.slice(0, -1) + 'o';
  return w;
}

function wordVariants(key: string): string[] {
  const words = key.split(' ');
  const forms = [singular, masculine, (w: string) => masculine(singular(w))];
  return [...new Set(forms.map((f) => words.map(f).join(' ')))].filter((v) => v !== key);
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export class NameIndex {
  readonly entities: Entity[] = [];
  private byKey = new Map<string, Entity[]>();
  private keysByLetter = new Map<string, string[]>();

  constructor(file: string, private theme: Theme) {
    const records: { name: string; aliases?: string[] }[] = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const rec of records) {
      const base = normalize(rec.name);
      if (!base) continue;
      // Prefixo do tema: "laranja" cor e "laranja" fruta são respostas diferentes.
      const id = `${theme}:${base}`;
      const entity: Entity = { id, name: rec.name, letters: new Set() };
      const keys = new Set<string>();
      for (const n of [rec.name, ...(rec.aliases ?? [])]) {
        const k = normalize(n);
        if (!k) continue;
        keys.add(k);
        if (theme === 'clubs') clubVariants(k).forEach((v) => keys.add(v));
      }
      for (const k of keys) {
        entity.letters.add(k[0].toUpperCase());
        const list = this.byKey.get(k);
        if (list) list.push(entity);
        else this.byKey.set(k, [entity]);
      }
      this.entities.push(entity);
    }
    for (const k of this.byKey.keys()) {
      const l = k[0].toUpperCase();
      if (!this.keysByLetter.has(l)) this.keysByLetter.set(l, []);
      this.keysByLetter.get(l)!.push(k);
    }
  }

  /** Quantas entidades ainda não usadas podem ser respondidas com a letra. */
  available(letter: string, used: Set<string>): number {
    let n = 0;
    for (const e of this.entities) if (e.letters.has(letter) && !used.has(e.id)) n++;
    return n;
  }

  lookup(text: string, used: Set<string>): LookupResult {
    const typed = normalize(text);
    if (!typed) return { status: 'unknown' };
    // "Flamengo FC" -> "flamengo", mas só se a letra inicial continuar a mesma.
    const variant = this.theme === 'clubs' ? clubVariants(typed)[0] : undefined;
    const key = variant && variant[0] === typed[0] ? variant : typed;
    const exact = this.byKey.get(typed) ?? this.byKey.get(key);
    if (exact) return pick(exact, used);

    // Plural e feminino: "gatas" -> gato, "leões" -> leão, "professora" -> professor.
    if (THEMES[this.theme].wordForms) {
      for (const v of wordVariants(typed)) {
        const hit = this.byKey.get(v);
        if (hit) return pick(hit, used);
      }
    }

    // Tolerância a pequenos erros de digitação em nomes mais longos.
    const max = key.length >= 10 ? 2 : key.length >= 5 ? 1 : 0;
    if (max === 0) return { status: 'unknown' };
    let best = max + 1;
    let candidates: Entity[] = [];
    for (const k of this.keysByLetter.get(key[0].toUpperCase()) ?? []) {
      const d = levenshtein(key, k, max);
      if (d < best) {
        best = d;
        candidates = [...this.byKey.get(k)!];
      } else if (d === best) {
        candidates.push(...this.byKey.get(k)!);
      }
    }
    if (best > max) return { status: 'unknown' };
    const distinct = [...new Map(candidates.map((e) => [e.id, e])).values()];
    const unused = distinct.filter((e) => !used.has(e.id));
    if (unused.length === 1) return { status: 'ok', entity: unused[0] };
    if (unused.length === 0) return { status: 'used', entity: distinct[0] };
    return { status: 'unknown' }; // ambíguo: melhor pedir para digitar certinho
  }
}

function pick(list: Entity[], used: Set<string>): LookupResult {
  const free = list.find((e) => !used.has(e.id));
  return free ? { status: 'ok', entity: free } : { status: 'used', entity: list[0] };
}

export const NAME_INDEXES = Object.fromEntries(
  THEME_IDS.map((t) => [t, new NameIndex(path.join(DATA_DIR, `${t}.json`), t)]),
) as Record<Theme, NameIndex>;
