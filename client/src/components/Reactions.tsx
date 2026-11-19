import { useState } from 'react';
import { REACTIONS } from '../../../shared/reactions';
import { socket, useSocketEvent } from '../net';

interface Floating {
  key: number;
  emoji: string;
  name: string;
  x: number;
  mine: boolean;
}

/** Barra de reações + emojis subindo pela tela de todo mundo. */
export default function Reactions({ meId }: { meId: string }) {
  const [items, setItems] = useState<Floating[]>([]);
  const [open, setOpen] = useState(false);

  useSocketEvent<{ memberId: string; name: string; emoji: string }>('room:react', (r) => {
    const key = Date.now() + Math.random();
    // Limita a quantidade na tela para não pesar quando todo mundo spamma.
    setItems((list) => [...list.slice(-24), { key, emoji: r.emoji, name: r.name, x: 8 + Math.random() * 78, mine: r.memberId === meId }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.key !== key)), 2600);
  });

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden>
        {items.map((i) => (
          <div key={i.key} className="react-float absolute bottom-16 flex flex-col items-center" style={{ left: `${i.x}%` }}>
            <span className="text-4xl drop-shadow-lg sm:text-5xl">{i.emoji}</span>
            <span className={`mt-0.5 max-w-[90px] truncate rounded-full px-1.5 text-[10px] font-bold ${i.mine ? 'bg-sky/80 text-ink' : 'bg-ink/70 text-white'}`}>{i.name}</span>
          </div>
        ))}
      </div>

      <div className="fixed right-3 bottom-3 z-40 flex items-center gap-1.5">
        {open && (
          <div className="pop-in flex flex-wrap justify-end gap-1 rounded-2xl border border-line bg-panel/95 p-1.5 shadow-xl backdrop-blur">
            {REACTIONS.map((e) => (
              <button
                key={e}
                onClick={() => socket.emit('room:react', e)}
                className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl text-2xl transition hover:scale-125 hover:bg-panel-2 active:scale-90"
                aria-label={`Reagir com ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className={`grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full border-2 text-2xl shadow-xl transition hover:scale-110 ${open ? 'border-pop bg-pop/25' : 'border-line bg-panel/95'}`}
          aria-label={open ? 'Fechar reações' : 'Abrir reações'}
          title="Reações"
        >
          {open ? '✖️' : '😂'}
        </button>
      </div>
    </>
  );
}
