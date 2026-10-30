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

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const big = size === 'lg';
  return (
    <div className={`flex items-center gap-2 ${big ? 'gap-3' : ''}`}>
      <BallBomb className={big ? 'h-16 w-16' : 'h-8 w-8'} />
      <span className={`font-display leading-none ${big ? 'text-5xl sm:text-6xl' : 'text-xl'}`}>
        <span className="text-white">FUT</span>
        <span className="text-lime">BOMB</span>
      </span>
    </div>
  );
}

/** Bola-bomba usada no logo. */
export function BallBomb({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path d="M44 14 C48 8 54 8 57 4" stroke="#c9a06a" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="57.5" cy="4.5" r="3.5" fill="#ffd84a" />
      <circle cx="30" cy="36" r="24" fill="#20242b" stroke="#c4ff3a" strokeWidth="3" />
      <path d="M30 24 l9 6.5 -3.4 10.5 h-11.2 L21 30.5Z" fill="#c4ff3a" />
      <path d="M30 24v-10M39 30.5l9.5-3M35.6 41l6 8M24.4 41l-6 8M21 30.5l-9.5-3" stroke="#c4ff3a" strokeWidth="2.5" />
    </svg>
  );
}
