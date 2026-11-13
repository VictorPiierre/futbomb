import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LIE_FOOL_POINTS, LIE_MAX_LEN, LIE_MAX_PLAYERS, LIE_PICK_MS, LIE_REVEAL_STEP_MS, LIE_ROUNDS, LIE_TRUTH_POINTS, LIE_WRITE_TIMES,
  type LiePublicRoom, type LieSettings,
} from '../../../shared/lie';
import { emitAck, inviteLink, serverNow, socket, useSocketEvent } from '../net';
import { sfx } from '../sound';
import Avatar from './Avatar';
import { IconCopy, IconCrown, IconLink, IconSend, LieMark } from './Icons';

interface Props {
  room: LiePublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

type Mine = { round: number; lie: string | null; pick: string | null; own: string | null };
let mine: Mine = { round: 0, lie: null, pick: null, own: null };
socket.on('lie:mine', (p: Mine) => (mine = p));

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

/** Pergunta com a lacuna destacada. */
function Question({ room }: { room: LiePublicRoom }) {
  const parts = (room.question ?? '').split('____');
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-[0.2em] text-muted uppercase">
        Rodada {room.round}/{room.settings.rounds}
      </p>
      <h2 className="font-display text-2xl leading-snug sm:text-3xl">
        {parts.map((p, i) => (
          <span key={i}>
            {p}
            {i < parts.length - 1 && <span className="mx-1 inline-block min-w-[3.5em] border-b-4 border-grape align-baseline text-grape">&nbsp;?&nbsp;</span>}
          </span>
        ))}
      </h2>
    </div>
  );
}

function Timer({ room, total }: { room: LiePublicRoom; total: number }) {
  const remaining = useRemaining(room.endsAt);
  const last = useRef(0);
  useEffect(() => {
    const s = Math.ceil(remaining / 1000);
    if (s <= 5 && s > 0 && s !== last.current) sfx.tick(s <= 2);
    last.current = s;
  }, [remaining]);
  return (
    <>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full rounded-full transition-[width] duration-200 ${remaining < 5000 ? 'bg-danger' : 'bg-grape'}`} style={{ width: `${(remaining / total) * 100}%` }} />
      </div>
      <p className="mt-1 text-right font-display text-lg tabular-nums text-muted">{Math.ceil(remaining / 1000)}s</p>
    </>
  );
}

export default function LieGame(props: Props) {
  const { room } = props;
  if (room.phase === 'lobby') return <LieLobby {...props} />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {room.phase === 'write' ? <Write key={room.round} {...props} /> : room.phase === 'pick' ? <Pick key={room.round} {...props} /> : <Reveal key={room.round} {...props} />}
      <Scoreboard room={room} meId={props.meId} />
    </div>
  );
}

// ---------- escrever a mentira ----------

function Write({ room, meId }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(() => (mine.round === room.round ? mine.lie : null));
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useSocketEvent<Mine>('lie:mine', (p) => {
    if (p.round === room.round) setSent(p.lie);
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await emitAck<{ ok: boolean; error?: string; truth?: boolean }>('lie:write', text);
    if (res.ok) {
      setSent(text.trim());
      setText('');
      setError('');
      sfx.myTurn();
    } else {
      setError(res.error ?? 'Não deu para enviar.');
      if (res.truth) sfx.correct();
      else sfx.wrong();
    }
  }

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <Question room={room} />
      <Timer room={room} total={room.settings.writeTime * 1000} />
      {playing ? (
        <form onSubmit={submit} className="mt-2">
          <p className="mb-2 text-sm text-muted">
            🤥 Invente uma resposta <b className="text-white">falsa</b> que pareça verdadeira. Quanto mais gente cair, mais pontos!
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={text}
              maxLength={LIE_MAX_LEN}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              placeholder="Escreva uma resposta falsa e convincente"
              className="min-w-0 flex-1 rounded-2xl border-2 border-grape/50 bg-panel-2 px-4 py-3.5 text-lg font-semibold outline-none placeholder:font-sans placeholder:text-base placeholder:text-muted focus:border-grape focus:ring-4 focus:ring-grape/15"
            />
            <button disabled={!text.trim()} className="btn-primary flex items-center gap-2 rounded-2xl px-5">
              <IconSend width={18} /> <span className="hidden sm:inline">{sent === null ? 'Enviar' : 'Trocar'}</span>
            </button>
          </div>
          {error && <p className="slide-in mt-2 text-sm text-danger">{error}</p>}
          {sent !== null && (
            <div className="pop-in mt-3 rounded-2xl border border-grape/40 bg-grape/10 px-4 py-3 text-center">
              Sua mentira: <b className="text-lg text-grape">{sent}</b>
              <p className="text-xs text-muted">Dá para trocar até o tempo acabar.</p>
            </div>
          )}
        </form>
      ) : (
        <p className="mt-4 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>
      )}
    </section>
  );
}

// ---------- achar a verdade ----------

function Pick({ room, meId }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const [own, setOwn] = useState<string | null>(() => (mine.round === room.round ? mine.own : null));
  const [picked, setPicked] = useState<string | null>(() => (mine.round === room.round ? mine.pick : null));
  const [error, setError] = useState('');
  useSocketEvent<Mine>('lie:mine', (p) => {
    if (p.round !== room.round) return;
    setOwn(p.own);
    if (p.pick) setPicked(p.pick);
  });
  // O aviso pode chegar entre a troca de tela e a inscrição acima: relê ao montar.
  useEffect(() => {
    if (mine.round === room.round) setOwn(mine.own);
  }, [room.round]);

  async function choose(id: string) {
    const res = await emitAck<{ ok: boolean; error?: string }>('lie:pick', id);
    if (res.ok) {
      setPicked(id);
      setError('');
      sfx.myTurn();
    } else setError(res.error ?? 'Não deu.');
  }

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <Question room={room} />
      <Timer room={room} total={LIE_PICK_MS} />
      <p className="mb-3 text-sm text-muted">🔍 Qual dessas é a <b className="text-ok">verdade</b>?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(room.options ?? []).map((o, i) => {
          const isOwn = o.id === own;
          const on = picked === o.id;
          return (
            <button
              key={o.id}
              disabled={!playing || isOwn}
              onClick={() => choose(o.id)}
              className={`pop-in cursor-pointer rounded-2xl border-2 px-4 py-3.5 text-left text-base leading-snug font-semibold transition disabled:cursor-not-allowed ${
                on ? 'border-ok bg-ok/15' : isOwn ? 'border-dashed border-line bg-panel-2/50 opacity-60' : 'border-line bg-panel-2 hover:border-grape/60'
              }`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              {o.text}
              {isOwn && <span className="mt-0.5 block font-sans text-[11px] text-muted">sua mentira</span>}
              {on && <span className="mt-0.5 block font-sans text-[11px] text-ok">sua escolha (dá para trocar)</span>}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {!playing && <p className="mt-4 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>}
    </section>
  );
}

// ---------- revelação ----------

function Reveal({ room, meId, isHost }: Props) {
  const reveal = room.reveal ?? [];
  const [shown, setShown] = useState(room.phase === 'ended' ? reveal.length : 0);
  const remaining = useRemaining(room.phase === 'reveal' ? room.endsAt : null);
  const player = (id: string) => room.players.find((p) => p.id === id);

  useEffect(() => {
    if (shown >= reveal.length) return;
    const t = setTimeout(() => {
      const r = reveal[shown];
      if (r.truth) {
        if (r.pickedBy.includes(meId)) sfx.win();
        else sfx.correct();
      } else if (r.pickedBy.includes(meId)) sfx.explode();
      else if (r.pickedBy.length) sfx.pass();
      setShown((n) => n + 1);
    }, shown === 0 ? 600 : LIE_REVEAL_STEP_MS);
    return () => clearTimeout(t);
  }, [shown, reveal, meId]);

  const done = shown >= reveal.length;
  const gained = room.gained ?? {};

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <Question room={room} />
      <ul className="mt-5 space-y-2.5">
        {reveal.slice(0, shown).map((r) => (
          <li
            key={r.id}
            className={`pop-in rounded-2xl border-2 p-3.5 ${r.truth ? 'border-ok bg-ok/15' : 'border-grape/40 bg-grape/10'}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="w-full min-w-0 text-lg leading-snug font-semibold sm:w-auto sm:flex-1">{r.text}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${r.truth ? 'bg-ok text-ink' : 'bg-grape text-ink'}`}>
                {r.truth ? '✅ VERDADE' : r.authors.length ? `🤥 MENTIRA de ${r.authors.map((a) => player(a)?.name ?? '?').join(' e ')}` : '🏠 mentira da casa'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {r.pickedBy.length === 0 ? (
                <span>ninguém escolheu</span>
              ) : (
                <>
                  <span>{r.truth ? 'acertaram:' : 'caíram:'}</span>
                  {r.pickedBy.map((id) => {
                    const p = player(id);
                    return (
                      <span key={id} className="flex items-center gap-1 rounded-full bg-ink/40 py-0.5 pr-2 pl-0.5">
                        {p && <Avatar emoji={p.avatar} id={p.id} size={20} />} {p?.name}
                      </span>
                    );
                  })}
                  {!r.truth && r.authors.length > 0 && (
                    <span className="ml-auto font-semibold text-grape">+{r.pickedBy.length * LIE_FOOL_POINTS} para quem mentiu</span>
                  )}
                  {r.truth && <span className="ml-auto font-semibold text-ok">+{LIE_TRUTH_POINTS} cada</span>}
                </>
              )}
            </div>
          </li>
        ))}
        {!done && (
          <li className="rounded-2xl border-2 border-dashed border-line p-4 text-center font-display text-xl text-muted">
            <span className="inline-block animate-bounce">🥁</span> …
          </li>
        )}
      </ul>

      {done && (
        <div className="pop-in mt-4 flex flex-wrap gap-2">
          {room.players
            .filter((p) => !p.left)
            .sort((a, b) => (gained[b.id] ?? 0) - (gained[a.id] ?? 0))
            .map((p) => (
              <span key={p.id} className={`flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-sm ${(gained[p.id] ?? 0) > 0 ? 'border-ok/40 bg-ok/10' : 'border-line'}`}>
                <Avatar emoji={p.avatar} id={p.id} size={22} /> {p.name} <b className={(gained[p.id] ?? 0) > 0 ? 'text-ok' : 'text-muted'}>+{gained[p.id] ?? 0}</b>
              </span>
            ))}
        </div>
      )}

      {room.phase === 'reveal' && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-muted">
            {room.round >= room.settings.rounds ? 'Resultado final' : 'Próxima pergunta'} em {Math.ceil(remaining / 1000)}s…
          </span>
          {isHost && done && (
            <button onClick={() => socket.emit('lie:next')} className="btn-primary px-5">
              {room.round >= room.settings.rounds ? 'Ver campeão →' : 'Próxima →'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- placar ----------

function Scoreboard({ room, meId }: { room: LiePublicRoom; meId: string }) {
  const rows = [...room.players].sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...rows.map((p) => p.score));
  const waiting = room.phase === 'write' || room.phase === 'pick';
  return (
    <aside className="glass h-fit rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">Placar</h3>
        <span className="text-xs text-muted">
          rodada {room.round}/{room.settings.rounds}
        </span>
      </div>
      <ul className="space-y-2.5">
        {rows.map((p) => (
          <li key={p.id} className={p.left ? 'opacity-50' : ''}>
            <div className="flex items-center gap-2.5">
              <Avatar emoji={p.avatar} id={p.id} size={30} dim={!p.connected} />
              <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${p.id === meId ? 'text-grape' : ''}`}>{p.name}</span>
              {waiting && <span className="text-xs">{p.done ? '✅' : room.phase === 'write' ? '✍️' : '🤔'}</span>}
              <span className="font-display text-lg tabular-nums">{p.score}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-grape transition-[width] duration-500" style={{ width: `${(p.score / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
        <LieMark className="h-4 w-4" /> achou a verdade +{LIE_TRUTH_POINTS} · cada um que caiu na sua mentira +{LIE_FOOL_POINTS}
      </p>
    </aside>
  );
}

// ---------- sala de espera ----------

function LieLobby({ room, meId, isHost, onCopy }: Props) {
  const [error, setError] = useState('');
  const ready = room.players.filter((p) => p.connected).length;
  const amSpectator = room.spectators.some((s) => s.id === meId);
  const seatFree = room.players.length < room.settings.maxPlayers;

  async function start() {
    const res = await emitAck<{ ok: boolean; error?: string }>('game:start');
    setError(res.ok ? '' : (res.error ?? 'Erro ao iniciar.'));
  }

  return (
    <div className="pop-in grid gap-5 lg:grid-cols-[1fr_400px]">
      <section className="glass rounded-3xl p-5 sm:p-7">
        <p className="text-xs font-semibold tracking-wider text-muted uppercase">Sala de espera</p>
        <h1 className="font-display text-2xl sm:text-3xl">
          {room.players.length}/{room.settings.maxPlayers} jogadores
        </h1>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {room.players.map((p) => (
            <div key={p.id} className={`pop-in flex items-center gap-2.5 rounded-2xl border p-2.5 ${p.id === meId ? 'border-grape/50 bg-grape/5' : 'border-line bg-panel/60'}`}>
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
        </div>
        {room.spectators.length > 0 && <p className="mt-4 text-xs text-muted">👀 Assistindo: {room.spectators.map((s) => s.name).join(', ')}</p>}
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
          Aparece uma pergunta de curiosidade — tipo “Por que bocejamos?”. Cada um inventa uma resposta <b className="text-grape">falsa</b> que
          pareça verdadeira. Depois todas aparecem misturadas com a resposta certa e cada um tenta achar a <b className="text-ok">verdade</b>.
          Achou: <b className="text-white">+{LIE_TRUTH_POINTS}</b>. Cada pessoa que cair na sua mentira: <b className="text-white">+{LIE_FOOL_POINTS}</b>. Melhor com 3 ou mais jogadores!
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <LieSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2} className="btn-primary w-full py-4 text-xl">
                Começar o Mentirômetro
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

export function LieSettingsPanel({ room, editable }: { room: LiePublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<LieSettings>) => editable && socket.emit('room:settings', patch);
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;
  return (
    <div className="space-y-5">
      <Row label="Rodadas">
        {LIE_ROUNDS.map((n) => (
          <button key={n} disabled={!editable} onClick={() => set({ rounds: n })} className={`${chip(s.rounds === n)} flex-1`}>
            {n}
          </button>
        ))}
      </Row>
      <Row label="Tempo para inventar a mentira">
        {LIE_WRITE_TIMES.map((t) => (
          <button key={t} disabled={!editable} onClick={() => set({ writeTime: t })} className={`${chip(s.writeTime === t)} flex-1`}>
            {t}s
          </button>
        ))}
      </Row>
      <Row label="Máximo de jogadores">
        {LIE_MAX_PLAYERS.map((n) => (
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
