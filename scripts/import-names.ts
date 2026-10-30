/**
 * Importa jogadores ou clubes para o banco de nomes (data/players.json | data/clubs.json).
 *
 * Uso:
 *   npm run import -- jogadores caminho/arquivo.csv
 *   npm run import -- clubes caminho/arquivo.json
 *   npm run import -- jogadores arquivo.csv --substituir   (troca o banco inteiro)
 *
 * CSV: uma entidade por linha -> nome,apelido1|apelido2|...
 *      (cabeçalho "nome,apelidos" opcional; separador "," ou ";")
 * JSON: [{ "name": "Lionel Messi", "aliases": ["Messi", "Leo Messi"] }, ...]
 *       ou simplesmente ["Lionel Messi", "Neymar"]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../shared/normalize.ts';

export interface NameRecord {
  name: string;
  aliases: string[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS: Record<string, string> = {
  jogadores: 'players.json', players: 'players.json',
  clubes: 'clubs.json', clubs: 'clubs.json',
};

function parseCsv(content: string): NameRecord[] {
  const out: NameRecord[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.includes(';') ? ';' : ',';
    const [name, aliases = ''] = line.split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
    if (!name || /^(nome|name)$/i.test(name)) continue;
    out.push({ name, aliases: aliases.split('|').map((a) => a.trim()).filter(Boolean) });
  }
  return out;
}

function parseJson(content: string): NameRecord[] {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) throw new Error('O JSON precisa ser uma lista.');
  return data.map((item) =>
    typeof item === 'string'
      ? { name: item, aliases: [] }
      : { name: String(item.name ?? item.nome), aliases: (item.aliases ?? item.apelidos ?? []).map(String) },
  );
}

export function mergeRecords(base: NameRecord[], incoming: NameRecord[]) {
  const byKey = new Map(base.map((r) => [normalize(r.name), { ...r, aliases: [...r.aliases] }]));
  let added = 0;
  let updated = 0;
  for (const rec of incoming) {
    const key = normalize(rec.name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { name: rec.name, aliases: dedupe(rec.aliases, rec.name) });
      added++;
    } else {
      const merged = dedupe([...existing.aliases, ...rec.aliases], existing.name);
      if (merged.length !== existing.aliases.length) updated++;
      existing.aliases = merged;
    }
  }
  const records = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { records, added, updated };
}

function dedupe(aliases: string[], name: string) {
  const seen = new Set([normalize(name)]);
  return aliases.filter((a) => {
    const k = normalize(a);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function main() {
  const [kind, file, ...flags] = process.argv.slice(2);
  const target = TARGETS[kind?.toLowerCase() ?? ''];
  if (!target || !file) {
    console.error('Uso: npm run import -- <jogadores|clubes> <arquivo.csv|arquivo.json> [--substituir]');
    process.exit(1);
  }
  const content = fs.readFileSync(path.resolve(file), 'utf8').replace(/^﻿/, '');
  const incoming = file.toLowerCase().endsWith('.json') ? parseJson(content) : parseCsv(content);
  const outPath = path.join(ROOT, 'data', target);
  const replace = flags.includes('--substituir') || flags.includes('--replace');
  const base: NameRecord[] = !replace && fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : [];
  const { records, added, updated } = mergeRecords(base, incoming);
  fs.writeFileSync(outPath, '[\n' + records.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
  console.log(`✔ ${target}: ${added} novos, ${updated} atualizados, total ${records.length}.`);
}

main();
