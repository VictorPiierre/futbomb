/**
 * Gera a biblioteca do "Faz Esse Som!" (client/public/som/<id>.mp3).
 * - Sintetizados: fórmulas matemáticas no ffmpeg (aevalsrc) + filtros (distorção, grave, eco…).
 * - Vozes: Piper (voz neural offline) + tom/velocidade/distorção no ffmpeg.
 * - Combos: várias camadas mixadas no tempo (memes em sequência e as batidas de phonk).
 * Tudo é criação original deste projeto (sem trechos de músicas ou memes de terceiros).
 * Uso: PIPER=caminho/piper.exe PIPER_VOICES=pasta/das/vozes npx tsx scripts/gen-som.ts [--force] [ids...]
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
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.filter((a) => !a.startsWith('--'));
fs.mkdirSync(OUT, { recursive: true });

// ---------- receitas ----------
const harm = (ph: string, n = 4) => `(${Array.from({ length: n }, (_, i) => `${(1 / (i + 1)).toFixed(2)}*sin(${i + 1}*(${ph}))`).join('+')})`;
const tau = (p: number) => `mod(t,${p})`;
/** Distorção "estourada" com volume controlado (o loudnorm no fim segura o volume final). */
const BLOWN = 'volume=14dB,asoftclip=type=hard:threshold=0.45';
const BASS = (g = 18) => `bass=g=${g}:f=100`;

interface Synth {
  expr: string;
  dur: number;
  af?: string;
}
interface Voice {
  voice: string;
  text: string;
  speed?: number;
  pitch?: number;
  af?: string;
}
interface Part {
  src: Recipe;
  at: number;
  vol?: number;
}
type Recipe = { synth: Synth } | { voice: Voice } | { combo: Part[]; af?: string; dur?: number };
interface Entry {
  recipe: Recipe;
  /** Sons distorcidos soam mais altos: ficam um pouco abaixo no volume final. */
  hot?: boolean;
}

const s = (expr: string, dur: number, af?: string): Recipe => ({ synth: { expr, dur, af } });
const v = (voice: string, text: string, o: Partial<Voice> = {}): Recipe => ({ voice: { voice, text, ...o } });
const EN = 'en_US-lessac-medium';
const ES = 'es_ES-davefx-medium';
const IT = 'it_IT-paola-medium';
const DE = 'de_DE-thorsten-medium';

// Peças reaproveitadas.
const PUM = '0.6*sgn(sin(2*PI*85*t+2*sin(2*PI*13*t)))*(0.6+0.4*random(0))*(1-t/0.9)*(1-exp(-30*t))';
const EXPLOSAO = '(2*random(0)-1)*exp(-3.5*t)*(1-exp(-200*t))';
const RUGIDO = (f: number, trem: number) => `(0.5*(2*random(0)-1)+0.5*sgn(sin(2*PI*(${f}-20*t)*t)))*(1-exp(-8*t))*(1-t/1.15)*(0.7+0.3*sin(2*PI*${trem}*t))`;
const AIR_HORN = `0.3*(${harm('2*PI*370*t', 6)}+${harm('2*PI*466*t+0.5', 6)})*(lt(t,0.13)+gt(t,0.18)*lt(t,0.31)+gt(t,0.36)*lt(t,1.2))`;
const BONK = '0.8*sin(2*PI*700*t)*exp(-40*t)+0.7*sin(2*PI*(180*t-200*t*t))*exp(-18*t)';
const BOOM = '0.9*sin(2*PI*(40*t+13.33*(1-exp(-12*t))))*exp(-2.2*t)+0.5*(2*random(0)-1)*exp(-200*t)';
const CLANG = '0.3*(sin(2*PI*523*t)+0.8*sin(2*PI*1371*t)+0.6*sin(2*PI*2358*t)+0.5*sin(2*PI*3613*t)+0.35*sin(2*PI*5120*t))*exp(-3*t)+0.4*(2*random(0)-1)*exp(-80*t)';
const GOOFY_SCREAM = v(EN, 'Aaaaaaaaah!', { speed: 0.9, pitch: 1.7, af: `vibrato=f=12:d=0.8,acrusher=bits=5:mix=0.6:samples=2,${BLOWN}` });

// Instrumentos de phonk.
const COWBELL = (f: number) => s(`0.4*(sgn(sin(2*PI*${f}*t))+sgn(sin(2*PI*${(f * 1.48).toFixed(1)}*t)))*exp(-22*t)`, 0.22, `bandpass=f=${Math.round(f * 1.2)}:width_type=o:w=2`);
const SUB = (f: number) => s(`sin(2*PI*(${f}*t+${f}*(1-exp(-30*t))/30))*exp(-1.8*t)`, 0.6, 'volume=6dB,asoftclip=type=tanh');
const GLIDE = (a: number, b: number) => s(`sin(2*PI*(${a}*t+${((b - a) / 0.8).toFixed(1)}*t*t))*exp(-1.2*t)`, 0.42, 'volume=6dB,asoftclip=type=tanh');
const KICK = s('sin(2*PI*(50*t+150*(1-exp(-35*t))/35))*exp(-9*t)', 0.3, 'volume=3dB');
const CLAP = s('(2*random(0)-1)*exp(-25*t)', 0.2, 'bandpass=f=1800:width_type=o:w=2,volume=6dB');
const HAT = s('(2*random(0)-1)*exp(-80*t)', 0.06, 'highpass=f=7000');
const STAB = (f: number) => s(`0.5*sgn(sin(2*PI*${f}*t))*exp(-14*t)`, 0.12, 'lowpass=f=3000');
const CHOP = (syl: string, pitch: number) => v(IT, syl, { speed: 0.5, pitch, af: 'atrim=0:0.13,afade=t=out:st=0.1:d=0.03' });
const STEP = 0.11; // semicolcheia ≈ 136 BPM
const at = (step: number) => +(step * STEP).toFixed(3);
const note = (base: number, semis: number) => +(base * 2 ** (semis / 12)).toFixed(1);
const PHONK_AF = 'asoftclip=type=tanh,bass=g=5:f=90';

const RECIPES: Record<string, Entry> = {
  // ---- animais ----
  cuco: { recipe: s('0.7*sin(2*PI*if(lt(t,0.38),698,587)*t)*if(lt(t,0.33),exp(-5*t),if(gt(t,0.42),exp(-5*(t-0.42)),0))', 0.95) },
  grilo: { recipe: s('0.5*sin(2*PI*4600*t)*gt(sin(2*PI*45*t),0.2)*lt(mod(t,0.34),0.16)', 1.0) },
  sapo: { recipe: s('0.6*(sin(2*PI*95*t)+0.6*sin(2*PI*190*t)+0.4*sin(2*PI*285*t))*gt(sin(2*PI*22*t),0)*lt(mod(t,0.45),0.28)', 0.9, 'lowpass=f=900') },
  passarinho: { recipe: s(`0.5*sin(2*PI*(2500*${tau(0.12)}+20000*${tau(0.12)}*${tau(0.12)}))*lt(${tau(0.12)},0.08)`, 0.85) },
  'ave-rapina': { recipe: s('(0.45*sin(2*PI*(2900*t-700*t*t)+20*sin(2*PI*55*t))+0.12*(2*random(0)-1))*exp(-1.6*t)*(1-exp(-40*t))', 1.0, 'highpass=f=900') },
  rugido: { recipe: s(RUGIDO(75, 18), 1.1, 'lowpass=f=600') },
  miau: { recipe: v(ES, '¡Miaaau!', { pitch: 1.6 }) },
  guau: { recipe: v(ES, '¡Guau, guau!', { speed: 0.8, pitch: 1.15 }) },
  muu: { recipe: v(DE, 'Muuuh!', { pitch: 0.75 }) },
  galo: { recipe: v(IT, 'Chicchirichì!', { speed: 0.8, pitch: 1.2 }) },
  cabra: { recipe: v(ES, 'Beeeeeh', { pitch: 1.3, af: 'vibrato=f=9:d=0.9' }) },
  pato: { recipe: v(EN, 'Quack quack!', { speed: 0.7, pitch: 1.35 }) },
  // ---- animes ----
  nani: { recipe: v(IT, 'Nanì?!', { speed: 0.9, pitch: 1.2 }) },
  yamete: { recipe: v(IT, 'Yamète!', { speed: 0.85, pitch: 1.25 }) },
  sugoi: { recipe: v(IT, 'Sugòi!', { speed: 0.9, pitch: 1.25 }) },
  baka: { recipe: v(IT, 'Bakà!', { speed: 0.8, pitch: 1.3 }) },
  kawaii: { recipe: v(EN, 'Kawaii!', { speed: 0.9, pitch: 1.45 }) },
  yatta: { recipe: v(IT, 'Yatta!', { speed: 0.85, pitch: 1.25 }) },
  itadakimasu: { recipe: v(IT, 'Itadakimasu!', { speed: 0.7, pitch: 1.2 }) },
  // ---- jogos ----
  moeda: { recipe: s('0.45*sgn(sin(2*PI*if(lt(t,0.07),988,1319)*t))*if(lt(t,0.07),1,exp(-4*(t-0.07)))', 0.6) },
  pulo: { recipe: s('0.4*sgn(sin(2*PI*(250*t+1500*t*t)))*exp(-3*t)', 0.35) },
  powerup: { recipe: s('0.35*sgn(sin(2*PI*330*pow(1.19,floor(t/0.05))*t))*(1-t/0.8)', 0.8) },
  'game-over': { recipe: s('0.4*sgn(sin(2*PI*523*pow(0.89,floor(t/0.12))*t))*(1-t/1.1)', 1.05) },
  laser: { recipe: s(`0.5*sin(2*PI*1800*(1-exp(-9*${tau(0.3)}))/9)*exp(-6*${tau(0.3)})`, 0.9) },
  fanfarra: { recipe: s('0.35*sgn(sin(2*PI*if(lt(t,0.1),523,if(lt(t,0.2),659,if(lt(t,0.3),784,1047)))*t))*if(lt(t,0.3),1,exp(-3*(t-0.3)))', 0.9) },
  'robo-bip': { recipe: s('0.35*sgn(sin(2*PI*(300+180*floor(abs(sin(floor(t*12)*78.233))*5))*t))*gt(mod(t*12,1),0.15)', 1.0) },
  // ---- efeitos sonoros ----
  boing: { recipe: s('0.6*sin(2*PI*180*t+12*exp(-3*t)*sin(2*PI*14*t))*exp(-2.5*t)', 0.9) },
  apito: { recipe: s('0.5*sin(2*PI*(450*t+900*t*t)+4*sin(2*PI*6*t))*(1-exp(-30*t))', 0.9) },
  queda: { recipe: s('0.5*sin(2*PI*(2200*t-950*t*t))*(1-exp(-30*t))', 1.0) },
  trombone: {
    recipe: s(
      `0.3*${harm('2*PI*if(lt(t,0.27),311,if(lt(t,0.54),294,if(lt(t,0.81),277,262)))*t+if(gt(t,0.81),3*sin(2*PI*6*t),0)')}*if(lt(mod(t,0.27),0.02),mod(t,0.27)/0.02,1)*if(gt(t,1.0),(1.3-t)/0.3,1)`,
      1.3,
      'lowpass=f=2500',
    ),
  },
  buzina: { recipe: s(`0.3*(${harm('2*PI*330*t')}+0.7*${harm('2*PI*415*t')})*lt(${tau(0.3)},0.2)`, 0.55, 'lowpass=f=3000') },
  patinho: { recipe: s(`0.4*sgn(sin(2*PI*(1000*${tau(0.35)}+3000*${tau(0.35)}*${tau(0.35)})+3*sin(2*PI*30*t)))*lt(${tau(0.35)},0.22)`, 0.65, 'lowpass=f=4000') },
  ricochete: { recipe: s('0.5*sin(2*PI*(3000*t-1400*t*t)+6*sin(2*PI*40*t))*exp(-2*t)', 0.75) },
  bolhas: { recipe: s(`0.6*sin(2*PI*(300*${tau(0.22)}+6000*${tau(0.22)}*${tau(0.22)}))*exp(-25*${tau(0.22)})`, 0.9) },
  plim: { recipe: s('0.5*(sin(2*PI*1568*t)+0.5*sin(2*PI*2352*t)+0.3*sin(2*PI*3920*t))*exp(-4*t)', 1.0) },
  explosao: { recipe: s(EXPLOSAO, 1.2, 'lowpass=f=500,lowpass=f=500') },
  sirene: { recipe: s('0.5*sin(2*PI*800*t-25*cos(2*PI*2.5*t))', 1.0) },
  alarme: { recipe: s('0.45*sgn(sin(2*PI*1000*t))*gt(sin(2*PI*7*t),0)', 1.0) },
  alien: { recipe: s('0.5*sin(2*PI*(500*t+250*t*t)+18*sin(2*PI*6*t))', 1.0) },
  'disco-voador': { recipe: s('0.5*sin(2*PI*700*t+4*sin(2*PI*12*t))*(0.6+0.4*sin(2*PI*30*t))', 1.0) },
  modem: { recipe: s('0.4*sin(2*PI*(900+1400*abs(sin(floor(t*22)*12.9898)))*t)+0.15*(2*random(0)-1)', 1.0) },
  pum: { recipe: s(PUM, 0.9, 'lowpass=f=350,lowpass=f=600') },

  // ---- memes / shitpost: gritos e vozes ----
  faaah: { hot: true, recipe: v(EN, 'Faaaaaaah!', { pitch: 1.35, af: 'volume=8dB,asoftclip=type=atan,aecho=0.6:0.4:60:0.3' }) },
  auugh: { hot: true, recipe: v(EN, 'Auuuuughhh!', { speed: 1.1, pitch: 0.8, af: `${BLOWN},${BASS(8)}` }) },
  'grito-goofy': { hot: true, recipe: GOOFY_SCREAM },
  'grito-cartoon': { recipe: v(EN, 'Yaaaaaaaoooow!', { pitch: 1.5, af: 'vibrato=f=7:d=0.9' }) },
  'grito-saturado': { hot: true, recipe: v(EN, 'Aaaaaargh!', { pitch: 1.1, af: 'volume=24dB,asoftclip=type=hard:threshold=0.3,acrusher=bits=4:mix=0.5,lowpass=f=4500' }) },
  'grito-agudo': { recipe: v(DE, 'Aaaaaaaaaaaah!', { speed: 1.8, pitch: 2.1 }) },
  'grito-bass': { hot: true, recipe: v(EN, 'Aaaaaaah!', { pitch: 0.55, af: `${BASS(22)},volume=6dB,asoftclip=type=hard:threshold=0.6` }) },
  'risada-turbo': { recipe: v(EN, 'Hahahahahahaha hahahaha!', { speed: 0.55, pitch: 1.9 }) },
  'risada-maligna': { hot: true, recipe: v(DE, 'Muahahahaha!', { speed: 0.8, pitch: 0.7, af: 'volume=10dB,asoftclip=type=atan,aecho=0.8:0.7:80|160:0.4|0.25' }) },
  'oof-bass': { hot: true, recipe: v(EN, 'Oof!', { pitch: 0.75, af: `${BASS(20)},volume=8dB,asoftclip=type=hard:threshold=0.5` }) },
  // ---- memes / shitpost: efeitos ----
  'boom-grave': { hot: true, recipe: s(BOOM, 1.6, `${BASS(10)},asoftclip=type=tanh,aecho=0.6:0.5:120|240:0.35|0.2`) },
  'cano-metal': {
    recipe: {
      combo: [
        { src: s(CLANG, 1.2), at: 0 },
        { src: s(CLANG, 1.0), at: 0.45, vol: 0.55 },
        { src: s(CLANG, 0.8), at: 0.7, vol: 0.35 },
        { src: s(CLANG, 0.6), at: 0.86, vol: 0.2 },
      ],
      af: 'aecho=0.7:0.5:40:0.3',
      dur: 1.8,
    },
  },
  'impacto-ameaca': {
    hot: true,
    recipe: s('0.9*sin(2*PI*(55*t+5*(1-exp(-8*t))))*exp(-1.5*t)+0.35*sin(2*PI*(900*t-300*t*t)+5*sin(2*PI*30*t))*exp(-3*t)', 1.6, `${BASS(8)},aecho=0.8:0.8:80|160:0.4|0.3`),
  },
  'boing-exagerado': { recipe: s('0.7*sin(2*PI*140*t+30*exp(-1.8*t)*sin(2*PI*11*t))*exp(-1.2*t)', 1.4, 'volume=4dB,asoftclip=type=tanh') },
  'corrida-cartoon': {
    recipe: s(`0.6*sin(2*PI*if(eq(mod(floor(t/0.07),2),0),900,1250)*${tau(0.07)})*exp(-60*${tau(0.07)})+0.3*sin(2*PI*(800*t+600*t*t)+3*sin(2*PI*8*t))`, 1.3),
  },
  'buzina-goofy': {
    recipe: s(`0.3*${harm('2*PI*(390*t-if(gt(t,0.45),90*(t-0.45)*(t-0.45),0))+2*sin(2*PI*7*t)')}*(lt(t,0.35)+gt(t,0.45)*lt(t,1.1))`, 1.15, 'lowpass=f=3500,volume=4dB,asoftclip=type=tanh'),
  },
  'apito-maluco': { recipe: s('0.5*sin(2*PI*1200*t-389*cos(2*PI*1.8*t)+3*sin(2*PI*7*t))*(1-exp(-30*t))', 1.3) },
  'pum-eco': { recipe: s(PUM, 0.7, 'lowpass=f=350,lowpass=f=600,apad=pad_dur=1.1,aecho=0.8:0.9:300|600|900:0.5|0.35|0.25') },
  'pum-bass': { hot: true, recipe: s(PUM.replace('85*t', '55*t'), 0.9, `lowpass=f=300,${BASS(20)},${BLOWN}`) },
  'air-horn': { hot: true, recipe: s(AIR_HORN, 1.25, 'highpass=f=150,volume=8dB,asoftclip=type=hard:threshold=0.5') },
  'bong-grave': { recipe: s('0.5*(sin(2*PI*196*t)+0.6*sin(2*PI*470*t)*exp(-2*t)+0.4*sin(2*PI*760*t)*exp(-3*t)+0.25*sin(2*PI*1100*t)*exp(-4*t))*exp(-1.6*t)', 1.6, 'aecho=0.7:0.6:90:0.3') },
  bonk: { recipe: s(BONK, 0.4, 'apad=pad_dur=0.2') },
  boowomp: {
    recipe: s(
      `0.4*${harm('2*PI*if(lt(t,0.22),240,200-110*(t-0.25)/0.65)*t')}*if(lt(t,0.2),sin(PI*t/0.2),if(gt(t,0.25),sin(PI*min((t-0.25)/0.7,1)),0))`,
      0.95,
      `lowpass=f=1200,${BASS(6)}`,
    ),
  },
  scratch: {
    recipe: s('0.5*sin(2*PI*600*t+25*sin(2*PI*9*t)*sin(2*PI*3*t))+0.3*(2*random(0)-1)*abs(sin(2*PI*9*t))', 0.9, 'bandpass=f=1400:width_type=o:w=2,volume=6dB'),
  },
  'explosao-bass': { hot: true, recipe: s(EXPLOSAO, 1.3, `lowpass=f=700,${BASS(18)},volume=6dB,asoftclip=type=hard:threshold=0.5`) },
  'mola-metal': {
    recipe: s('0.5*sin(2*PI*900*t+40*exp(-2*t)*sin(2*PI*28*t))*exp(-2.5*t)+0.3*sin(2*PI*2300*t+30*sin(2*PI*28*t))*exp(-4*t)', 1.3, 'aecho=0.8:0.9:8|15:0.6|0.5'),
  },
  // ---- memes / shitpost: caos estourado ----
  'erro-earrape': { hot: true, recipe: s('0.45*sgn(sin(2*PI*if(lt(t,0.15),880,660)*t))*(1-exp(-60*t))', 0.7, `acrusher=bits=5:mix=0.7,${BASS(10)},${BLOWN}`) },
  'notificacao-estourada': {
    hot: true,
    recipe: s('0.5*sin(2*PI*if(lt(t,0.09),1047,if(lt(t,0.18),1319,1568))*t)*if(lt(t,0.18),1,exp(-4*(t-0.18)))', 0.8, `${BASS(12)},${BLOWN}`),
  },
  'alarme-agudo': { hot: true, recipe: s('0.45*sgn(sin(2*PI*if(gt(sin(2*PI*10*t),0),2400,1800)*t))', 1.0, `acrusher=bits=6:mix=0.5,${BLOWN}`) },
  'sirene-meme': { hot: true, recipe: s('0.45*sgn(sin(2*PI*900*t-60*cos(2*PI*4*t)))', 1.1, `acrusher=bits=5:mix=0.5,${BASS(10)},${BLOWN}`) },
  'modem-turbo': { hot: true, recipe: s('0.4*sin(2*PI*(900+1800*abs(sin(floor(t*50)*12.9898)))*t)+0.25*(2*random(0)-1)', 1.0, BLOWN) },
  glitch: {
    hot: true,
    recipe: s(
      '0.5*sgn(sin(2*PI*(200+3000*abs(sin(floor(t*33)*91.7)))*t))*gt(abs(sin(floor(t*33)*17.3)),0.3)+0.3*sin(2*PI*(60+500*abs(sin(floor(t*11)*7.1)))*t)',
      1.1,
      'acrusher=bits=4:mix=0.6',
    ),
  },
  'gato-estourado': { hot: true, recipe: v(ES, '¡Miaaaaaaau!', { pitch: 1.7, af: 'volume=18dB,asoftclip=type=hard:threshold=0.35,acrusher=bits=6:mix=0.4' }) },
  'cabra-bass': { hot: true, recipe: v(ES, 'Beeeeeeeeh', { pitch: 1.25, af: `vibrato=f=9:d=0.9,${BASS(20)},volume=8dB,asoftclip=type=hard:threshold=0.5` }) },
  'monstro-turbo': { hot: true, recipe: s(RUGIDO(170, 40), 0.8, 'lowpass=f=1500,volume=8dB,asoftclip=type=hard:threshold=0.5') },
  'goofy-combo': {
    hot: true,
    recipe: {
      combo: [
        { src: s(AIR_HORN, 0.4, 'highpass=f=150'), at: 0, vol: 0.7 },
        { src: GOOFY_SCREAM, at: 0.4, vol: 0.9 },
        { src: s(BONK, 0.4), at: 1.15 },
        { src: s(BOOM, 0.8), at: 1.3, vol: 0.8 },
      ],
      af: 'asoftclip=type=tanh',
      dur: 2.0,
    },
  },

  // ---- phonk insano (batidas originais no estilo) ----
  'phonk-cowbell': {
    hot: true,
    recipe: {
      combo: [
        ...[0, 0, 3, 0, 5, 0, 3, -2, 0, 0, 3, 0, 7, 5, 3, 0, 0, 3].map((n, i) => ({ src: COWBELL(note(659, n)), at: at(i), vol: 0.7 })),
        ...[[0, 82], [6, 98], [10, 110], [14, 82]].map(([i, f]) => ({ src: SUB(f), at: at(i) })),
        ...[0, 6, 10, 14].map((i) => ({ src: KICK, at: at(i) })),
        ...[4, 12].map((i) => ({ src: CLAP, at: at(i), vol: 0.8 })),
        ...[1, 3, 5, 7, 9, 11, 13, 15, 17].map((i) => ({ src: HAT, at: at(i), vol: 0.4 })),
      ],
      af: PHONK_AF,
      dur: 2.0,
    },
  },
  'phonk-montagem': {
    hot: true,
    recipe: {
      combo: [
        ...[0, 3, 6, 8, 11, 14, 16].map((i) => ({ src: KICK, at: at(i) })),
        ...[0, 6, 11, 16].map((i) => ({ src: SUB(i === 11 ? 73 : 55), at: at(i) })),
        ...[2, 5, 7, 10, 13, 15].map((i, k) => ({ src: CHOP('è', k % 2 ? 1.6 : 1.35), at: at(i), vol: 0.9 })),
        ...[4, 12].map((i) => ({ src: CLAP, at: at(i), vol: 0.9 })),
      ],
      af: PHONK_AF,
      dur: 2.0,
    },
  },
  'phonk-vocal': {
    hot: true,
    recipe: {
      combo: [
        ...[1, 1.25, 1.5, 1.33, 1, 1.5, 1.78, 1.5, 1.33, 1.25, 1.5, 2, 1.78, 1.5, 1.33, 1].map((p, i) => ({ src: CHOP(['à', 'è', 'ò', 'ì'][i % 4], p), at: at(i), vol: 0.85 })),
        ...[0, 8].map((i) => ({ src: KICK, at: at(i) })),
        ...[0, 8].map((i) => ({ src: SUB(62), at: at(i), vol: 0.8 })),
        ...[4, 12].map((i) => ({ src: CLAP, at: at(i), vol: 0.7 })),
      ],
      af: PHONK_AF,
      dur: 1.85,
    },
  },
  'phonk-808': {
    hot: true,
    recipe: {
      combo: [
        { src: GLIDE(55, 110), at: at(0) },
        { src: GLIDE(110, 73), at: at(4) },
        { src: GLIDE(73, 146), at: at(8) },
        { src: GLIDE(146, 55), at: at(12) },
        ...[2, 6, 10, 14].map((i) => ({ src: COWBELL(988), at: at(i), vol: 0.6 })),
        ...[0, 8].map((i) => ({ src: KICK, at: at(i) })),
      ],
      af: `${PHONK_AF},volume=3dB,asoftclip=type=hard:threshold=0.7`,
      dur: 1.9,
    },
  },
  'phonk-bounce': {
    hot: true,
    recipe: {
      combo: [
        ...[0, 2, 3, 5, 8, 10, 11, 13, 16].map((i) => ({ src: KICK, at: at(i) })),
        ...[1, 4, 7, 9, 12, 15].map((i, k) => ({ src: STAB([440, 523, 392, 440, 587, 523][k]), at: at(i), vol: 0.6 })),
        ...[4, 12].map((i) => ({ src: CLAP, at: at(i), vol: 0.8 })),
        ...[6, 14].map((i) => ({ src: CHOP('ò', 1.4), at: at(i) })),
      ],
      af: PHONK_AF,
      dur: 1.9,
    },
  },
  'phonk-caos': {
    hot: true,
    recipe: {
      combo: [
        ...[0, 3, 0, 5, 0, 3, 7, 5].map((n, i) => ({ src: COWBELL(note(740, n)), at: at(i), vol: 0.65 })),
        { src: GOOFY_SCREAM, at: at(6), vol: 0.7 },
        ...[0, 8].map((i) => ({ src: SUB(55), at: at(i) })),
        ...[0, 8].map((i) => ({ src: KICK, at: at(i) })),
        ...[12, 13, 14, 15, 16, 17].map((i) => ({ src: CLAP, at: at(i), vol: 0.5 + (i - 12) * 0.08 })),
      ],
      af: `${PHONK_AF},volume=2dB,asoftclip=type=hard:threshold=0.7`,
      dur: 2.0,
    },
  },
  'phonk-sirene': {
    hot: true,
    recipe: {
      combo: [
        { src: s(`0.35*${harm('2*PI*700*t-25*cos(2*PI*6*t)', 5)}*gt(mod(t,0.22),0.03)`, 1.9, 'lowpass=f=4000'), at: 0, vol: 0.8 },
        ...[0, 8].map((i) => ({ src: SUB(49), at: at(i) })),
        ...[0, 6, 8, 14].map((i) => ({ src: KICK, at: at(i) })),
        ...[4, 12].map((i) => ({ src: CLAP, at: at(i), vol: 0.8 })),
      ],
      af: PHONK_AF,
      dur: 1.9,
    },
  },
};

// ---------- geração ----------
let n = 0;
const tmp = (ext = 'wav') => path.join(TMP, `p${++n}.${ext}`);
const ff = (a: string[]) => run('ffmpeg', ['-y', '-v', 'error', ...a]);

async function piper(voice: Voice, out: string) {
  const PIPER = process.env.PIPER;
  const DIR = process.env.PIPER_VOICES;
  if (!PIPER || !DIR) throw new Error('Defina PIPER e PIPER_VOICES para gerar as vozes.');
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PIPER, ['--model', path.join(DIR, `${voice.voice}.onnx`), '--length_scale', String(voice.speed ?? 1), '--output_file', out]);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper saiu com ${code}`))));
    p.stderr.resume();
    p.stdout.resume();
    p.stdin.end(voice.text);
  });
}

const cache = new Map<Recipe, Promise<string>>();
/** Renderiza uma receita num wav (mono, 44,1 kHz). */
function render(r: Recipe): Promise<string> {
  let p = cache.get(r);
  if (p) return p;
  p = (async () => {
    const out = tmp();
    if ('synth' in r) {
      const fade = `afade=t=out:st=${Math.max(0, r.synth.dur - 0.05).toFixed(2)}:d=0.05`;
      await ff(['-f', 'lavfi', '-i', `aevalsrc='${r.synth.expr}':s=44100:d=${r.synth.dur}`, '-af', [r.synth.af, fade].filter(Boolean).join(','), '-ac', '1', '-ar', '44100', out]);
    } else if ('voice' in r) {
      const raw = tmp();
      await piper(r.voice, raw);
      const pitch = r.voice.pitch ? `asetrate=${Math.round(22050 * r.voice.pitch)},aresample=44100` : 'aresample=44100';
      await ff(['-i', raw, '-af', ['silenceremove=start_periods=1:start_threshold=-45dB', pitch, r.voice.af].filter(Boolean).join(','), '-ac', '1', out]);
    } else {
      const files = await Promise.all(r.combo.map((part) => render(part.src)));
      const inputs = files.flatMap((f) => ['-i', f]);
      const chains = r.combo.map((part, i) => `[${i}]adelay=${Math.round(part.at * 1000)},volume=${part.vol ?? 1}[a${i}]`);
      const mix = `${r.combo.map((_, i) => `[a${i}]`).join('')}amix=inputs=${r.combo.length}:normalize=0:dropout_transition=0${r.af ? `,${r.af}` : ''}${r.dur ? `,atrim=0:${r.dur}` : ''}[out]`;
      await ff([...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '[out]', '-ac', '1', '-ar', '44100', out]);
    }
    return out;
  })();
  cache.set(r, p);
  return p;
}

/** Corte em ≤2s, fade no fim, volume uniforme (distorcidos um pouco mais baixos), limitador, mp3 leve. */
async function encode(wav: string, mp3: string, hot: boolean) {
  const af = [
    'silenceremove=start_periods=1:start_threshold=-50dB',
    'atrim=0:2',
    'areverse,afade=t=in:d=0.04,areverse',
    `loudnorm=I=${hot ? -18 : -16}:TP=-2:LRA=11`,
    'alimiter=limit=0.8',
    'aresample=44100',
  ].join(',');
  await ff(['-i', wav, '-af', af, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '80k', mp3]);
}

const todo = SOM_LIBRARY.filter((e) => RECIPES[e.id] && (ONLY.length ? ONLY.includes(e.id) : FORCE || !fs.existsSync(path.join(OUT, `${e.id}.mp3`))));
for (const e of todo) {
  const r = RECIPES[e.id];
  await encode(await render(r.recipe), path.join(OUT, `${e.id}.mp3`), !!r.hot);
  console.log(`✔ ${e.id}`);
}

// Arquivos que não estão mais na biblioteca.
const known = new Set(SOM_LIBRARY.map((e) => `${e.id}.mp3`));
const stale = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp3') && !known.has(f));
const missing = SOM_LIBRARY.filter((e) => !fs.existsSync(path.join(OUT, `${e.id}.mp3`)));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`Pronto: ${todo.length} gerados.`);
if (stale.length) console.log(`Fora da biblioteca (pode apagar): ${stale.join(', ')}`);
if (missing.length) console.log(`Sem arquivo: ${missing.map((e) => e.id).join(', ')}`);
