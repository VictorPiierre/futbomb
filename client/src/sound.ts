// Efeitos sonoros sintetizados com Web Audio (sem arquivos externos).
let ctx: AudioContext | null = null;
let enabled = (() => {
  try {
    return localStorage.getItem('futbomb:sound') !== 'off';
  } catch {
    return true;
  }
})();

export function isSoundOn() {
  return enabled;
}

export function setSoundOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem('futbomb:sound', on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Navegadores só liberam áudio após interação do usuário.
if (typeof window !== 'undefined') {
  const unlock = () => audio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, delay = 0, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  tick(urgent = false) {
    tone(urgent ? 1046 : 784, 0.07, 'square', 0.05);
  },
  correct() {
    tone(660, 0.12, 'triangle', 0.18);
    tone(990, 0.18, 'triangle', 0.18, 0.09);
  },
  wrong() {
    tone(180, 0.22, 'sawtooth', 0.08, 0, 120);
  },
  myTurn() {
    tone(523, 0.1, 'sine', 0.16);
    tone(784, 0.14, 'sine', 0.16, 0.1);
  },
  pass() {
    tone(420, 0.08, 'sine', 0.06, 0, 640);
  },
  explode() {
    const a = audio();
    if (!a) return;
    const dur = 0.9;
    const buffer = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.2);
    const src = a.createBufferSource();
    src.buffer = buffer;
    const filter = a.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, a.currentTime);
    filter.frequency.exponentialRampToValueAtTime(90, a.currentTime + dur);
    const g = a.createGain();
    g.gain.value = 0.55;
    src.connect(filter).connect(g).connect(a.destination);
    src.start();
    tone(90, 0.5, 'sine', 0.35, 0, 40);
  },
  eliminated() {
    tone(392, 0.18, 'triangle', 0.12);
    tone(311, 0.18, 'triangle', 0.12, 0.16);
    tone(233, 0.35, 'triangle', 0.12, 0.32);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.12));
    tone(1318, 0.5, 'triangle', 0.14, 0.5);
  },
  stop() {
    tone(1400, 0.12, 'square', 0.08);
    tone(1050, 0.12, 'square', 0.08, 0.13);
    tone(700, 0.35, 'sawtooth', 0.07, 0.26, 300);
  },
  start() {
    tone(440, 0.12, 'square', 0.06);
    tone(440, 0.12, 'square', 0.06, 0.25);
    tone(880, 0.3, 'square', 0.07, 0.5);
  },
};
