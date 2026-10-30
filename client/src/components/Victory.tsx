import { useEffect, useRef, useState } from 'react';
import type { StopPublicRoom } from '../../../shared/stop';
import type { PublicRoom } from '../../../shared/types';
import { emitAck } from '../net';
import Avatar from './Avatar';

const MEDALS = ['🥇', '🥈', '🥉', '4º'];

export default function Victory({ room, meId, isHost }: { room: PublicRoom | StopPublicRoom; meId: string; isHost: boolean }) {
  const ranking = (room.ranking ?? []).map((r) => ({
    ...r,
    stat: 'score' in r ? `${r.score} pts` : `${r.correct} ✓`,
    detail: 'score' in r ? `${r.score} pontos` : `${r.correct} ${r.correct === 1 ? 'resposta certa' : 'respostas certas'}`,
  }));
  const winner = ranking[0] && ranking[0].playerId === room.winnerId ? ranking[0] : null;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const connectedPlayers = room.players.filter((p) => p.connected && !p.left).length + room.spectators.filter((s) => s.connected).length;

  async function restart(startNow: boolean) {
    setBusy(true);
    const res = await emitAck<{ ok: boolean; error?: string }>('game:restart', startNow);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Não foi possível reiniciar.');
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-md">
      <Confetti />
      <div className="pop-in relative w-full max-w-md rounded-3xl border border-fire/30 bg-panel p-6 text-center shadow-[0_0_80px_-20px_rgb(255_122_26/0.45)]">
        <div className="text-5xl">🏆</div>
        <p className="mt-2 font-display text-2xl text-fire sm:text-3xl">{room.kind === 'stop' ? 'CAMPEÃO DO STOP!' : 'CAMPEÃO DO PAVIO CURTO!'}</p>
        {winner ? (
          <div className="mt-5 flex flex-col items-center">
            <div className="turn-glow rounded-full">
              <Avatar emoji={winner.avatar} id={winner.playerId} size={96} />
            </div>
            <p className="mt-3 font-display text-3xl">{winner.name}</p>
            <p className="text-sm text-muted">
              {winner.detail}
              {winner.playerId === meId && ' · É você! 🎉'}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-muted">Ninguém sobreviveu desta vez!</p>
        )}

        <ol className="mt-6 space-y-2 text-left">
          {ranking.map((r) => (
            <li
              key={r.playerId}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${r.place === 1 ? 'bg-fire/10' : 'bg-panel-2'} ${r.playerId === meId ? 'ring-1 ring-pop/60' : ''}`}
            >
              <span className="w-7 text-center text-lg">{MEDALS[r.place - 1] ?? `${r.place}º`}</span>
              <Avatar emoji={r.avatar} id={r.playerId} size={32} dim={r.place > 1} />
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              {r.left && <span className="text-[10px] font-bold text-danger">SAIU</span>}
              <span className="text-xs text-muted tabular-nums">{r.stat}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6">
          {isHost ? (
            <div className="flex flex-col gap-2">
              <button disabled={busy || connectedPlayers < 2} onClick={() => restart(true)} className="btn-primary w-full py-3.5">
                Jogar novamente
              </button>
              <button disabled={busy} onClick={() => restart(false)} className="cursor-pointer py-1 text-sm text-muted hover:text-white">
                Voltar à sala de espera (mudar configurações)
              </button>
              {connectedPlayers < 2 && <p className="text-xs text-muted">Aguardando pelo menos 2 jogadores na sala.</p>}
            </div>
          ) : (
            <p className="rounded-xl bg-panel-2 py-3 text-sm text-muted">Aguardando o anfitrião começar outra partida…</p>
          )}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);
    const colors = ['#ff7a1a', '#ff3d7f', '#ffffff', '#ffd23f', '#3ddc97', '#38bdf8'];
    const pieces = Array.from({ length: 160 }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.8,
      w: 6 + Math.random() * 6,
      h: 10 + Math.random() * 8,
      vy: 2 + Math.random() * 3,
      vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: -0.15 + Math.random() * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    let raf = 0;
    const draw = (t: number) => {
      const elapsed = t - t0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = 0;
      for (const p of pieces) {
        p.x += p.vx + Math.sin((t + p.y) / 400) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        // Recicla os confetes nos primeiros segundos.
        if (p.y > innerHeight + 20 && elapsed < 3500) p.y = -20;
        if (p.y <= innerHeight + 20) alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot)));
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 h-full w-full" />;
}
