/**
 * Áudio do "Faz Esse Som!": tocar o som original e as imitações, e gravar pelo microfone.
 */
import { useEffect, useState } from 'react';
import { serverNow } from './net';
import { audioCtx } from './sound';

// ---------- tocar ----------

const soundBuffers = new Map<string, Promise<AudioBuffer | null>>();

/** Repositório do jogo: os sons salvos pela página /admin já ficam lá antes do site terminar de atualizar. */
const RAW = 'https://raw.githubusercontent.com/VictorPiierre/futbomb/main/client/public/som/';
const get = (url: string) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));

/** Baixa e decodifica um som da biblioteca (client/public/som/<arquivo>). */
export function loadSound(id: string, file = `${id}.mp3`) {
  let b = soundBuffers.get(id);
  if (!b) {
    const data = get(`/som/${file}`).catch(() => get(RAW + file));
    b = data
      .then((data) => audioCtx()!.decodeAudioData(data))
      .catch(() => {
        soundBuffers.delete(id);
        return null;
      });
    soundBuffers.set(id, b);
  }
  return b;
}

export interface ClipAudio {
  /** Decodificado pelo Web Audio (preferido: toca mesmo sem toque recente na página). */
  buffer: AudioBuffer | null;
  /** Reserva para formatos que o Web Audio não decodifica. */
  url: string;
}

export async function prepareClip(data: ArrayBuffer, mime: string): Promise<ClipAudio> {
  const url = URL.createObjectURL(new Blob([data], { type: mime.split(';')[0] }));
  let buffer: AudioBuffer | null = null;
  try {
    buffer = await audioCtx()!.decodeAudioData(data.slice(0));
  } catch {
    buffer = null;
  }
  return { buffer, url };
}

/**
 * Saída com volume controlado: tudo do jogo passa por um compressor/limitador,
 * então nem as gravações "estouradas" dos amigos passam de um volume seguro.
 */
let master: AudioNode | null = null;
function output(ctx: AudioContext) {
  if (!master) {
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    gain.connect(limiter).connect(ctx.destination);
    master = gain;
  }
  return master;
}

let current: { stop: () => void } | null = null;
let nowPlaying: string | null = null;
const listeners = new Set<(key: string | null) => void>();
function setNowPlaying(key: string | null) {
  nowPlaying = key;
  for (const l of listeners) l(key);
}

/** Qual áudio está tocando agora ("original" ou "clip-<slot>"), para destacar na tela. */
export function useNowPlaying() {
  const [key, setKey] = useState(nowPlaying);
  useEffect(() => {
    listeners.add(setKey);
    return () => {
      listeners.delete(setKey);
    };
  }, []);
  return key;
}

export function stopPlayback() {
  current?.stop();
  current = null;
  setNowPlaying(null);
}

/**
 * Toca um áudio (agendado para um horário do servidor, se `at` vier). Interrompe o que estiver tocando.
 * `key` identifica o que está tocando para a interface.
 */
export function playAudio(key: string, src: AudioBuffer | ClipAudio | null, at?: number) {
  const ctx = audioCtx();
  if (!src) return;
  const delay = at ? Math.max(0, (at - serverNow()) / 1000) : 0;
  const buffer = src instanceof AudioBuffer ? src : src.buffer;
  stopPlayback();
  let startTimer = 0;
  let endTimer = 0;
  if (ctx && buffer) {
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(output(ctx));
    node.start(ctx.currentTime + delay);
    startTimer = window.setTimeout(() => setNowPlaying(key), delay * 1000);
    endTimer = window.setTimeout(() => nowPlaying === key && setNowPlaying(null), (delay + buffer.duration) * 1000 + 100);
    current = {
      stop: () => {
        clearTimeout(startTimer);
        clearTimeout(endTimer);
        try {
          node.stop();
        } catch {
          /* já parou */
        }
      },
    };
    return;
  }
  if (!(src instanceof AudioBuffer)) {
    const el = new Audio(src.url);
    el.volume = 0.8;
    startTimer = window.setTimeout(() => {
      setNowPlaying(key);
      void el.play().catch(() => setNowPlaying(null));
    }, delay * 1000);
    el.onended = () => nowPlaying === key && setNowPlaying(null);
    current = {
      stop: () => {
        clearTimeout(startTimer);
        el.pause();
      },
    };
  }
}

// ---------- gravar ----------

let stream: MediaStream | null = null;

export function micSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/** Pede o microfone uma vez e reaproveita. */
export async function getMic() {
  if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    // Sem supressão de ruído: os sons esquisitos são justamente o que a gente quer gravar.
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
  });
  return stream;
}

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

export interface Recording {
  stop: () => void;
  done: Promise<{ blob: Blob; mime: string }>;
}

/** Grava até `maxMs` (ou até parar), avisando o volume (0–1) para animar o medidor. */
export async function startRecording(maxMs: number, onLevel: (level: number) => void): Promise<Recording> {
  const mic = await getMic();
  stopPlayback();
  const mime = pickMime();
  const rec = new MediaRecorder(mic, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  // Medidor de volume.
  const ctx = audioCtx();
  let raf = 0;
  let source: MediaStreamAudioSourceNode | null = null;
  if (ctx) {
    source = ctx.createMediaStreamSource(mic);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  const done = new Promise<{ blob: Blob; mime: string }>((resolve) => {
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      source?.disconnect();
      onLevel(0);
      const type = rec.mimeType || mime || 'audio/webm';
      resolve({ blob: new Blob(chunks, { type }), mime: type });
    };
  });
  rec.start();
  const timer = window.setTimeout(() => rec.state === 'recording' && rec.stop(), maxMs);
  return {
    stop: () => {
      clearTimeout(timer);
      if (rec.state === 'recording') rec.stop();
    },
    done,
  };
}

// ---------- modificadores (aplicados na gravação depois de gravar) ----------

export type SomModifier = 'estourado' | 'show' | 'esquilo' | 'monstro' | 'robo' | 'telefone' | 'eco';

export const SOM_MODIFIERS: { id: SomModifier; emoji: string; label: string }[] = [
  { id: 'estourado', emoji: '💥', label: 'Estourado' },
  { id: 'show', emoji: '🎤', label: 'Microfone de show' },
  { id: 'esquilo', emoji: '🐿️', label: 'Esquilo' },
  { id: 'monstro', emoji: '👹', label: 'Monstro' },
  { id: 'robo', emoji: '🤖', label: 'Robô' },
  { id: 'telefone', emoji: '📞', label: 'Telefone' },
  { id: 'eco', emoji: '🏟️', label: 'Eco de estádio' },
];

/** Resposta de impulso de uma "sala" para o reverb (ruído decaindo). */
function impulse(ctx: BaseAudioContext, seconds: number) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len) ** 2.5;
  }
  return buf;
}

/** Lê a gravação (para tocar e aplicar modificadores). */
export async function decodeBlob(blob: Blob) {
  const ctx = audioCtx();
  if (!ctx) throw new Error('sem áudio');
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

/**
 * Aplica os modificadores escolhidos e devolve um WAV mono (22 kHz) com volume controlado.
 * Ordem: tom (esquilo/monstro) → robô → telefone → estourado → microfone de show → eco.
 */
export async function applyModifiers(src: AudioBuffer, mods: SomModifier[]) {
  const has = (m: SomModifier) => mods.includes(m);
  const rate = 22_050;
  const speed = (has('esquilo') ? 1.6 : 1) * (has('monstro') ? 0.65 : 1);
  const tail = (has('show') ? 1.2 : 0) + (has('eco') ? 1.6 : 0);
  // No máximo 12s (a gravação mais lenta + eco) para o arquivo não ficar grande demais.
  const length = Math.min(12, src.duration / speed + tail);
  const off = new OfflineAudioContext(1, Math.ceil(length * rate), rate);
  const node = off.createBufferSource();
  node.buffer = src;
  node.playbackRate.value = speed;
  let chain: AudioNode = node;
  const then = (n: AudioNode) => {
    chain.connect(n);
    chain = n;
    return n;
  };

  if (has('robo')) {
    // Modulação em anel: a voz multiplicada por uma onda grave vira voz de robô.
    const ring = off.createGain();
    ring.gain.value = 0;
    const osc = off.createOscillator();
    osc.frequency.value = 55;
    osc.connect(ring.gain);
    osc.start();
    then(ring);
    const lift = off.createGain();
    lift.gain.value = 2.2;
    then(lift);
  }
  if (has('telefone')) {
    const hp = off.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 450;
    then(hp);
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    then(lp);
    const crunch = off.createWaveShaper();
    crunch.curve = curve(2.5);
    then(crunch);
  }
  if (has('estourado')) {
    const pre = off.createGain();
    pre.gain.value = 12;
    then(pre);
    const shaper = off.createWaveShaper();
    shaper.curve = curve(7);
    shaper.oversample = '4x';
    then(shaper);
    const bass = off.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 160;
    bass.gain.value = 9;
    then(bass);
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5500;
    then(lp);
  }
  if (has('show')) {
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 4;
    then(comp);
    const sum = off.createGain();
    const dry = off.createGain();
    dry.gain.value = 0.85;
    const verb = off.createConvolver();
    verb.buffer = impulse(off, 1.8);
    const wet = off.createGain();
    wet.gain.value = 0.45;
    const delay = off.createDelay(1);
    delay.delayTime.value = 0.23;
    const fb = off.createGain();
    fb.gain.value = 0.28;
    const dWet = off.createGain();
    dWet.gain.value = 0.22;
    chain.connect(dry).connect(sum);
    chain.connect(verb).connect(wet).connect(sum);
    chain.connect(delay).connect(dWet).connect(sum);
    delay.connect(fb).connect(delay);
    chain = sum;
  }
  if (has('eco')) {
    const sum = off.createGain();
    const delay = off.createDelay(2);
    delay.delayTime.value = 0.38;
    const fb = off.createGain();
    fb.gain.value = 0.55;
    const wet = off.createGain();
    wet.gain.value = 0.7;
    chain.connect(sum);
    chain.connect(delay).connect(wet).connect(sum);
    delay.connect(fb).connect(delay);
    chain = sum;
  }
  chain.connect(off.destination);
  node.start(0);
  const out = await off.startRendering();
  return toWav(out.getChannelData(0), rate);
}

/** Curva de saturação (quanto maior `k`, mais estourado). */
function curve(k: number) {
  const c = new Float32Array(1024);
  for (let n = 0; n < c.length; n++) {
    const x = (n / (c.length - 1)) * 2 - 1;
    c[n] = Math.tanh(x * k) / Math.tanh(k);
  }
  return c;
}

/** Volume controlado (pico ~-1 dB e volume médio até ~-14 dB) e WAV 16 bits. */
function toWav(d: Float32Array, rate: number) {
  let peak = 0;
  let sum = 0;
  for (const x of d) {
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  const rms = Math.sqrt(sum / Math.max(1, d.length));
  const gain = peak > 0 ? Math.min(0.89 / peak, rms > 0 ? 0.2 / rms : 1, 8) : 1;
  return encodeWav(d, rate, gain);
}

// ---------- enviar um som para a sala ----------

/** Lê um arquivo de áudio qualquer (mp3, wav, ogg, m4a…). */
export async function decodeFile(file: File) {
  const ctx = audioCtx();
  if (!ctx) throw new Error('sem áudio');
  return ctx.decodeAudioData(await file.arrayBuffer());
}

/**
 * Corta o trecho escolhido e ajusta o volume (nem estourado nem baixinho), com fade nas pontas.
 * Devolve um WAV mono 44,1 kHz pronto para enviar.
 */
export async function renderTrim(src: AudioBuffer, start: number, length: number) {
  const rate = 44_100;
  const len = Math.max(0.2, Math.min(length, src.duration - start));
  const off = new OfflineAudioContext(1, Math.ceil(len * rate), rate);
  const node = off.createBufferSource();
  node.buffer = src;
  const fade = off.createGain();
  fade.gain.setValueAtTime(0, 0);
  fade.gain.linearRampToValueAtTime(1, 0.01);
  fade.gain.setValueAtTime(1, Math.max(0.02, len - 0.05));
  fade.gain.linearRampToValueAtTime(0, len);
  node.connect(fade).connect(off.destination);
  node.start(0, start, len);
  const out = await off.startRendering();
  return toWav(out.getChannelData(0), rate);
}

function encodeWav(samples: Float32Array, rate: number, gain: number) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] * gain));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}
