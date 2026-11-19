/**
 * Gera a biblioteca do "Faz Esse Som!" (client/public/som/<id>.mp3).
 * - Sons sintetizados: fórmulas matemáticas no ffmpeg (aevalsrc).
 * - Vozes: Piper (voz neural offline) + efeitos de tom/velocidade no ffmpeg.
 * Uso: PIPER=caminho/piper.exe PIPER_VOICES=pasta/das/vozes npx tsx scripts/gen-som.ts [--force]
 * Só gera o que ainda não existe (use --force para refazer tudo).
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { SOM_LIBRARY } from '../shared/som-library.ts';

const run = promisify(execFile);
const OUT = path.resolve('client/public/som');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'som-'));
const FORCE = process.argv.includes('--force');
fs.mkdirSync(OUT, { recursive: true });

// ---------- sintetizados ----------
const harm = (ph: string) => `(sin(${ph})+0.5*sin(2*(${ph}))+0.33*sin(3*(${ph}))+0.25*sin(4*(${ph})))`;
const tau = (p: number) => `mod(t,${p})`;

interface Synth {
  expr: string;
  dur: number;
  af?: string;
}
const SYNTH: Record<string, Synth> = {
  cuco: { expr: '0.7*sin(2*PI*if(lt(t,0.38),698,587)*t)*if(lt(t,0.33),exp(-5*t),if(gt(t,0.42),exp(-5*(t-0.42)),0))', dur: 0.95 },
  grilo: { expr: '0.5*sin(2*PI*4600*t)*gt(sin(2*PI*45*t),0.2)*lt(mod(t,0.34),0.16)', dur: 1.0 },
  sapo: { expr: '0.6*(sin(2*PI*95*t)+0.6*sin(2*PI*190*t)+0.4*sin(2*PI*285*t))*gt(sin(2*PI*22*t),0)*lt(mod(t,0.45),0.28)', dur: 0.9, af: 'lowpass=f=900' },
  passarinho: { expr: `0.5*sin(2*PI*(2500*${tau(0.12)}+20000*${tau(0.12)}*${tau(0.12)}))*lt(${tau(0.12)},0.08)`, dur: 0.85 },
  'ave-rapina': { expr: '(0.45*sin(2*PI*(2900*t-700*t*t)+20*sin(2*PI*55*t))+0.12*(2*random(0)-1))*exp(-1.6*t)*(1-exp(-40*t))', dur: 1.0, af: 'highpass=f=900' },
  rugido: { expr: '(0.5*(2*random(0)-1)+0.5*sgn(sin(2*PI*(75-20*t)*t)))*(1-exp(-8*t))*(1-t/1.15)*(0.7+0.3*sin(2*PI*18*t))', dur: 1.1, af: 'lowpass=f=600' },
  moeda: { expr: '0.45*sgn(sin(2*PI*if(lt(t,0.07),988,1319)*t))*if(lt(t,0.07),1,exp(-4*(t-0.07)))', dur: 0.6 },
  pulo: { expr: '0.4*sgn(sin(2*PI*(250*t+1500*t*t)))*exp(-3*t)', dur: 0.35 },
  powerup: { expr: '0.35*sgn(sin(2*PI*330*pow(1.19,floor(t/0.05))*t))*(1-t/0.8)', dur: 0.8 },
  'game-over': { expr: '0.4*sgn(sin(2*PI*523*pow(0.89,floor(t/0.12))*t))*(1-t/1.1)', dur: 1.05 },
  laser: { expr: `0.5*sin(2*PI*1800*(1-exp(-9*${tau(0.3)}))/9)*exp(-6*${tau(0.3)})`, dur: 0.9 },
  fanfarra: { expr: '0.35*sgn(sin(2*PI*if(lt(t,0.1),523,if(lt(t,0.2),659,if(lt(t,0.3),784,1047)))*t))*if(lt(t,0.3),1,exp(-3*(t-0.3)))', dur: 0.9 },
  'robo-bip': { expr: '0.35*sgn(sin(2*PI*(300+180*floor(abs(sin(floor(t*12)*78.233))*5))*t))*gt(mod(t*12,1),0.15)', dur: 1.0 },
  boing: { expr: '0.6*sin(2*PI*180*t+12*exp(-3*t)*sin(2*PI*14*t))*exp(-2.5*t)', dur: 0.9 },
  apito: { expr: '0.5*sin(2*PI*(450*t+900*t*t)+4*sin(2*PI*6*t))*(1-exp(-30*t))', dur: 0.9 },
  queda: { expr: '0.5*sin(2*PI*(2200*t-950*t*t))*(1-exp(-30*t))', dur: 1.0 },
  trombone: {
    expr: `0.3*${harm('2*PI*if(lt(t,0.27),311,if(lt(t,0.54),294,if(lt(t,0.81),277,262)))*t+if(gt(t,0.81),3*sin(2*PI*6*t),0)')}*if(lt(mod(t,0.27),0.02),mod(t,0.27)/0.02,1)*if(gt(t,1.0),(1.3-t)/0.3,1)`,
    dur: 1.3,
    af: 'lowpass=f=2500',
  },
  buzina: { expr: `0.3*(${harm('2*PI*330*t')}+0.7*${harm('2*PI*415*t')})*lt(${tau(0.3)},0.2)`, dur: 0.55, af: 'lowpass=f=3000' },
  patinho: { expr: `0.4*sgn(sin(2*PI*(1000*${tau(0.35)}+3000*${tau(0.35)}*${tau(0.35)})+3*sin(2*PI*30*t)))*lt(${tau(0.35)},0.22)`, dur: 0.65, af: 'lowpass=f=4000' },
  ricochete: { expr: '0.5*sin(2*PI*(3000*t-1400*t*t)+6*sin(2*PI*40*t))*exp(-2*t)', dur: 0.75 },
  bolhas: { expr: `0.6*sin(2*PI*(300*${tau(0.22)}+6000*${tau(0.22)}*${tau(0.22)}))*exp(-25*${tau(0.22)})`, dur: 0.9 },
  plim: { expr: '0.5*(sin(2*PI*1568*t)+0.5*sin(2*PI*2352*t)+0.3*sin(2*PI*3920*t))*exp(-4*t)', dur: 1.0 },
  explosao: { expr: '(2*random(0)-1)*exp(-3.5*t)*(1-exp(-200*t))', dur: 1.2, af: 'lowpass=f=500,lowpass=f=500' },
  sirene: { expr: '0.5*sin(2*PI*800*t-25*cos(2*PI*2.5*t))', dur: 1.0 },
  alarme: { expr: '0.45*sgn(sin(2*PI*1000*t))*gt(sin(2*PI*7*t),0)', dur: 1.0 },
  alien: { expr: '0.5*sin(2*PI*(500*t+250*t*t)+18*sin(2*PI*6*t))', dur: 1.0 },
  'disco-voador': { expr: '0.5*sin(2*PI*700*t+4*sin(2*PI*12*t))*(0.6+0.4*sin(2*PI*30*t))', dur: 1.0 },
  modem: { expr: '0.4*sin(2*PI*(900+1400*abs(sin(floor(t*22)*12.9898)))*t)+0.15*(2*random(0)-1)', dur: 1.0 },
  pum: { expr: '0.6*sgn(sin(2*PI*85*t+2*sin(2*PI*13*t)))*(0.6+0.4*random(0))*(1-t/0.9)*(1-exp(-30*t))', dur: 0.9, af: 'lowpass=f=350,lowpass=f=600' },
};

// ---------- vozes ----------
interface Voice {
  voice: string;
  text: string;
  /** Velocidade da fala (menor = mais rápido). */
  speed?: number;
  /** Multiplica o tom (e a velocidade junto, estilo esquilo/demônio). */
  pitch?: number;
  af?: string;
}
const VOICES: Record<string, Voice> = {
  miau: { voice: 'es_ES-davefx-medium', text: '¡Miaaau!', pitch: 1.6 },
  guau: { voice: 'es_ES-davefx-medium', text: '¡Guau, guau!', speed: 0.8, pitch: 1.15 },
  muu: { voice: 'de_DE-thorsten-medium', text: 'Muuuh!', pitch: 0.75 },
  galo: { voice: 'it_IT-paola-medium', text: 'Chicchirichì!', speed: 0.8, pitch: 1.2 },
  cabra: { voice: 'es_ES-davefx-medium', text: 'Beeeeeh', pitch: 1.3, af: 'vibrato=f=9:d=0.9' },
  pato: { voice: 'en_US-lessac-medium', text: 'Quack quack!', speed: 0.7, pitch: 1.35 },
  nani: { voice: 'it_IT-paola-medium', text: 'Nanì?!', speed: 0.9, pitch: 1.2 },
  yamete: { voice: 'it_IT-paola-medium', text: 'Yamète!', speed: 0.85, pitch: 1.25 },
  sugoi: { voice: 'it_IT-paola-medium', text: 'Sugòi!', speed: 0.9, pitch: 1.25 },
  baka: { voice: 'it_IT-paola-medium', text: 'Bakà!', speed: 0.8, pitch: 1.3 },
  kawaii: { voice: 'en_US-lessac-medium', text: 'Kawaii!', speed: 0.9, pitch: 1.45 },
  yatta: { voice: 'it_IT-paola-medium', text: 'Yatta!', speed: 0.85, pitch: 1.25 },
  itadakimasu: { voice: 'it_IT-paola-medium', text: 'Itadakimasu!', speed: 0.7, pitch: 1.2 },
  'mamma-mia': { voice: 'it_IT-paola-medium', text: 'Mamma mia!', speed: 0.85 },
  'ay-caramba': { voice: 'es_ES-davefx-medium', text: '¡Ay, caramba!', speed: 0.8 },
  'oh-la-la': { voice: 'fr_FR-siwis-medium', text: 'Oh là là!', speed: 0.9, pitch: 1.1 },
  yeehaw: { voice: 'en_US-lessac-medium', text: 'Yee-haw!', speed: 0.85, pitch: 1.1 },
  vilao: { voice: 'de_DE-thorsten-medium', text: 'Muahahaha!', speed: 0.8, pitch: 0.72, af: 'aecho=0.8:0.7:60:0.4' },
  esquilo: { voice: 'es_ES-davefx-medium', text: '¡Hola, amigos!', speed: 0.9, pitch: 1.9 },
  demonio: { voice: 'de_DE-thorsten-medium', text: 'Guten Morgen.', speed: 0.9, pitch: 0.6, af: 'aecho=0.8:0.8:40:0.5' },
  grito: { voice: 'en_US-lessac-medium', text: 'Aaaaaah!', pitch: 1.45 },
  kartoffel: { voice: 'de_DE-thorsten-medium', text: 'Kartoffel!', speed: 0.8, pitch: 1.05 },
  'robo-voz': { voice: 'en_US-lessac-medium', text: 'Beep boop.', speed: 0.9, af: 'aecho=0.9:0.9:5:0.8,aecho=0.9:0.9:9:0.7' },
};

/** Corte em ≤1,5s, fade curtinho, volume uniforme, mp3 leve. */
async function encode(input: string[], mp3: string, extra: string) {
  const af = [extra, 'silenceremove=start_periods=1:start_threshold=-45dB', 'atrim=0:1.5', 'loudnorm=I=-15:TP=-1.5:LRA=11', 'aresample=44100'].filter(Boolean).join(',');
  await run('ffmpeg', ['-y', '-v', 'error', ...input, '-af', af, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', mp3]);
}

const todo = SOM_LIBRARY.filter((s) => FORCE || !fs.existsSync(path.join(OUT, `${s.id}.mp3`)));
let made = 0;

for (const s of todo) {
  const syn = SYNTH[s.id];
  if (!syn) continue;
  // Fade-out nos últimos 60ms para não estalar.
  const fade = `afade=t=out:st=${(syn.dur - 0.06).toFixed(2)}:d=0.06`;
  await encode(['-f', 'lavfi', '-i', `aevalsrc='${syn.expr}':s=44100:d=${syn.dur}`], path.join(OUT, `${s.id}.mp3`), [syn.af, fade].filter(Boolean).join(','));
  made++;
}

const voiced = todo.filter((s) => VOICES[s.id]);
if (voiced.length) {
  const PIPER = process.env.PIPER;
  const DIR = process.env.PIPER_VOICES;
  if (!PIPER || !DIR) throw new Error('Defina PIPER e PIPER_VOICES para gerar as vozes.');
  for (const s of voiced) {
    const v = VOICES[s.id];
    const wav = path.join(TMP, `${s.id}.wav`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(PIPER, ['--model', path.join(DIR, `${v.voice}.onnx`), '--length_scale', String(v.speed ?? 1), '--output_file', wav]);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper saiu com ${code}`))));
      p.stderr.resume();
      p.stdout.resume();
      p.stdin.end(v.text);
    });
    const pitch = v.pitch ? `asetrate=${Math.round(22050 * v.pitch)},aresample=22050` : '';
    await encode(['-i', wav], path.join(OUT, `${s.id}.mp3`), [pitch, v.af].filter(Boolean).join(','));
    made++;
  }
}

const missing = SOM_LIBRARY.filter((s) => !fs.existsSync(path.join(OUT, `${s.id}.mp3`)));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`Pronto: ${made} gerados.${missing.length ? ` Sem arquivo: ${missing.map((s) => s.id).join(', ')}` : ''}`);
