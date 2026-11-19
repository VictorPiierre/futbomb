/**
 * Áudio do "Faz Esse Som!": tocar o som original e as imitações, e gravar pelo microfone.
 */
import { useEffect, useState } from 'react';
import { serverNow } from './net';
import { audioCtx } from './sound';

// ---------- tocar ----------

const soundBuffers = new Map<string, Promise<AudioBuffer | null>>();
/** Baixa e decodifica um som da biblioteca (client/public/som). */
export function loadSound(id: string) {
  let b = soundBuffers.get(id);
  if (!b) {
    b = fetch(`/som/${id}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
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
    node.connect(ctx.destination);
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

/** Grava até `maxMs`, avisando o volume (0–1) para animar o medidor. */
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
