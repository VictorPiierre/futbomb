const RINGS = ['#ff7a1a', '#ff3d7f', '#ffd23f', '#3ddc97', '#38bdf8', '#b48cff'];

export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return RINGS[h % RINGS.length];
}

interface Props {
  emoji: string;
  id: string;
  size?: number;
  dim?: boolean;
  className?: string;
}

export default function Avatar({ emoji, id, size = 56, dim = false, className = '' }: Props) {
  const color = colorFor(id);
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-full transition-[filter,opacity] duration-500 ${dim ? 'opacity-50 grayscale' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: `radial-gradient(circle at 35% 30%, ${color}33, #1c2027 70%)`,
        border: `2px solid ${color}88`,
      }}
    >
      <span className="leading-none select-none">{emoji}</span>
    </div>
  );
}

export function Hearts({ lives, size = 16 }: { lives: number; size?: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${lives} vidas`}>
      {[0, 1].map((i) => {
        const full = i < lives;
        return (
          <span key={`${i}-${full}`} className={full ? '' : 'heart-lose'} style={{ fontSize: size, lineHeight: 1 }}>
            {full ? '❤️' : '🖤'}
          </span>
        );
      })}
    </div>
  );
}
