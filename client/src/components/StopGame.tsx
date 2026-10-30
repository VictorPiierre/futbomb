import { useEffect, useRef, useState } from 'react';
import { normalize } from '../../../shared/normalize';
import {
  STOP_MAX_CATEGORIES, STOP_MAX_PLAYERS, STOP_MIN_CATEGORIES, STOP_ROUNDS, STOP_TIMES,
  type StopAnswer, type StopPublicRoom, type StopSettings,
} from '../../../shared/stop';
import { THEMES, THEME_IDS, type Theme } from '../../../shared/types';
import { emitAck, inviteLink, serverNow, socket, useSocketEvent } from '../net';
import { sfx } from '../sound';
import Avatar from './Avatar';
import { IconCopy, IconCrown, IconLink, StopMark } from './Icons';

interface Props {
  room: StopPublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

// Guarda as respostas que o servidor devolve ao reconectar, mesmo antes da tela montar.
let mine: { round: number; answers: Partial<Record<Theme, string>> } = { round: 0, answers: {} };
socket.on('stop:mine', (p: typeof mine) => (mine = p));

function useRemaining(endsAt: number | null) {
  const [ms, setMs] = useState(() => (endsAt ? Math.max(0, endsAt - serverNow()) : 0));
  useEffect(() => {
    const tick = () => setMs(endsAt ? Math.max(0, endsAt - serverNow()) : 0);
    tick();
    const id = window.setInterval(tick, 200);
    return () => clearInterval(id);
  }, [endsAt]);
  return ms;
}

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function StopGame(props: Props) {
  const { room } = props;
  const prevRound = useRef(room.round);
  const prevStop = useRef(room.stoppedBy);

  useEffect(() => {
    if (room.phase === 'playing' && room.round !== prevRound.current) sfx.start();
    prevRound.current = room.round;
  }, [room.phase, room.round]);

  useEffect(() => {
    if (room.stoppedBy && !prevStop.current) sfx.stop();
    prevStop.current = room.stoppedBy;
  }, [room.stoppedBy]);

  if (room.phase === 'lobby') return <StopLobby {...props} />;
  if (room.phase === 'playing') return <StopPlay key={room.round} {...props} />;
  if (room.phase === 'review') return <StopReview {...props} />;
  return <StopScores {...props} />;
}

// ---------- sala de espera ----------

function StopLobby({ room, meId, isHost, onCopy }: Props) {
  const [error, setError] = useState('');
  const ready = room.players.filter((p) => p.connected).length;
  const amSpectator = room.spectators.some((s) => s.id === meId);
  const seatFree = room.players.length < room.settings.maxPlayers;

  async function start() {
    const res = await emitAck<{ ok: boolean; error?: string }>('game:start');
    setError(res.ok ? '' : (res.error ?? 'Erro ao iniciar.'));
  }

  return (
    <div className="pop-in grid gap-5 lg:grid-cols-[1fr_420px]">
      <section className="glass rounded-3xl p-5 sm:p-7">
        <p className="text-xs font-semibold tracking-wider text-muted uppercase">Sala de espera</p>
        <h1 className="font-display text-2xl sm:text-3xl">
          {room.players.length}/{room.settings.maxPlayers} jogadores
        </h1>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {room.players.map((p) => (
            <div key={p.id} className={`pop-in flex items-center gap-2.5 rounded-2xl border p-2.5 ${p.id === meId ? 'border-pop/50 bg-pop/5' : 'border-line bg-panel/60'}`}>
              <div className="relative">
                <Avatar emoji={p.avatar} id={p.id} size={40} dim={!p.connected} />
                {p.id === room.hostId && (
                  <span className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-fire text-ink" title="Anfitrião">
                    <IconCrown width={11} />
                  </span>
                )}
              </div>
              <span className="min-w-0 truncate text-sm font-semibold">
                {p.name}
                {p.id === meId && <span className="text-muted"> (você)</span>}
              </span>
            </div>
          ))}
          {Array.from({ length: Math.max(0, Math.min(4, room.settings.maxPlayers - room.players.length)) }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-2xl border border-dashed border-line p-2.5 text-sm text-muted">
              <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-dashed border-line">?</span>
              Aguardando…
            </div>
          ))}
        </div>

        {room.spectators.length > 0 && (
          <p className="mt-4 text-xs text-muted">👀 Assistindo: {room.spectators.map((s) => s.name).join(', ')}</p>
        )}
        {amSpectator && (
          <button disabled={!seatFree} onClick={() => socket.emit('room:seat', true)} className="btn-secondary mt-4 px-4 text-sm">
            {seatFree ? 'Entrar como jogador' : 'Sala cheia — você está assistindo'}
          </button>
        )}

        <div className="mt-6 rounded-2xl border border-pop/30 bg-pop/10 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-pop-soft">
            <IconLink width={16} /> Convide seus amigos
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-ink/60 px-3 py-2.5 text-sm">{inviteLink(room.code)}</code>
            <button onClick={onCopy} className="btn-secondary flex items-center gap-1.5 px-4 text-sm">
              <IconCopy width={15} /> Copiar
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-panel/60 p-4 text-sm text-muted">
          <p className="mb-1 font-semibold text-white">Como funciona</p>
          Uma letra é sorteada e todos preenchem as categorias ao mesmo tempo. Quem completar tudo pode apertar{' '}
          <b className="text-pop">STOP</b> e a rodada acaba para todos. Depois, todo mundo vota nas respostas: resposta única
          vale <b className="text-white">10</b>, repetida vale <b className="text-white">5</b>.
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <StopSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2} className="btn-primary w-full py-4 text-xl">
                Começar o Stop
              </button>
              {ready < 2 && <p className="mt-2 text-center text-xs text-muted">Precisa de pelo menos 2 jogadores conectados.</p>}
            </>
          ) : (
            <div className="rounded-xl bg-panel-2 py-4 text-center text-sm text-muted">Aguardando {room.hostName} começar…</div>
          )}
          {error && <p className="slide-in mt-3 text-center text-sm text-danger">{error}</p>}
        </div>
      </aside>
    </div>
  );
}

export function StopSettingsPanel({ room, editable }: { room: StopPublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<StopSettings>) => editable && socket.emit('room:settings', patch);
  const toggle = (t: Theme) => {
    const has = s.categories.includes(t);
    if (has && s.categories.length <= STOP_MIN_CATEGORIES) return;
    if (!has && s.categories.length >= STOP_MAX_CATEGORIES) return;
    set({ categories: has ? s.categories.filter((c) => c !== t) : [...s.categories, t] });
  };
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">
          Categorias ({s.categories.length}/{STOP_MAX_CATEGORIES})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {THEME_IDS.map((t) => (
            <button key={t} disabled={!editable} onClick={() => toggle(t)} className={`${chip(s.categories.includes(t))} px-2.5 py-1.5 text-xs`}>
              {THEMES[t].icon} {THEMES[t].short}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">Mínimo {STOP_MIN_CATEGORIES}, máximo {STOP_MAX_CATEGORIES}.</p>
      </div>
      <Row label="Rodadas">
        {STOP_ROUNDS.map((n) => (
          <button key={n} disabled={!editable} onClick={() => set({ rounds: n })} className={`${chip(s.rounds === n)} flex-1`}>
            {n}
          </button>
        ))}
      </Row>
      <Row label="Tempo por rodada">
        {STOP_TIMES.map((t) => (
          <button key={t} disabled={!editable} onClick={() => set({ roundTime: t })} className={`${chip(s.roundTime === t)} flex-1`}>
            {t < 120 ? `${t}s` : `${t / 60} min`}
          </button>
        ))}
      </Row>
      <Row label="Máximo de jogadores">
        {STOP_MAX_PLAYERS.map((n) => (
          <button key={n} disabled={!editable || n < room.players.length} onClick={() => set({ maxPlayers: n })} className={`${chip(s.maxPlayers === n)} flex-1`}>
            {n}
          </button>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{label}</p>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

// ---------- rodada ----------

function LetterBadge({ letter, size = 'lg' }: { letter: string; size?: 'lg' | 'sm' }) {
  const big = size === 'lg';
  return (
    <div className={`relative grid shrink-0 place-items-center ${big ? 'h-24 w-24 sm:h-28 sm:w-28' : 'h-12 w-12'}`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" aria-hidden>
        <path d="M21 4h22l17 17v22L43 60H21L4 43V21Z" fill="#ff3d7f" stroke="#ffd0df" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span key={letter} className={`letter-in relative font-display text-white ${big ? 'text-6xl sm:text-7xl' : 'text-2xl'}`}>{letter}</span>
    </div>
  );
}

function StopPlay({ room, meId }: Props) {
  const cats = room.settings.categories;
  const [answers, setAnswers] = useState<Partial<Record<Theme, string>>>(() => (mine.round === room.round ? mine.answers : {}));
  const [error, setError] = useState('');
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const startsIn = useRemaining(room.roundStartsAt);
  const remaining = useRemaining(room.stoppedBy ? null : room.roundEndsAt);
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const locked = startsIn > 0 || !!room.stoppedBy || !playing;
  const letter = room.letter.toLowerCase();
  const allFilled = cats.every((c) => answers[c]?.trim());
  const lastTick = useRef(0);

  useSocketEvent<typeof mine>('stop:mine', (p) => {
    if (p.round === room.round) setAnswers(p.answers ?? {});
  });
  // Quando alguém dá STOP, reenvia tudo para garantir que nada se perca.
  useSocketEvent('stop:collect', () => {
    for (const c of cats) socket.emit('stop:answer', { category: c, text: answersRef.current[c] ?? '' });
  });

  useEffect(() => {
    if (startsIn === 0 && playing) inputs.current[0]?.focus();
  }, [startsIn === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = Math.ceil(remaining / 1000);
    if (!locked && s <= 5 && s > 0 && s !== lastTick.current) sfx.tick(s <= 2);
    lastTick.current = s;
  }, [remaining, locked]);

  function change(c: Theme, text: string) {
    setAnswers((a) => ({ ...a, [c]: text }));
    socket.emit('stop:answer', { category: c, text });
  }

  async function stop() {
    const res = await emitAck<{ ok: boolean; error?: string }>('stop:stop', answersRef.current);
    if (!res.ok) {
      setError(res.error ?? 'Não deu para dar STOP.');
      sfx.wrong();
    }
  }

  const stopper = room.players.find((p) => p.id === room.stoppedBy);
  const total = room.settings.roundTime * 1000;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <section className="relative">
        <div className="glass mb-4 flex items-center gap-4 rounded-3xl p-4 sm:p-5">
          <LetterBadge letter={room.letter} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
              Rodada {room.round} de {room.settings.rounds}
            </p>
            <p className="font-display text-2xl leading-tight sm:text-3xl">Tudo com a letra {room.letter}</p>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-panel-2">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${remaining < 10_000 ? 'bg-danger' : 'bg-pop'}`}
                style={{ width: `${(startsIn > 0 ? 1 : remaining / total) * 100}%` }}
              />
            </div>
          </div>
          <div className={`font-display text-3xl tabular-nums sm:text-4xl ${remaining < 10_000 && !locked ? 'text-danger' : 'text-white'}`}>
            {fmt(startsIn > 0 ? total : remaining)}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {cats.map((c, i) => {
            const v = answers[c] ?? '';
            const bad = v.trim() && normalize(v)[0] !== letter;
            return (
              <label key={c} className={`glass block rounded-2xl p-3 transition ${bad ? 'border-danger/60' : v.trim() ? 'border-ok/40' : ''}`}>
                <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                  <span>{THEMES[c].icon}</span> {THEMES[c].label}
                  {bad && <span className="ml-auto text-[11px] font-normal text-danger">precisa começar com {room.letter}</span>}
                </span>
                <input
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  value={v}
                  disabled={locked}
                  maxLength={40}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => change(c, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      inputs.current[i + 1]?.focus();
                    }
                  }}
                  placeholder={`${room.letter}…`}
                  className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-lg font-semibold outline-none focus:border-pop/70 focus:ring-4 focus:ring-pop/10 disabled:opacity-60"
                />
              </label>
            );
          })}
        </div>

        {playing && (
          <div className="sticky bottom-3 mt-4">
            <button
              onClick={stop}
              disabled={!allFilled || locked}
              className="w-full cursor-pointer rounded-2xl bg-pop py-4 font-display text-3xl text-white shadow-[0_12px_40px_-12px_rgb(255_61_127/0.8)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-35"
            >
              STOP!
            </button>
            <p className="mt-1.5 text-center text-xs text-muted">
              {allFilled ? 'Tudo preenchido! Aperte STOP para encerrar a rodada.' : 'Preencha todas as categorias para poder dar STOP.'}
            </p>
            {error && <p className="slide-in text-center text-sm text-danger">{error}</p>}
          </div>
        )}
        {!playing && <p className="mt-4 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>}

        {startsIn > 0 && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-3xl bg-ink/70 backdrop-blur-sm">
            <div className="text-center">
              <p className="text-sm font-semibold tracking-widest text-muted uppercase">Prepare-se!</p>
              <LetterBadge letter={room.letter} />
              <p key={Math.ceil(startsIn / 1000)} className="pop-in mt-3 font-display text-5xl text-white">{Math.ceil(startsIn / 1000)}</p>
            </div>
          </div>
        )}
        {room.stoppedBy && (
          <div className="pop-in absolute inset-0 z-10 grid place-items-center rounded-3xl bg-ink/75 backdrop-blur-sm">
            <div className="text-center">
              <StopMark className="mx-auto h-28 w-28" />
              <p className="mt-3 font-display text-3xl">{stopper ? `${stopper.name} deu STOP!` : 'Acabou o tempo!'}</p>
              <p className="text-muted">Recolhendo as respostas…</p>
            </div>
          </div>
        )}
      </section>

      <aside className="glass h-fit rounded-2xl p-4">
        <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Progresso</h3>
        <ul className="space-y-2.5">
          {room.players.filter((p) => !p.left).map((p) => (
            <li key={p.id} className="flex items-center gap-2.5">
              <Avatar emoji={p.avatar} id={p.id} size={30} dim={!p.connected} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-sm">
                  <span className="truncate font-semibold">{p.name}</span>
                  <span className="text-xs text-muted tabular-nums">{p.filled}/{cats.length}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${(p.filled / cats.length) * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">Placar: {room.players.map((p) => `${p.name} ${p.score}`).join(' · ')}</p>
      </aside>
    </div>
  );
}

// ---------- correção (os jogadores decidem) ----------

function StopReview({ room, meId }: Props) {
  const cats = room.settings.categories;
  const cat = cats[Math.min(room.reviewIndex, cats.length - 1)];
  const list = room.answers?.[cat] ?? [];
  const remaining = useRemaining(room.reviewEndsAt);
  const me = room.players.find((p) => p.id === meId);
  const canVote = !!me && !me.left;
  const active = room.players.filter((p) => !p.left && p.connected);
  const readyCount = active.filter((p) => p.ready).length;
  const voters = (authorId: string) => active.filter((p) => p.id !== authorId).length;
  const player = (id: string) => room.players.find((p) => p.id === id);
  // Respostas iguais aparecem marcadas como repetidas (valem 5).
  const counts = new Map<string, number>();
  for (const a of list) if (a.status === 'ok') counts.set(normalize(a.text), (counts.get(normalize(a.text)) ?? 0) + 1);

  function toggle(a: StopAnswer) {
    const against = a.against.includes(meId);
    socket.emit('stop:vote', { category: cat, playerId: a.playerId, valid: against ? null : false });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <LetterBadge letter={room.letter} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
            Correção · categoria {room.reviewIndex + 1} de {cats.length}
          </p>
          <p className="font-display text-2xl">
            {THEMES[cat].icon} {THEMES[cat].label} com {room.letter}
          </p>
        </div>
        <span className={`font-display text-3xl tabular-nums ${remaining < 6000 ? 'text-danger' : 'text-muted'}`}>{Math.ceil(remaining / 1000)}</span>
      </div>

      <div className="mb-3 flex gap-1">
        {cats.map((c, i) => (
          <span key={c} className={`h-1.5 flex-1 rounded-full ${i < room.reviewIndex ? 'bg-ok' : i === room.reviewIndex ? 'bg-pop' : 'bg-panel-2'}`} />
        ))}
      </div>

      <div key={cat} className="glass slide-in rounded-3xl p-4 sm:p-5">
        <ul className="space-y-2">
          {list.map((a) => {
            const p = player(a.playerId);
            const mine = a.playerId === meId;
            const votable = canVote && !mine && a.status === 'ok';
            const iVoted = a.against.includes(meId);
            const repeated = a.status === 'ok' && (counts.get(normalize(a.text)) ?? 0) > 1;
            return (
              <li key={a.playerId} className={`flex items-center gap-3 rounded-2xl border-2 bg-panel-2/60 p-3 transition-colors ${a.valid ? 'border-ok/50' : 'border-danger/40 opacity-80'}`}>
                {p && <Avatar emoji={p.avatar} id={p.id} size={38} />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">{p?.name}{mine && ' (você)'}</p>
                  <p className={`truncate text-lg font-bold ${a.valid ? '' : 'text-muted line-through'} ${a.text ? '' : 'italic'}`}>{a.text || 'em branco'}</p>
                  <p className="text-xs">
                    {a.status === 'empty' && <span className="text-muted">não respondeu</span>}
                    {a.status === 'wrong-letter' && <span className="text-danger">não começa com {room.letter}</span>}
                    {a.status === 'ok' && (
                      <span className="text-muted">
                        👎 {a.against.length}/{voters(a.playerId)} {repeated && <span className="text-spark">· repetida</span>}
                      </span>
                    )}
                  </p>
                </div>
                {votable && (
                  <button
                    onClick={() => toggle(a)}
                    className={`chip px-3 py-2 text-xl ${iVoted ? 'border-danger/70 bg-danger/20' : ''}`}
                    aria-label={iVoted ? 'Retirar voto' : 'Não vale'}
                    title={iVoted ? 'Retirar voto' : 'Não vale'}
                  >
                    👎
                  </button>
                )}
                <span className={`w-20 text-right text-xs font-bold ${a.valid ? 'text-ok' : 'text-danger'}`}>{a.valid ? 'VALE' : 'NÃO VALE'}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Toda resposta começa valendo. Dê 👎 nas que não valem — se a maioria votar contra, ela é anulada.
        </p>
      </div>

      {canVote && (
        <button onClick={() => socket.emit('stop:ready')} className={`sticky bottom-3 mt-4 w-full ${me?.ready ? 'btn-secondary' : 'btn-primary'}`}>
          {me?.ready ? `Confirmado ✓ — esperando os outros (${readyCount}/${active.length})` : `Confirmar (${readyCount}/${active.length})`}
        </button>
      )}
    </div>
  );
}

// ---------- placar ----------

function StopScores({ room, isHost }: Props) {
  const cats = room.settings.categories;
  const remaining = useRemaining(room.phase === 'scores' ? room.reviewEndsAt : null);
  const rows = [...room.players].sort((a, b) => b.score - a.score);
  const ended = room.phase === 'ended';
  const answerOf = (c: Theme, id: string) => room.answers?.[c]?.find((a) => a.playerId === id);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LetterBadge letter={room.letter} size="sm" />
        <div className="flex-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
            {ended ? 'Resultado final' : `Placar · rodada ${room.round} de ${room.settings.rounds}`}
          </p>
          <p className="font-display text-2xl">{ended ? 'Fim de jogo!' : 'Pontos da rodada'}</p>
        </div>
        {!ended &&
          (isHost ? (
            <button onClick={() => socket.emit('stop:next')} className="btn-primary px-5">
              {room.round >= room.settings.rounds ? 'Ver resultado' : 'Próxima rodada'} ({Math.ceil(remaining / 1000)}s)
            </button>
          ) : (
            <span className="text-sm text-muted">Continua em {Math.ceil(remaining / 1000)}s…</span>
          ))}
      </div>

      <div className="glass overflow-x-auto rounded-3xl">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted uppercase">
              <th className="p-3">Jogador</th>
              <th className="p-3 text-right">Total</th>
              {room.roundPoints && <th className="p-3 text-right">Rodada</th>}
              {room.answers && cats.map((c) => <th key={c} className="p-3 font-semibold" title={THEMES[c].label}>{THEMES[c].icon} {THEMES[c].short}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id} className="border-b border-line/50 last:border-0">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-muted">{i + 1}º</span>
                    <Avatar emoji={p.avatar} id={p.id} size={28} dim={p.left} />
                    <span className="font-semibold">{p.name}</span>
                  </div>
                </td>
                <td className="p-3 text-right font-display text-xl">{p.score}</td>
                {room.roundPoints && <td className="p-3 text-right font-bold text-ok">+{room.roundPoints[p.id] ?? 0}</td>}
                {room.answers &&
                  cats.map((c) => {
                    const a = answerOf(c, p.id);
                    return (
                      <td key={c} className="p-3 align-top">
                        <span className={`block max-w-[140px] truncate ${a?.valid ? '' : 'text-muted line-through'}`}>{a?.text || '—'}</span>
                        {a?.points !== undefined && (
                          <span className={`text-xs font-bold ${a.points === 10 ? 'text-ok' : a.points === 5 ? 'text-spark' : 'text-muted'}`}>+{a.points}</span>
                        )}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Resposta única = 10 · repetida = 5 · inválida ou em branco = 0</p>
    </div>
  );
}
