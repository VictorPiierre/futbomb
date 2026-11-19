/**
 * Importa uma pasta inteira de áudios para o "Faz Esse Som!".
 * Uso: npm run som:import -- "C:/caminho/da/pasta" [--max 10]
 * - Cada arquivo vira um som (nome e emoji tirados do nome do arquivo).
 * - Tira o silêncio do começo e do fim; áudios maiores que --max (padrão 10s) ficam com o começo.
 * - Volume igualado (os "estourados"/earrape ficam um pouco mais baixos) e limitador no fim.
 * - Sons já importados (mesmo id) são pulados.
 * Saída: client/public/som/<id>.mp3 + linhas em shared/som-library.ts.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SOM_LIBRARY } from '../shared/som-library.ts';

const run = promisify(execFile);
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const maxIdx = args.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(args[maxIdx + 1]) || 10 : 10;
if (!dir || !fs.existsSync(dir)) {
  console.error('Uso: npm run som:import -- "pasta" [--max 10]');
  process.exit(1);
}

const AUDIO = /\.(mp3|wav|ogg|m4a|aac|opus|webm|flac|mp4)$/i;

/** Nomes que não dá para adivinhar pelo arquivo. */
const TITLE_FIX: Record<string, string> = {
  'aud-20200920-wa0045': 'Áudio do zap',
  'rpreplay-final1623689697-mov': 'Gravação de tela misteriosa',
  'untitled-605': 'Áudio sem nome 605',
  'movie-1': 'Movie',
  'comedy-male-yelling-yee-ha-sound-effects-free-download-mp3cut': 'Yee-ha!',
  'slayer-angel-of-death-scream-when-you-accidentally-step-on-a-lego-reign-in-blood': 'Grito do Slayer (pisou no Lego)',
  'korn-twist-audiotrimmer': 'Korn — Twist',
  'the-tokens-the-lion-sleeps-tonight-cutted': 'The Lion Sleeps Tonight',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-e-lutador': 'AAAAAAAAAA é lutador',
  'aiiiiiiiiiiiiiiiiiiiiiii-estourado': 'Aiiiiiiiii estourado',
  'oh-wa-ah-ah-ah-disturbed-vocal-only': 'Oh-wa-ah-ah-ah (Disturbed)',
  'lula-vai-todo-mindo-se-fdr': 'Lula: vai todo mundo se f...',
  'its-time-mariah-carey': "It's time (Mariah Carey)",
  'the-who-yell-wont-get-fooled-again': 'Grito do The Who',
  'murder-in-my-mind-intro': 'Murder In My Mind',
  'neon-blade-bass-boost': 'Neon Blade bass boost',
  'som-do-zap-zap-estourado': 'Som do zap estourado',
  'cebolinha-xingando': 'Cebolinha xingando',
};

/** Emoji pelo nome do arquivo (o primeiro que bater). */
const EMOJI: [RegExp, string][] = [
  [/gato|cat|miau|meow|m-e-o-w/, '🐱'],
  [/eagle|bird|chicken|galinha|passaro/, '🐦'],
  [/frog|sapo/, '🐸'],
  [/dolphin|golfinho/, '🐬'],
  [/elk|alce/, '🦌'],
  [/bankai|ichigo|muda|zehahaha|anime/, '🎌'],
  [/lula|moraes/, '🗣️'],
  [/neymar|corinthians/, '⚽'],
  [/fart|pum|brain/, '💨'],
  [/snore|ronco/, '😴'],
  [/sia|scatman|tokens|lion|mariah|korn|slayer|the-who|murder|neon|spiderman|tiki|song|sigma|disturbed|hello-moto/, '🎵'],
  [/laugh|risada|hee|haha|kiko/, '😂'],
  [/estourad|earrape|boost/, '💥'],
  [/scream|grito|yell|aaa|ai|ayyy|raaar|ahh|faaah|ack/, '😱'],
  [/among|pou|free-fire|google|zap/, '📱'],
  [/bom-dia|casal|carlinhos|gripadinha|droga|cuidado|aguento/, '🗣️'],
];

const slug = (t: string) =>
  t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Tira sufixos aleatórios de sites de memes (ex.: "_lQttrE9", "-_4RoTPVe"). */
const clean = (base: string) => base.replace(/[-_]+[A-Za-z0-9]{7}$/, (m) => (/[A-Z]/.test(m) && /[a-z]/.test(m) ? '' : m));

function titleOf(key: string) {
  if (TITLE_FIX[key]) return TITLE_FIX[key];
  const t = key.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 40);
}

const files = fs.readdirSync(dir).filter((f) => AUDIO.test(f)).sort();
const known = new Set(SOM_LIBRARY.map((s) => s.id));
const lines: string[] = [];
const cut: string[] = [];
const failed: string[] = [];
for (const f of files) {
  const key = slug(clean(f.replace(AUDIO, '')));
  let id = key.slice(0, 60) || 'som';
  if (known.has(id)) {
    console.log(`= já existe: ${f}`);
    continue;
  }
  for (let i = 2; known.has(id); i++) id = `${key.slice(0, 56)}-${i}`;
  known.add(id);
  const src = path.join(dir, f);
  const hot = /estourad|earrape|boost/.test(key);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]);
  const duration = Number(stdout.trim()) || 0;
  if (duration > MAX + 0.5) cut.push(`${f} (${duration.toFixed(1)}s)`);
  const af = [
    'silenceremove=start_periods=1:start_threshold=-50dB',
    'areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    `atrim=0:${MAX}`,
    'areverse,afade=t=in:d=0.05,areverse',
    `loudnorm=I=${hot ? -18 : -16}:TP=-2:LRA=11`,
    'alimiter=limit=0.8',
    'aresample=44100',
  ].join(',');
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-af', af, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', path.resolve('client/public/som', `${id}.mp3`)]);
  } catch (e) {
    failed.push(`${f}: ${(e as Error).message.split('\n')[0]}`);
    continue;
  }
  const emoji = EMOJI.find(([re]) => re.test(key))?.[1] ?? '🔊';
  lines.push(`  { id: ${JSON.stringify(id)}, title: ${JSON.stringify(titleOf(key))}, emoji: ${JSON.stringify(emoji)} },\n`);
  console.log(`✔ ${f} → ${id}.mp3`);
}

const lib = path.resolve('shared/som-library.ts');
const marker = '  // ↑ novos sons entram aqui';
fs.writeFileSync(lib, fs.readFileSync(lib, 'utf8').replace(marker, lines.join('') + marker));
console.log(`\nImportados: ${lines.length} de ${files.length}.`);
if (cut.length) console.log(`\nMaiores que ${MAX}s (ficou o começo):\n- ${cut.join('\n- ')}`);
if (failed.length) console.log(`\nFalharam:\n- ${failed.join('\n- ')}`);
