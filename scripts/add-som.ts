/**
 * Acrescenta um som à biblioteca do "Faz Esse Som!".
 * Uso: npm run som:add -- caminho/do/arquivo.mp3 id-do-som "Título" 🐸 categoria [início-em-segundos]
 * Categorias: bicho, jogo, desenho, anime, voz, absurdo.
 * Use apenas arquivos que você tem direito de usar (gravados por você, domínio público ou licença livre).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SOM_CATEGORIES, SOM_LIBRARY, type SomCategory } from '../shared/som-library.ts';

const [file, id, title, emoji, cat, start = '0'] = process.argv.slice(2);
const fail = (msg: string) => {
  console.error(msg);
  process.exit(1);
};
if (!file || !id || !title || !emoji || !cat) fail('Uso: npm run som:add -- arquivo.mp3 id "Título" 🐸 categoria [início]');
if (!fs.existsSync(file)) fail(`Arquivo não encontrado: ${file}`);
if (!/^[a-z0-9-]+$/.test(id)) fail('O id só pode ter letras minúsculas, números e hífen.');
if (!(cat in SOM_CATEGORIES)) fail(`Categoria inválida. Use: ${Object.keys(SOM_CATEGORIES).join(', ')}`);
if (SOM_LIBRARY.some((s) => s.id === id)) fail(`Já existe um som com o id "${id}".`);

const out = path.resolve('client/public/som', `${id}.mp3`);
await promisify(execFile)('ffmpeg', [
  '-y', '-v', 'error', '-ss', start, '-i', file,
  '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:1.5,afade=t=out:st=1.42:d=0.08,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=44100',
  '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', out,
]);

const lib = path.resolve('shared/som-library.ts');
const src = fs.readFileSync(lib, 'utf8');
const marker = '  // ↑ novos sons entram aqui';
const line = `  { id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, emoji: ${JSON.stringify(emoji)}, cat: ${JSON.stringify(cat as SomCategory)} },\n`;
fs.writeFileSync(lib, src.replace(marker, line + marker));
console.log(`Som "${title}" adicionado: client/public/som/${id}.mp3`);
