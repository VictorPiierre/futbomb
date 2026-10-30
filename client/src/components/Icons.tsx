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

export function Logo({ size = 'md', game = 'pavio' }: { size?: 'md' | 'lg'; game?: 'pavio' | 'stop' | 'hub' }) {
  const big = size === 'lg';
  const mark = big ? 'h-16 w-16 sm:h-20 sm:w-20' : 'h-9 w-9';
  if (game === 'hub') {
    return (
      <span className={`font-display leading-none ${big ? 'title-stroke text-5xl sm:text-6xl' : 'text-xl'}`}>
        Joga<span className="text-fire">tina</span>
      </span>
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
