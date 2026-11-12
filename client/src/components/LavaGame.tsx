import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LAVA_DIFFICULTIES, LAVA_MAX_PLAYERS, LAVA_START_HEIGHT, LAVA_TIMES,
  type LavaDifficulty, type LavaPlayer, type LavaPublicRoom, type LavaSettings,
} from '../../../shared/lava';
import { emitAck, inviteLink, serverNow, socket, useSocketEvent } from '../net';
import { sfx } from '../sound';
import Avatar from './Avatar';
import { IconCopy, IconCrown, IconLink, IconSend, LavaMark } from './Icons';

interface Props {
  room: LavaPublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

let mine: { round: number; answer: number | null } = { round: 0, answer: null };
socket.on('lava:mine', (p: typeof mine) => (mine = p));

function useNow(active: boolean) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(serverNow()), 50);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(2).replace('.', ',')}s`;

export default function LavaGame(props: Props) {
  const { room, meId } = props;
  const prev = useRef(room.phase);
  useEffect(() => {
    if (room.phase === 'rise' && prev.current !== 'rise' && room.swallowed.includes(meId)) setTimeout(() => sfx.explode(), 1300);
    prev.current = room.phase;
  }, [room.phase, room.swallowed, meId]);

  if (room.phase === 'lobby') return <LavaLobby {...props} />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Towers room={room} meId={meId} />
      <section className="glass h-fit rounded-3xl p-5">
        {room.phase === 'countdown' && <Countdown room={room} />}
        {room.phase === 'question' && <Question key={room.round} room={room} meId={meId} />}
        {room.phase === 'ranking' && <Ranking room={room} meId={meId} />}
        {(room.phase === 'rise' || room.phase === 'ended') && <RiseInfo room={room} />}
      </section>
    </div>
  );
}

// ---------- torres ----------

const AREA = 300;

function Towers({ room, meId }: { room: LavaPublicRoom; meId: string }) {
  const players = room.players;
  const maxH = Math.max(LAVA_START_HEIGHT, ...players.map((p) => p.height));
  const lo = Math.max(0, Math.min(room.lava - 2, maxH - 10));
  const hi = Math.max(lo + 12, maxH + 3, room.lava + 4);
  const unit = AREA / (hi - lo);
  const y = (v: number) => Math.max(0, (v - lo) * unit);
  const rising = room.phase === 'rise';
  const climbs = new Map((room.results ?? []).map((r) => [r.playerId, r.climb]));

  return (
    <section className="glass relative overflow-hidden rounded-3xl p-4 pb-3">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-muted uppercase">
        <span>Rodada {room.round}</span>
        <span className="text-lava">
          🌋 lava no bloco {room.lava}
          {room.phase !== 'rise' && room.phase !== 'ended' && <> · vai subir +{room.rise}</>}
        </span>
      </div>
      <div className="relative" style={{ height: AREA + 34 }}>
        {/* lava */}
        <div
          className="lava-surface absolute inset-x-0 bottom-0 z-20"
          style={{
            height: Math.max(6, y(room.lava)),
            transition: 'height 1.3s cubic-bezier(.5,0,.3,1)',
            transitionDelay: rising ? '1.1s' : '0s',
          }}
        />
        <div className="absolute inset-0 flex items-end justify-around gap-1">
          {players.map((p) => (
            <Tower key={p.id} p={p} me={p.id === meId} height={y(p.height)} unit={unit} climb={rising ? (climbs.get(p.id) ?? 0) : 0} swallowed={room.swallowed.includes(p.id)} />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-around gap-1">
        {players.map((p) => (
          <div key={p.id} className={`min-w-0 flex-1 text-center ${p.alive ? '' : 'opacity-50'}`}>
            <p className={`truncate text-xs font-semibold ${p.id === meId ? 'text-lava' : ''}`}>{p.name}</p>
            <p className="text-[11px] text-muted">{p.alive ? `🧱 ${p.height}` : '👻 espectador'}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Tower({ p, me, height, unit, climb, swallowed }: { p: LavaPlayer; me: boolean; height: number; unit: number; climb: number; swallowed: boolean }) {
  const brick = Math.max(4, unit);
  return (
    <div className="relative flex h-full max-w-[90px] flex-1 flex-col items-center justify-end">
      {climb > 0 && (
        <span className="float-up absolute z-30 font-display text-lg text-ok" style={{ bottom: height + 44 }}>
          +{climb}
        </span>
      )}
      <div className={`z-10 mb-1 transition-[transform,opacity] duration-700 ${p.alive ? '' : 'opacity-60 grayscale'} ${swallowed ? 'sink' : ''}`}>
        <div className={me ? 'rounded-full ring-2 ring-lava' : ''}>
          <Avatar emoji={p.alive ? p.avatar : '👻'} id={p.id} size={34} dim={!p.connected} />
        </div>
      </div>
      <div
        className="w-[70%] rounded-t-md border-x-2 border-t-2 border-ink/60"
        style={{
          height,
          transition: 'height 0.9s cubic-bezier(.3,1.4,.5,1)',
          background: `repeating-linear-gradient(to top, ${me ? '#ffb199' : '#c4b5d6'} 0 ${brick - 2}px, #120d1b ${brick - 2}px ${brick}px)`,
        }}
      />
    </div>
  );
}

// ---------- fases ----------

function Countdown({ room }: { room: LavaPublicRoom }) {
  const now = useNow(true);
  const left = Math.max(0, (room.askAt ?? 0) - now);
  const n = Math.ceil(left / 1000);
  const last = useRef(0);
  useEffect(() => {
    if (n > 0 && n !== last.current) sfx.tick(n === 1);
    last.current = n;
  }, [n]);
  return (
    <div className="py-4 text-center">
      <p className="font-display text-2xl text-muted">Pergunta em…</p>
      <p key={n} className="pop-in font-display text-[110px] leading-none text-lava">{n || '!'}</p>
      <p className="mt-3 text-sm text-muted">
        🌋 A lava vai subir <b className="text-lava">+{room.rise}</b> · o mais rápido sobe <b className="text-ok">+{room.topClimb}</b>
      </p>
    </div>
  );
}

function Question({ room, meId }: { room: LavaPublicRoom; meId: string }) {
  const me = room.players.find((p) => p.id === meId);
  const now = useNow(true);
  const total = room.settings.answerTime * 1000;
  const left = Math.max(0, (room.endsAt ?? 0) - now);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<{ answer: string; correct?: boolean; timeMs?: number } | null>(() =>
    mine.round === room.round && mine.answer !== null ? { answer: String(mine.answer) } : null,
  );
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useSocketEvent<typeof mine>('lava:mine', (p) => {
    if (p.round === room.round && p.answer !== null) setSent({ answer: String(p.answer) });
  });
  useEffect(() => inputRef.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || sent) return;
    const res = await emitAck<{ ok: boolean; correct?: boolean; timeMs?: number; error?: string }>('lava:answer', text);
    if (res.ok) {
      setSent({ answer: text.trim(), correct: res.correct, timeMs: res.timeMs });
      if (res.correct) sfx.correct();
      else sfx.wrong();
    } else {
      setError(res.error ?? 'Não deu para enviar.');
      sfx.wrong();
    }
  }

  return (
    <div>
      <p className="text-center text-xs font-semibold tracking-[0.2em] text-muted uppercase">Quanto é</p>
      <p className="pop-in my-2 text-center font-display text-5xl sm:text-6xl">{room.question} = ?</p>
      <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full rounded-full ${left < 3000 ? 'bg-danger' : 'bg-lava'}`} style={{ width: `${(left / total) * 100}%` }} />
      </div>
      <p className="mt-1 text-right font-display text-lg tabular-nums text-muted">{Math.ceil(left / 1000)}s</p>
      {!me ? (
        <p className="rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>
      ) : sent ? (
        <div className={`pop-in rounded-2xl border px-4 py-4 text-center ${sent.correct === false ? 'border-danger/50 bg-danger/10' : 'border-ok/40 bg-ok/10'}`}>
          <p className="font-display text-3xl">
            {sent.answer} {sent.correct === true ? '✅' : sent.correct === false ? '❌' : ''}
          </p>
          {sent.timeMs !== undefined && <p className="text-sm text-muted">respondeu em {secs(sent.timeMs)}</p>}
          <p className="mt-1 text-xs text-muted">Esperando os outros…</p>
        </div>
      ) : (
        <form onSubmit={submit}>
          {!me.alive && <p className="mb-2 text-center text-xs text-muted">👻 A lava te pegou, mas você ainda pode responder por diversão.</p>}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={text}
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              onChange={(e) => setText(e.target.value)}
              placeholder="Resposta"
              className="min-w-0 flex-1 rounded-2xl border-2 border-lava/50 bg-panel-2 px-4 py-4 text-center font-display text-3xl outline-none placeholder:font-sans placeholder:text-base placeholder:text-muted focus:border-lava focus:ring-4 focus:ring-lava/15"
            />
            <button disabled={!text.trim()} className="btn-primary flex items-center gap-2 rounded-2xl px-5">
              <IconSend width={18} />
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-muted">Só vale a primeira resposta — capricha na velocidade!</p>
          {error && <p className="mt-1 text-center text-sm text-danger">{error}</p>}
        </form>
      )}
    </div>
  );
}

function Ranking({ room, meId }: { room: LavaPublicRoom; meId: string }) {
  const player = (id: string) => room.players.find((p) => p.id === id);
  return (
    <div>
      <p className="text-center text-sm text-muted">
        {room.question} = <b className="font-display text-2xl text-ok">{room.answer}</b>
      </p>
      <ol className="mt-3 space-y-1.5">
        {(room.results ?? []).map((r, i) => {
          const p = player(r.playerId);
          return (
            <li
              key={r.playerId}
              className={`slide-in flex items-center gap-2 rounded-xl border px-2.5 py-2 ${r.playerId === meId ? 'border-lava/60' : 'border-line'} ${r.correct ? 'bg-ok/5' : 'bg-danger/10'} ${r.ghost ? 'opacity-60' : ''}`}
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="w-7 text-center font-display text-lg">{r.correct ? (r.place ? `${r.place}º` : '✓') : '✗'}</span>
              {p && <Avatar emoji={p.avatar} id={p.id} size={26} />}
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold">
                  {p?.name ?? '?'} {r.ghost && <span className="text-[10px] font-normal text-muted">👻 espectador</span>}
                </p>
                <p className="text-[11px] text-muted">
                  {r.answer === null ? 'não respondeu' : <>respondeu <b className={r.correct ? 'text-ok' : 'text-danger'}>{r.answer}</b></>}
                </p>
              </div>
              <span className="text-right text-xs tabular-nums text-muted">{r.timeMs !== null ? secs(r.timeMs) : '—'}</span>
              <span className={`w-8 text-right font-display ${r.climb ? 'text-ok' : 'text-muted'}`}>{r.ghost ? '' : r.climb ? `+${r.climb}` : '0'}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RiseInfo({ room }: { room: LavaPublicRoom }) {
  const gone = room.swallowed.map((id) => room.players.find((p) => p.id === id)?.name).filter(Boolean);
  return (
    <div className="py-6 text-center">
      <LavaMark className="mx-auto h-16 w-16" />
      <p className="mt-2 font-display text-3xl text-lava">A lava subiu +{room.rise}!</p>
      {gone.length > 0 ? (
        <p className="pop-in mt-2 text-lg">🔥 {gone.join(', ')} {gone.length > 1 ? 'foram engolidos' : 'foi engolido'}!</p>
      ) : (
        <p className="mt-2 text-sm text-muted">Ninguém caiu… por enquanto.</p>
      )}
      <p className="mt-3 text-xs text-muted">
        Vivos: {room.players.filter((p) => p.alive).length} de {room.players.length}
      </p>
    </div>
  );
}

// ---------- sala de espera ----------

function LavaLobby({ room, meId, isHost, onCopy }: Props) {
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
            <div key={p.id} className={`pop-in flex items-center gap-2.5 rounded-2xl border p-2.5 ${p.id === meId ? 'border-lava/50 bg-lava/5' : 'border-line bg-panel/60'}`}>
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
          O chão é lava! Cada um tem uma torre de {LAVA_START_HEIGHT} blocos. A cada rodada aparece uma conta depois do “3… 2… 1…” — responda rápido:
          quem acerta primeiro sobe <b className="text-ok">mais blocos</b>, o segundo um a menos, e assim por diante. Errou? Não sobe nada.
          Depois a <b className="text-lava">lava sobe</b> — e ela sobe cada vez mais. Quem for engolido vira espectador (mas pode continuar respondendo por diversão).
          <b className="text-white"> Ganha quem sobrar!</b>
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <LavaSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2} className="btn-primary w-full py-4 text-xl">
                Começar a Torre de Lava
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

export function LavaSettingsPanel({ room, editable }: { room: LavaPublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<LavaSettings>) => editable && socket.emit('room:settings', patch);
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;
  return (
    <div className="space-y-5">
      <Row label="Dificuldade das contas">
        {(Object.keys(LAVA_DIFFICULTIES) as LavaDifficulty[]).map((d) => (
          <button key={d} disabled={!editable} onClick={() => set({ difficulty: d })} className={`${chip(s.difficulty === d)} flex-1`} title={LAVA_DIFFICULTIES[d].hint}>
            {LAVA_DIFFICULTIES[d].label}
          </button>
        ))}
      </Row>
      <p className="-mt-3 text-[11px] text-muted">{LAVA_DIFFICULTIES[s.difficulty].hint}</p>
      <Row label="Tempo para responder">
        {LAVA_TIMES.map((t) => (
          <button key={t} disabled={!editable} onClick={() => set({ answerTime: t })} className={`${chip(s.answerTime === t)} flex-1`}>
            {t}s
          </button>
        ))}
      </Row>
      <Row label="Máximo de jogadores">
        {LAVA_MAX_PLAYERS.map((n) => (
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
