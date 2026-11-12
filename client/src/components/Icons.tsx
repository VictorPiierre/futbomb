import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconCopy = (p: P) => (
  <svg {...base} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
export const IconVolume = (p: P) => (
  <svg {...base} {...p}><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
);
export const IconMute = (p: P) => (
  <svg {...base} {...p}><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m22 9-6 6M16 9l6 6" /></svg>
);
export const IconGear = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
);
export const IconSend = (p: P) => (
  <svg {...base} {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
);
export const IconCrown = (p: P) => (
  <svg {...base} {...p}><path d="m2 7 5 4 5-7 5 7 5-4-2 12H4Z" /></svg>
);
export const IconX = (p: P) => (
  <svg {...base} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconLink = (p: P) => (
  <svg {...base} {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
);

export function Logo({ size = 'md', game = 'pavio' }: { size?: 'md' | 'lg'; game?: 'pavio' | 'stop' | 'quiz' | 'dub' | 'ear' | 'hub' }) {
  const big = size === 'lg';
  const mark = big ? 'h-16 w-16 sm:h-20 sm:w-20' : 'h-9 w-9';
  if (game === 'hub') {
    return (
      <span className={`font-display leading-none ${big ? 'title-stroke text-5xl sm:text-6xl' : 'text-xl'}`}>
        Joga<span className="text-fire">tina</span>
      </span>
    );
  }
  if (game === 'ear') {
    return (
      <div className={`flex items-center ${big ? 'gap-3' : 'gap-2'}`}>
        <EarMark className={mark} />
        <span className={`font-display leading-none text-ok ${big ? 'text-5xl sm:text-7xl' : 'text-xl'}`}>Ouvidão</span>
      </div>
    );
  }
  if (game === 'dub') {
    return (
      <div className={`flex items-center ${big ? 'gap-3' : 'gap-2'}`}>
        <DubMark className={mark} />
        <span className={`font-display leading-none text-sky ${big ? 'text-5xl sm:text-7xl' : 'text-xl'}`}>Dublagem</span>
      </div>
    );
  }
  if (game === 'quiz') {
    return (
      <div className={`flex items-center ${big ? 'gap-3' : 'gap-2'}`}>
        <QuizMark className={mark} />
        <span className={`font-display leading-none text-spark ${big ? 'text-5xl sm:text-7xl' : 'text-xl'}`}>Chutômetro</span>
      </div>
    );
  }
  if (game === 'stop') {
    return (
      <div className={`flex items-center ${big ? 'gap-3' : 'gap-2'}`}>
        <StopMark className={mark} />
        <span className={`font-display leading-none text-pop ${big ? 'text-5xl sm:text-7xl' : 'text-xl'}`}>Stop!</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center ${big ? 'gap-3' : 'gap-2'}`}>
      <BombMark className={mark} />
      <span className={`font-display leading-[0.9] ${big ? 'title-stroke text-5xl sm:text-7xl' : 'text-xl'}`}>
        <span className="text-white">Pavio</span>{big ? <br /> : ' '}
        <span className="text-fire">Curto</span>
      </span>
    </div>
  );
}

/** Marca do Ouvidão: orelha com ondas de som. */
export function EarMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="32" r="29" fill="#241c33" stroke="#3ddc97" strokeWidth="3" />
      <path d="M24 26a10 10 0 1 1 20 0c0 6-5 8-6 12s-2 9-8 9c-3 0-5-2-5-4" fill="none" stroke="#3ddc97" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M29 27a5 5 0 0 1 10 0c0 3-3 4-4 6" fill="none" stroke="#bbf7d0" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 22c3 3 3 9 0 12M54 18c5 5 5 15 0 20" fill="none" stroke="#ffd23f" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14 18c-5 5-5 15 0 20" fill="none" stroke="#ffd23f" strokeWidth="2.6" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}

/** Marca do Dublagem: microfone com claquete. */
export function DubMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect x="6" y="40" width="52" height="18" rx="3" fill="#241c33" stroke="#38bdf8" strokeWidth="2.5" />
      <path d="M6 40 L12 32 H58 L52 40 Z" fill="#38bdf8" />
      <path d="M18 32 L13 40 M30 32 L25 40 M42 32 L37 40 M54 32 L49 40" stroke="#120d1b" strokeWidth="3" />
      <rect x="23" y="4" width="18" height="28" rx="9" fill="#38bdf8" stroke="#bae6fd" strokeWidth="2" />
      <path d="M27 12h10M27 17h10M27 22h10" stroke="#120d1b" strokeWidth="1.8" strokeLinecap="round" opacity=".55" />
      <text x="32" y="54" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize="10" fill="#38bdf8">REC</text>
      <circle cx="14" cy="49" r="3" fill="#ff4d5e" />
    </svg>
  );
}

/** Marca do Chutômetro: medidor com ponteiro. */
export function QuizMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="36" r="26" fill="#241c33" stroke="#ffd23f" strokeWidth="3" />
      <path d="M12 40a20 20 0 0 1 40 0" fill="none" stroke="#3a2f4a" strokeWidth="6" strokeLinecap="round" />
      <path d="M12 40a20 20 0 0 1 14-19" fill="none" stroke="#3ddc97" strokeWidth="6" strokeLinecap="round" />
      <path d="M26 21a20 20 0 0 1 14 0" fill="none" stroke="#ffd23f" strokeWidth="6" strokeLinecap="round" />
      <path d="M40 21a20 20 0 0 1 12 19" fill="none" stroke="#ff4d5e" strokeWidth="6" strokeLinecap="round" />
      <path d="M32 40 L44 24" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="32" cy="40" r="4.5" fill="#ffd23f" />
      <text x="32" y="56" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize="9" fill="#ffd23f">???</text>
    </svg>
  );
}

/** Marca do Stop: placa octogonal. */
export function StopMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path d="M21 4h22l17 17v22L43 60H21L4 43V21Z" fill="#ff3d7f" stroke="#ffd0df" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M23 9h18l14 14v18L41 55H23L9 41V23Z" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" />
      <text x="32" y="38.5" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize="15" fill="#fff">STOP</text>
    </svg>
  );
}

/** Marca: bomba de desenho com pavio aceso. */
export function BombMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id="bm-body" cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#4a3d5e" />
          <stop offset="55%" stopColor="#221a2e" />
          <stop offset="100%" stopColor="#0f0b16" />
        </radialGradient>
      </defs>
      <path d="M41 17 C44 10 50 11 52 6" stroke="#d8a56b" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M52 1.5 l1.4 3.2 3.4 .4 -2.6 2.2 .8 3.3 -3-1.8 -3 1.8 .8-3.3 -2.6-2.2 3.4-.4Z" fill="#ffd23f" />
      <circle cx="52" cy="6" r="2.2" fill="#ff7a1a" />
      <rect x="33" y="14" width="12" height="9" rx="2.5" transform="rotate(35 39 18.5)" fill="#3a2f4a" stroke="#ff7a1a" strokeWidth="2" />
      <circle cx="28" cy="38" r="22" fill="url(#bm-body)" stroke="#ff7a1a" strokeWidth="2.5" />
      <ellipse cx="20" cy="29" rx="6" ry="3.5" transform="rotate(-35 20 29)" fill="#fff" opacity="0.22" />
    </svg>
  );
}
