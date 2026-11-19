/**
 * Acrescenta um som à biblioteca do "Faz Esse Som!".
 * Uso: npm run som:add -- arquivo.mp3 id-do-som "Título" 🐸 categoria dificuldade [início-em-s] [duração-em-s] [--estourado]
 *   categorias: meme, phonk, musica, bicho, anime, jogo, efeito
 *   dificuldades: facil, dificil, impossivel
 *   --estourado: para áudios já distorcidos/earrape (fica um pouco mais baixo, como os outros desse tipo)
 * Ex.: npm run som:add -- grito.mp3 grito-do-joao "Grito do João" 😱 meme impossivel 0.4 1.2
 * Use apenas arquivos que você tem direito de usar (gravados por você, domínio público ou licença livre).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SOM_CATEGORIES, SOM_DIFFICULTIES, SOM_LIBRARY } from '../shared/som-library.ts';

const args = process.argv.slice(2);
const hot = args.includes('--estourado');
const [file, id, title, emoji, cat, diff, start = '0', dur = '2'] = args.filter((a) => a !== '--estourado');
const fail = (msg: string) => {
  console.error(msg);
  process.exit(1);
};
if (!file || !id || !title || !emoji || !cat || !diff) fail('Uso: npm run som:add -- arquivo.mp3 id "Título" 🐸 categoria dificuldade [início] [duração] [--estourado]');
if (!fs.existsSync(file)) fail(`Arquivo não encontrado: ${file}`);
if (!/^[a-z0-9-]+$/.test(id)) fail('O id só pode ter letras minúsculas, números e hífen.');
if (!(cat in SOM_CATEGORIES)) fail(`Categoria inválida. Use: ${Object.keys(SOM_CATEGORIES).join(', ')}`);
if (!(diff in SOM_DIFFICULTIES)) fail(`Dificuldade inválida. Use: ${Object.keys(SOM_DIFFICULTIES).join(', ')}`);
if (SOM_LIBRARY.some((s) => s.id === id)) fail(`Já existe um som com o id "${id}".`);
const length = Math.min(2, Math.max(0.3, Number(dur) || 2));

const out = path.resolve('client/public/som', `${id}.mp3`);
await promisify(execFile)('ffmpeg', [
  '-y', '-v', 'error', '-ss', start, '-t', String(length), '-i', file,
  '-af', `areverse,afade=t=in:d=0.04,areverse,loudnorm=I=${hot ? -18 : -16}:TP=-2:LRA=11,alimiter=limit=0.8,aresample=44100`,
  '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '80k', out,
]);

const lib = path.resolve('shared/som-library.ts');
const src = fs.readFileSync(lib, 'utf8');
const marker = '  // ↑ novos sons entram aqui';
const line = `  { id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, emoji: ${JSON.stringify(emoji)}, cat: ${JSON.stringify(cat)}, diff: ${JSON.stringify(diff)} },\n`;
fs.writeFileSync(lib, src.replace(marker, line + marker));
console.log(`Som "${title}" adicionado: client/public/som/${id}.mp3`);
