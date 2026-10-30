import { useEffect, useRef, useState } from 'react';
import { serverNow } from '../net';
import { sfx } from '../sound';

interface Props {
  letter: string;
  turnEndsAt: number | null;
  duration: number;
  /** Ângulo (graus) do jogador da vez; null = sem seta. */
  angle: number | null;
  /** Muda a cada passagem da bomba para animar o "pulo". */
  passKey: string;
  exploding: boolean;
}

const URGENT_MS = 3000;

export default function Bomb({ letter, turnEndsAt, duration, angle, passKey, exploding }: Props) {
  const [remaining, setRemaining] = useState(duration);
  const fuseRef = useRef<SVGPathElement>(null);
  const sparkRef = useRef<SVGGElement>(null);
  const lastSecond = useRef<number | null>(null);

  // Cronômetro visual sincronizado com o horário do servidor.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const left = turnEndsAt ? Math.max(0, turnEndsAt - serverNow()) : 0;
      setRemaining(left);
      const frac = turnEndsAt ? Math.min(1, left / duration) : 0;
      const fuse = fuseRef.current;
      if (fuse && sparkRef.current) {
        const len = fuse.getTotalLength();
        fuse.style.strokeDasharray = `${len * frac} ${len}`;
        const pt = fuse.getPointAtLength(len * frac);
        sparkRef.current.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
        sparkRef.current.style.opacity = turnEndsAt && frac > 0 ? '1' : '0';
      }
      const sec = Math.ceil(left / 1000);
      if (turnEndsAt && left > 0 && sec !== lastSecond.current) {
        if (lastSecond.current !== null && sec <= 3) sfx.tick(sec <= 1);
        lastSecond.current = sec;
      }
      if (turnEndsAt) raf = requestAnimationFrame(loop);
    };
    lastSecond.current = null;
    loop();
    return () => cancelAnimationFrame(raf);
  }, [turnEndsAt, duration]);

  // Mantém a rotação contínua (sem dar a volta longa ao passar de 170° para -170°).
  const rot = useRef(0);
  if (angle !== null) {
    const delta = ((((angle - rot.current) % 360) + 540) % 360) - 180;
    rot.current += delta;
  }

  const running = !!turnEndsAt;
  const urgent = running && remaining <= URGENT_MS;
  const frac = running ? remaining / duration : 0;
  const secs = Math.ceil(remaining / 1000);
  const ringColor = urgent ? '#ff4d5e' : frac < 0.5 ? '#ffd23f' : '#ff7a1a';
  const C = 2 * Math.PI * 88;

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative h-[clamp(150px,34vw,230px)] w-[clamp(150px,34vw,230px)]">
        {/* seta apontando para o jogador da vez */}
        {angle !== null && !exploding && (
          <div
            className="pointer-events-none absolute inset-[-14%] transition-transform duration-500 ease-[cubic-bezier(.3,1.4,.5,1)]"
            style={{ transform: `rotate(${rot.current}deg)` }}
          >
            <div className="absolute top-1/2 right-0 -translate-y-1/2">
              <svg width="26" height="30" viewBox="0 0 26 30">
                <path d="M2 2 L24 15 L2 28 L8 15Z" fill={urgent ? '#ff4d5e' : '#ff7a1a'} />
              </svg>
            </div>
          </div>
        )}

        <div key={passKey} className={`absolute inset-0 ${exploding ? 'opacity-0' : 'bomb-hop'} transition-opacity duration-150`}>
          <div className={`h-full w-full ${urgent ? 'bomb-shake' : ''}`}>
            <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible">
              <defs>
                <radialGradient id="ballShade" cx="38%" cy="32%" r="75%">
                  <stop offset="0%" stopColor="#4d3f63" />
                  <stop offset="55%" stopColor="#211a2d" />
                  <stop offset="100%" stopColor="#0d0913" />
                </radialGradient>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* anel do cronômetro */}
              <circle cx="100" cy="108" r="88" fill="none" stroke="#ffffff10" strokeWidth="6" />
              <circle
                cx="100" cy="108" r="88" fill="none" stroke={ringColor} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 100 108)"
                style={{ transition: 'stroke 0.3s' }} filter="url(#glow)"
              />

              {/* pavio */}
              <path d="M128 58 C 140 40, 132 26, 150 18 S 176 18, 182 4" fill="none" stroke="#3d3047" strokeWidth="6" strokeLinecap="round" />
              <path ref={fuseRef} d="M128 58 C 140 40, 132 26, 150 18 S 176 18, 182 4" fill="none" stroke="#d6a86a" strokeWidth="6" strokeLinecap="round" />
              <rect x="116" y="52" width="22" height="14" rx="4" transform="rotate(-38 127 59)" fill="#3a2f4a" stroke="#ff7a1a" strokeWidth="2" />
              <g ref={sparkRef} style={{ opacity: 0 }}>
                <circle className="spark" r="10" fill="#ff7a1a" opacity="0.45" />
                <circle className="spark" r="5" fill="#ffd23f" />
                <path d="M-12 0H12M0-12V12M-8-8L8 8M-8 8L8-8" stroke="#ffb02e" strokeWidth="1.6" />
              </g>

              {/* bomba */}
              <circle cx="100" cy="108" r="66" fill="url(#ballShade)" stroke={urgent ? '#ff4d5e' : '#ff7a1a'} strokeWidth="3" />
              <ellipse cx="74" cy="80" rx="20" ry="11" fill="#ffffff" opacity="0.14" transform="rotate(-35 74 80)" />
              <circle cx="62" cy="98" r="4" fill="#ffffff" opacity="0.1" />
              <text
                key={letter}
                x="100" y="110" textAnchor="middle" dominantBaseline="central"
                className="letter-in font-display" fill="#ffffff" fontSize="72"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                {letter}
              </text>
            </svg>
          </div>
        </div>
      </div>

      <div
        className={`mt-1 font-display text-3xl tabular-nums transition-colors sm:text-4xl ${
          urgent ? 'text-danger' : running ? 'text-fire' : 'text-muted'
        }`}
      >
        00:{String(running ? secs : 0).padStart(2, '0')}
      </div>
    </div>
  );
}
