/**
 * Gera o áudio de cada palavra do Ouvidão com o Piper (voz neural offline) e o ffmpeg.
 * Uso: PIPER=caminho/piper.exe PIPER_VOICES=pasta/das/vozes npx tsx scripts/gen-ear-audio.ts
 * Saída: client/public/ear/<id>.mp3 (só gera o que ainda não existe).
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { EarDifficulty, EarLang } from '../shared/ear.ts';
import { EAR_WORDS } from '../server/ear-words.ts';

const run = promisify(execFile);
const PIPER = process.env.PIPER!;
const VOICES = process.env.PIPER_VOICES!;
const OUT = path.resolve('client/public/ear');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ear-'));

const VOICE: Record<EarLang, string> = {
  en: 'en_US-lessac-medium',
  es: 'es_ES-davefx-medium',
  fr: 'fr_FR-siwis-medium',
  it: 'it_IT-paola-medium',
  de: 'de_DE-thorsten-medium',
};
/** Mais devagar no fácil, ritmo natural no difícil. */
const SPEED: Record<EarDifficulty, number> = { easy: 1.3, medium: 1.12, hard: 1.0 };

fs.mkdirSync(OUT, { recursive: true });

async function piper(voice: string, speed: number, jobs: { text: string; file: string }[]) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PIPER, ['--model', path.join(VOICES, `${voice}.onnx`), '--length_scale', String(speed), '--json-input', '--sentence_silence', '0.1']);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper saiu com ${code}`))));
    p.stderr.resume();
    p.stdout.resume();
    for (const j of jobs) p.stdin.write(JSON.stringify({ text: j.text, output_file: j.file }) + '\n');
    p.stdin.end();
  });
}

/** Silêncio curto no começo (alguns celulares cortam o início), volume alto e uniforme, mp3 leve. */
async function encode(wav: string, mp3: string) {
  await run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-af', 'adelay=150,loudnorm=I=-14:TP=-1.5:LRA=11,apad=pad_dur=0.2', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', mp3]);
}

let made = 0;
for (const lang of Object.keys(EAR_WORDS) as EarLang[]) {
  for (const diff of Object.keys(EAR_WORDS[lang]) as EarDifficulty[]) {
    const todo = EAR_WORDS[lang][diff].filter((w) => !fs.existsSync(path.join(OUT, `${w.audio}.mp3`)));
    if (!todo.length) continue;
    const jobs = todo.map((w) => ({ text: w.say, file: path.join(TMP, `${w.audio}.wav`), id: w.audio }));
    await piper(VOICE[lang], SPEED[diff], jobs);
    for (let i = 0; i < jobs.length; i += 8) {
      await Promise.all(jobs.slice(i, i + 8).map((j) => encode(j.file, path.join(OUT, `${j.id}.mp3`))));
    }
    made += jobs.length;
    console.log(`${lang} ${diff}: ${jobs.length} áudios`);
  }
}

// Áudio do botão "Testar o som".
const test = path.join(OUT, 'teste.mp3');
if (!fs.existsSync(test)) {
  const wav = path.join(TMP, 'teste.wav');
  await piper('en_US-lessac-medium', 1.1, [{ text: 'Hello! Can you hear me?', file: wav }]);
  await encode(wav, test);
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`Pronto: ${made} novos.`);
