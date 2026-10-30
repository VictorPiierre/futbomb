import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { THEMES, themePrompt, type AnswerResult, type GameFx, type PublicPlayer, type PublicRoom } from '../../../shared/types';
import { emitAck, socket, useSocketEvent } from '../net';
import { sfx } from '../sound';
import Avatar, { Hearts } from './Avatar';
import Bomb from './Bomb';
import { IconCrown, IconSend } from './Icons';

interface Props {
  room: PublicRoom;
  meId: string;
  me: PublicPlayer | undefined;
}

type Flash = { kind: 'correct' | 'hit'; key: number };

const KICK = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-6px, 4px)' },
  { transform: 'translate(5px, -4px)' },
  { transform: 'translate(-3px, -2px)' },
  { transform: 'translate(0, 0)' },
];
const SHAKE = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-8px)' },
  { transform: 'translateX(8px)' },
  { transform: 'translateX(0)' },
];

function seatAngles(n: number) {
  const start = n === 2 ? 180 : n === 4 ? -135 : -90;
  return Array.from({ length: n }, (_, i) => start + (360 / n) * i);
}

export default function Arena({ room, meId, me }: Props) {
  const game = room.game!;
  const players = room.players;
  const angles = useMemo(() => seatAngles(players.length), [players.length]);
  const currentIdx = players.findIndex((p) => p.id === game.currentPlayerId);
  const current = players[currentIdx];
  const theme = THEMES[game.theme];
  const prompt = themePrompt(game.theme);
  const mixed = room.settings.theme === 'mixed';

  const [typing, setTyping] = useState<Record<string, string>>({});
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  const [explosion, setExplosion] = useState<{ key: number; playerId: string } | null>(null);
  const [floater, setFloater] = useState<{ key: number; text: string } | null>(null);
  const [feed, setFeed] = useState<{ key: number; text: string; tone: 'ok' | 'bad' | 'info' } | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  useSocketEvent<{ playerId: string; text: string }>('game:typing', ({ playerId, text }) => {
    setTyping((t) => ({ ...t, [playerId]: text }));
  });

  useSocketEvent<GameFx>('game:fx', (fx) => {
    const key = Date.now() + Math.random();
    switch (fx.type) {
      case 'correct':
        setFlashes((f) => ({ ...f, [fx.playerId]: { kind: 'correct', key } }));
        setFloater({ key, text: fx.canonical });
        setFeed({ key, text: `${nameOf(fx.playerId)} acertou: ${fx.canonical}`, tone: 'ok' });
        if (fx.playerId === meId) sfx.correct();
        else sfx.pass();
        break;
      case 'explode':
        setExplosion({ key, playerId: fx.playerId });
        setFlashes((f) => ({ ...f, [fx.playerId]: { kind: 'hit', key } }));
        arenaRef.current?.animate(KICK, { duration: 350, easing: 'ease-out' });
        setFeed({
          key,
          text: `💥 ${nameOf(fx.playerId)} não respondeu a tempo e ${fx.lives === 0 ? 'perdeu a última vida' : 'perdeu uma vida'}!`,
          tone: 'bad',
        });
        sfx.explode();
        setTimeout(() => setExplosion((e) => (e?.key === key ? null : e)), 1100);
        break;
      case 'eliminated':
        setFeed({
          key,
          text: fx.reason === 'left' ? `${nameOf(fx.playerId)} saiu da partida.` : `☠️ ${nameOf(fx.playerId)} foi eliminado!`,
          tone: 'bad',
        });
        setTimeout(() => sfx.eliminated(), 450);
        break;
      case 'letter':
        if (fx.round > 1) setFeed({ key, text: `Nova volta! ${THEMES[fx.theme].icon} ${THEMES[fx.theme].short} · Letra ${fx.letter}`, tone: 'info' });
        break;
      case 'turn':
        setTyping({});
        if (fx.playerId === meId) sfx.myTurn();
        break;
    }
  });

  const exploding = !!explosion;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="flex min-w-0 flex-col items-center">
        {/* letra da volta */}
        <div className="mb-2 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
            {mixed ? '🎲 Tema da volta' : 'Categoria'} · Volta {game.round}
          </p>
          <p key={`${game.round}-${game.theme}`} className="letter-in text-lg font-bold text-pop-soft">
            {theme.icon} {theme.label}
          </p>
          <p key={game.letter} className="letter-in font-display text-4xl leading-tight text-fire sm:text-5xl">
            LETRA {game.letter}
          </p>
        </div>

        {/* arena */}
        <div ref={arenaRef} className="stage relative aspect-square w-full max-w-[600px] rounded-full">
          <div className="absolute inset-0 flex items-center justify-center">
            <Bomb
              letter={game.letter}
              turnEndsAt={game.status === 'turn' ? game.turnEndsAt : null}
              duration={game.turnDuration}
              angle={currentIdx >= 0 ? angles[currentIdx] : null}
              passKey={game.currentPlayerId ?? 'none'}
              exploding={exploding}
            />
          </div>

          {explosion && <Explosion key={explosion.key} />}

          {floater && (
            <div key={floater.key} className="float-up pointer-events-none absolute top-[24%] left-1/2 z-20 rounded-full bg-ok px-3 py-1 text-sm font-bold whitespace-nowrap text-ink shadow-lg">
              ✓ {floater.text}
            </div>
          )}

          {players.map((p, i) => {
            const a = (angles[i] * Math.PI) / 180;
            return (
              <div
                key={p.id}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${50 + 41 * Math.cos(a)}%`, top: `${50 + 41 * Math.sin(a)}%` }}
              >
                <Seat
                  player={p}
                  isCurrent={p.id === game.currentPlayerId && game.status === 'turn'}
                  isMe={p.id === meId}
                  isHost={p.id === room.hostId}
                  typing={p.id === game.currentPlayerId ? typing[p.id] : undefined}
                  flash={flashes[p.id]}
                />
              </div>
            );
          })}
        </div>

        <p className="mt-2 text-center font-semibold">
          {game.status === 'turn' && current ? (
            current.id === meId ? (
              <span className="text-fire">Sua vez! Digite {prompt} que começa com {game.letter}</span>
            ) : (
              <>
                Vez de <span className="text-fire">{current.name}</span> — {theme.noun} com {game.letter}
              </>
            )
          ) : (
            <span className="text-muted">Preparando a próxima rodada…</span>
          )}
        </p>

        <AnswerBar room={room} me={me} meId={meId} feed={feed} />
      </div>

      <aside className="flex flex-col gap-4">
        <div className="glass rounded-2xl p-4">
          <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Placar</h3>
          <ul className="space-y-2">
            {players.map((p) => (
              <li key={p.id} className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 ${p.id === game.currentPlayerId ? 'bg-fire/10' : ''}`}>
                <Avatar emoji={p.avatar} id={p.id} size={30} dim={p.eliminated} />
                <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${p.eliminated ? 'text-muted line-through' : ''}`}>
                  {p.name}
                </span>
                <span className="text-xs text-muted tabular-nums">{p.correct} ✓</span>
                <Hearts lives={p.lives} size={13} />
              </li>
            ))}
          </ul>
          {room.spectators.length > 0 && (
            <p className="mt-3 border-t border-line pt-2 text-xs text-muted">
              👀 Assistindo: {room.spectators.map((s) => s.name).join(', ')}
            </p>
          )}
        </div>

        <div className="glass flex-1 rounded-2xl p-4">
          <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Últimas respostas válidas</h3>
          {game.history.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma resposta ainda. A bomba está acesa! 🔥</p>
          ) : (
            <ul className="space-y-1.5">
              {game.history.slice(0, 10).map((h) => (
                <li key={h.id} className="slide-in flex items-baseline gap-2 text-sm">
                  <span className="text-ok">✓</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{h.canonical}</span>
                  <span className="shrink-0 text-xs text-muted">{h.playerName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function Seat({ player, isCurrent, isMe, isHost, typing, flash }: {
  player: PublicPlayer;
  isCurrent: boolean;
  isMe: boolean;
  isHost: boolean;
  typing?: string;
  flash?: Flash;
}) {
  const out = player.eliminated;
  return (
    <div className="flex w-[92px] flex-col items-center sm:w-[120px]">
      <div key={flash?.key} className={`relative ${flash?.kind === 'hit' ? 'seat-hit' : ''}`}>
        <div
          className={`rounded-full transition-transform duration-300 ${isCurrent ? 'turn-glow scale-110' : ''} ${flash?.kind === 'correct' ? 'seat-correct' : ''}`}
        >
          <Avatar emoji={player.avatar} id={player.id} size={58} dim={out || !player.connected} />
        </div>
        {out && <span className="absolute inset-0 grid place-items-center text-3xl">💀</span>}
        {isHost && !out && (
          <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-pop text-white" title="Anfitrião">
            <IconCrown width={11} />
          </span>
        )}
      </div>
      <span className={`mt-1.5 max-w-full truncate text-sm font-bold ${isMe ? 'text-fire' : ''} ${out ? 'text-muted' : ''}`}>
        {player.name}
      </span>
      {out ? (
        <span className="rounded bg-danger/15 px-1.5 text-[10px] font-bold tracking-wider text-danger">
          {player.left ? 'SAIU' : 'ELIMINADO'}
        </span>
      ) : (
        <Hearts lives={player.lives} size={15} />
      )}
      {!player.connected && !out && <span className="text-[10px] text-danger">offline</span>}
      {isCurrent && (
        <div className="mt-1 max-w-[140px] min-w-[60px] truncate rounded-lg bg-white px-2 py-0.5 text-center text-xs font-semibold text-ink shadow">
          {typing || <span className="text-ink/40">digitando…</span>}
        </div>
      )}
    </div>
  );
}

function Explosion() {
  const parts = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 90 + Math.random() * 110;
        return {
          dx: Math.cos(ang) * dist,
          dy: Math.sin(ang) * dist,
          size: 6 + Math.random() * 10,
          color: ['#ffd23f', '#ff7a1a', '#ff4d5e', '#ff3d7f', '#ffffff'][i % 5],
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
      <div className="explosion-flash absolute h-[44%] w-[44%] rounded-full" />
      {parts.map((p, i) => (
        <span
          key={i}
          className="particle absolute rounded-full"
          style={{ width: p.size, height: p.size, background: p.color, ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px` }}
        />
      ))}
      <span className="pop-in absolute font-display text-4xl text-white drop-shadow-[0_2px_10px_#ff4d5e]">BOOM!</span>
    </div>
  );
}

function AnswerBar({ room, me, meId, feed }: {
  room: PublicRoom;
  me: PublicPlayer | undefined;
  meId: string;
  feed: { key: number; text: string; tone: 'ok' | 'bad' | 'info' } | null;
}) {
  const game = room.game!;
  const myTurn = game.currentPlayerId === meId && game.status === 'turn' && room.phase === 'playing';
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ key: number; text: string; tone: 'ok' | 'bad' } | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (myTurn) {
      setText('');
      setMsg(null);
      inputRef.current?.focus();
    }
  }, [myTurn, game.round, game.currentPlayerId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!myTurn || !text.trim() || sending) return;
    setSending(true);
    const res = await emitAck<AnswerResult>('game:answer', text);
    setSending(false);
    if (res.ok) {
      setText('');
      setMsg({ key: Date.now(), text: `Boa! ${res.canonical} ✓`, tone: 'ok' });
    } else {
      sfx.wrong();
      inputRef.current?.animate(SHAKE, { duration: 250, iterations: 2 });
      setMsg({ key: Date.now(), text: res.reason ?? 'Resposta não aceita.', tone: 'bad' });
      inputRef.current?.select();
    }
  }

  const placeholder = !me
    ? 'Você está assistindo — entra na próxima partida'
    : me.eliminated
      ? 'Você foi eliminado — acompanhe como espectador'
      : myTurn
        ? `Digite ${themePrompt(game.theme)} com ${game.letter}… e aperte Enter`
        : 'Aguarde sua vez…';

  const shown = msg && (!feed || msg.key >= feed.key) ? msg : feed;

  return (
    <div className="mt-3 w-full max-w-[600px]">
      <form onSubmit={submit} className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          disabled={!myTurn}
          maxLength={60}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            socket.emit('game:typing', e.target.value);
          }}
          placeholder={placeholder}
          className={`min-w-0 flex-1 rounded-2xl border-2 bg-panel-2 px-4 py-3.5 text-lg font-semibold outline-none transition placeholder:text-base placeholder:font-normal disabled:cursor-not-allowed disabled:opacity-60 ${myTurn ? 'border-fire/70 shadow-[0_0_0_4px_rgb(255_122_26/0.15)]' : 'border-line'}`}
        />
        <button disabled={!myTurn || !text.trim() || sending} className="btn-primary flex items-center gap-2 rounded-2xl px-5">
          <IconSend width={18} /> <span className="hidden sm:inline">Enviar</span>
        </button>
      </form>
      <div className="mt-2 min-h-[28px] text-center text-sm">
        {shown && (
          <p
            key={shown.key}
            className={`slide-in inline-block rounded-lg px-3 py-1 ${
              shown.tone === 'ok' ? 'bg-ok/10 text-ok' : shown.tone === 'bad' ? 'bg-danger/10 text-danger' : 'bg-pop/10 text-pop-soft'
            }`}
          >
            {shown.text}
          </p>
        )}
      </div>
    </div>
  );
}
