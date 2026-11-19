/**
 * Áudio do "Faz Esse Som!": tocar o som original e as imitações, e gravar pelo microfone.
 */
import { useEffect, useState } from 'react';
import { serverNow, socket } from './net';
import { audioCtx } from './sound';

// ---------- tocar ----------

const soundBuffers = new Map<string, Promise<AudioBuffer | null>>();

// Sons enviados pelos jogadores da sala: o servidor manda o áudio pelo evento som:custom.
const customData = new Map<string, ArrayBuffer>();
const customWaiters = new Map<string, ((d: ArrayBuffer) => void)[]>();
socket.on('som:custom', (p: { sounds: { id: string; data: ArrayBuffer }[] }) => {
  for (const snd of p.sounds) {
    customData.set(snd.id, snd.data);
    for (const w of customWaiters.get(snd.id) ?? []) w(snd.data);
    customWaiters.delete(snd.id);
  }
});
function customAudio(id: string) {
  const d = customData.get(id);
  if (d) return Promise.resolve(d);
  return new Promise<ArrayBuffer>((resolve, reject) => {
    customWaiters.set(id, [...(customWaiters.get(id) ?? []), resolve]);
    setTimeout(() => reject(new Error('timeout')), 15_000);
  });
}

/** Baixa e decodifica um som da biblioteca (client/public/som) ou enviado na sala. */
export function loadSound(id: string) {
  let b = soundBuffers.get(id);
  if (!b) {
    const data = id.startsWith('sala-')
      ? customAudio(id).then((d) => d.slice(0))
      : fetch(`/som/${id}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))));
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

/** Efeito aplicado no microfone (a gravação enviada já vai com ele). */
export type MicEffect = 'none' | 'karaoke' | 'blown';

/** Resposta de impulso de uma "sala" para o reverb (ruído decaindo). */
function impulse(ctx: AudioContext, seconds: number) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  return buf;
}

function limiter(ctx: AudioContext, threshold: number) {
  const l = ctx.createDynamicsCompressor();
  l.threshold.value = threshold;
  l.knee.value = 0;
  l.ratio.value = 20;
  l.attack.value = 0.002;
  l.release.value = 0.1;
  return l;
}

/**
 * Monta a cadeia do efeito: entrada -> efeito -> saída (que vai para o gravador).
 * - karaoke: compressão + reverb + delay leve (estilo show).
 * - blown: "microfone estourado" (saturação pesada e grave), com o volume segurado por um limitador.
 */
function effectChain(ctx: AudioContext, input: AudioNode, effect: MicEffect, out: AudioNode) {
  if (effect === 'karaoke') {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const sum = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 1.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.22;
    input.connect(comp);
    comp.connect(dry).connect(sum);
    comp.connect(reverb).connect(wet).connect(sum);
    comp.connect(delay).connect(delayWet).connect(sum);
    delay.connect(feedback).connect(delay);
    sum.connect(limiter(ctx, -3)).connect(out);
    return;
  }
  if (effect === 'blown') {
    const pre = ctx.createGain();
    pre.gain.value = 12;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6) * 0.9 + Math.sign(x) * 0.1 * Math.min(1, Math.abs(x) * 8);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 160;
    bass.gain.value = 9;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 5500;
    const post = ctx.createGain();
    post.gain.value = 0.22;
    input.connect(pre).connect(shaper).connect(bass).connect(lowpass).connect(post).connect(limiter(ctx, -8)).connect(out);
    return;
  }
  input.connect(out);
}

/** Grava até `maxMs` (com o efeito escolhido), avisando o volume (0–1) para animar o medidor. */
export async function startRecording(maxMs: number, onLevel: (level: number) => void, effect: MicEffect = 'none'): Promise<Recording> {
  const mic = await getMic();
  stopPlayback();
  const mime = pickMime();
  const ctx0 = audioCtx();
  // Com efeito, o gravador recebe o áudio já processado pelo Web Audio.
  let recStream: MediaStream = mic;
  let fxSource: MediaStreamAudioSourceNode | null = null;
  if (effect !== 'none' && ctx0 && 'createMediaStreamDestination' in ctx0) {
    fxSource = ctx0.createMediaStreamSource(mic);
    const dest = ctx0.createMediaStreamDestination();
    effectChain(ctx0, fxSource, effect, dest);
    recStream = dest.stream;
  }
  const rec = new MediaRecorder(recStream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
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
      // O reverb/delay ainda soa um pouquinho depois de parar; solta a cadeia em seguida.
      setTimeout(() => fxSource?.disconnect(), 100);
      onLevel(0);
      const type = rec.mimeType || mime || 'audio/webm';
      resolve({ blob: new Blob(chunks, { type }), mime: type });
    };
  });
  rec.start();
  // No karaokê, grava mais um pouquinho para não cortar o eco no meio.
  const tail = effect === 'karaoke' ? 400 : 0;
  const finish = () => window.setTimeout(() => rec.state === 'recording' && rec.stop(), tail);
  const timer = window.setTimeout(finish, maxMs);
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      finish();
    },
    done,
  };
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
  const d = out.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (const x of d) {
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  const rms = Math.sqrt(sum / d.length);
  // Pico até ~-1 dB e volume médio até ~-14 dB: mesmo um áudio "earrape" fica num volume seguro.
  const gain = peak > 0 ? Math.min(0.89 / peak, rms > 0 ? 0.2 / rms : 1, 8) : 1;
  return encodeWav(d, rate, gain);
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
