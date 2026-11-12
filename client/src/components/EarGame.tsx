import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  EAR_BEST_BONUS, EAR_DIFFICULTIES, EAR_EXACT_POINTS, EAR_LANG_IDS, EAR_LANGS, EAR_MAX_PLAYERS, EAR_NEAR_MAX, EAR_ROUNDS, EAR_SPEAK_MS, EAR_TIMES,
  diffLetters, earNorm,
  type EarDifficulty, type EarLang, type EarPublicRoom, type EarSay, type EarSettings,
} from '../../../shared/ear';
import { emitAck, inviteLink, serverNow, socket, useSocketEvent } from '../net';
import { audioCtx, sfx } from '../sound';
import Avatar from './Avatar';
import { EarMark, IconCopy, IconCrown, IconLink, IconSend } from './Icons';

interface Props {
  room: EarPublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

// ---------- áudio ----------

/** Última palavra recebida (fica fora do React para sobreviver a remontagens). */
let pending: EarSay | null = null;
/** Rodadas já tocadas: a palavra só é dita uma vez. */
const played = new Set<string>();
let mine: { round: number; answer: string | null } = { round: 0, answer: null };
socket.on('ear:say', (p: EarSay) => {
  pending = p;
  void load(p.audio); // baixa durante a contagem para tocar na hora certa
});
socket.on('ear:mine', (p: typeof mine) => (mine = p));

const buffers = new Map<string, Promise<AudioBuffer | null>>();
function load(id: string) {
  let b = buffers.get(id);
  if (!b) {
    b = fetch(`/ear/${id}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => audioCtx()!.decodeAudioData(data))
      .catch(() => {
        buffers.delete(id);
        return null;
      });
    buffers.set(id, b);
  }
  return b;
}

let playing: AudioBufferSourceNode | null = null;
/** Toca o áudio (opcionalmente agendado para um horário do servidor). */
async function play(id: string, at?: number) {
  const ctx = audioCtx();
  const buf = await load(id);
  if (!ctx || !buf) return false;
  try {
    playing?.stop();
  } catch {
    /* já tinha parado */
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(ctx.currentTime + (at ? Math.max(0, (at - serverNow()) / 1000) : 0));
  playing = src;
  return true;
}

/** O navegador só libera o som depois de um toque na página. */
function useAudioBlocked() {
  const [blocked, setBlocked] = useState(() => audioCtx()?.state !== 'running');
  useEffect(() => {
    const id = window.setInterval(() => setBlocked(audioCtx()?.state !== 'running'), 500);
    return () => clearInterval(id);
  }, []);
  return blocked;
}

function SoundGate() {
  const blocked = useAudioBlocked();
  if (!blocked) return null;
  return (
    <button onClick={() => void audioCtx()?.resume()} className="pop-in mt-4 w-full cursor-pointer rounded-2xl border-2 border-spark bg-spark/15 py-3 font-semibold text-spark">
      🔇 Toque aqui para ativar o som
    </button>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export default function EarGame(props: Props) {
  const { room } = props;
  const prev = useRef(room.phase);
  useEffect(() => {
    if (room.phase === 'reveal' && prev.current === 'question') {
      const me = room.results?.find((r) => r.playerId === props.meId);
      if (me?.exact) sfx.win();
      else if (me && me.points > 0) sfx.correct();
      else sfx.pass();
    }
    prev.current = room.phase;
  }, [room.phase, room.results, props.meId]);

  if (room.phase === 'lobby') return <EarLobby {...props} />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {room.phase === 'question' ? <EarQuestion key={room.round} {...props} /> : <EarReveal {...props} />}
      <EarScoreboard room={room} meId={props.meId} />
    </div>
  );
}

// ---------- sala de espera ----------

function VoiceCheck() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void play('teste')} className="btn-secondary px-4 text-sm">
        🔊 Testar o som
      </button>
      <span className="text-xs text-muted">Se não ouvir nada, aumente o volume e tire o celular do silencioso.</span>
    </div>
  );
}

function EarLobby({ room, meId, isHost, onCopy }: Props) {
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
            <div key={p.id} className={`pop-in flex items-center gap-2.5 rounded-2xl border p-2.5 ${p.id === meId ? 'border-ok/50 bg-ok/5' : 'border-line bg-panel/60'}`}>
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
          Uma voz fala uma palavra em outro idioma — <b className="text-white">uma vez só</b>, depois do “Palavra em 3… 2… 1…”. Escreva o que você ouviu.
          Escrita perfeita vale <b className="text-ok">{EAR_EXACT_POINTS}</b>; chegou perto vale até <b className="text-white">{EAR_NEAR_MAX}</b>, e quem chegar mais
          perto na rodada ganha <b className="text-spark">+{EAR_BEST_BONUS}</b>. Acentos não contam. Aumente o volume! 🔊
        </div>
        <VoiceCheck />
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <EarSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2} className="btn-primary w-full py-4 text-xl">
                Começar o Ouvidão
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

export function EarSettingsPanel({ room, editable }: { room: EarPublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<EarSettings>) => editable && socket.emit('room:settings', patch);
  const toggle = (l: EarLang) => {
    const has = s.langs.includes(l);
    if (has && s.langs.length <= 1) return;
    set({ langs: has ? s.langs.filter((x) => x !== l) : [...s.langs, l] });
  };
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Idiomas</p>
        <div className="flex flex-wrap gap-1.5">
          {EAR_LANG_IDS.map((l) => (
            <button key={l} disabled={!editable} onClick={() => toggle(l)} className={`${chip(s.langs.includes(l))} px-2.5 py-1.5 text-xs`}>
              {EAR_LANGS[l].flag} {EAR_LANGS[l].label}
            </button>
          ))}
        </div>
      </div>
      <Row label="Dificuldade">
        {(Object.keys(EAR_DIFFICULTIES) as EarDifficulty[]).map((d) => (
          <button key={d} disabled={!editable} onClick={() => set({ difficulty: d })} className={`${chip(s.difficulty === d)} flex-1`} title={EAR_DIFFICULTIES[d].hint}>
            {EAR_DIFFICULTIES[d].label}
          </button>
        ))}
      </Row>
      <p className="-mt-3 text-[11px] text-muted">{EAR_DIFFICULTIES[s.difficulty].hint}</p>
      <Row label="Rodadas">
        {EAR_ROUNDS.map((n) => (
          <button key={n} disabled={!editable} onClick={() => set({ rounds: n })} className={`${chip(s.rounds === n)} flex-1`}>
            {n}
          </button>
        ))}
      </Row>
      <Row label="Tempo para escrever">
        {EAR_TIMES.map((t) => (
          <button key={t} disabled={!editable} onClick={() => set({ answerTime: t })} className={`${chip(s.answerTime === t)} flex-1`}>
            {t}s
          </button>
        ))}
      </Row>
      <Row label="Máximo de jogadores">
        {EAR_MAX_PLAYERS.map((n) => (
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

function LangTag({ room }: { room: EarPublicRoom }) {
  const lang = room.lang ? EAR_LANGS[room.lang] : null;
  return (
    <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-muted uppercase">
      Palavra {room.round}/{room.settings.rounds}
      {lang && (
        <span className="rounded-full bg-panel-2 px-2.5 py-1 text-sm tracking-normal text-white normal-case">
          {lang.flag} {lang.label}
        </span>
      )}
      <span className="tracking-normal normal-case">· {EAR_DIFFICULTIES[room.settings.difficulty].label}</span>
    </p>
  );
}

// ---------- rodada ----------

function EarQuestion({ room, meId }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const now = useNow(true);
  const speakAt = room.speakAt ?? 0;
  const toSpeak = speakAt - now;
  const listening = toSpeak <= 0 && toSpeak > -EAR_SPEAK_MS;
  const remaining = Math.max(0, (room.endsAt ?? 0) - now);
  const answerTotal = room.settings.answerTime * 1000;
  const key = `${room.code}-${room.round}-${speakAt}`;
  const [missed, setMissed] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string | null>(() => (mine.round === room.round ? mine.answer : null));
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTick = useRef(0);
  const lang = room.lang ? EAR_LANGS[room.lang] : null;

  useSocketEvent<typeof mine>('ear:mine', (p) => {
    if (p.round === room.round) setSent(p.answer);
  });

  // Fala a palavra na hora marcada pelo servidor — uma vez só.
  useEffect(() => {
    const fire = () => {
      if (played.has(key)) return;
      const p = pending;
      if (!p || p.round !== room.round) return setMissed(true);
      // Chegou atrasado demais (aba em segundo plano etc.): não toca fora de hora.
      if (serverNow() - p.speakAt > 1500) return setMissed(true);
      played.add(key);
      void play(p.audio, p.speakAt);
    };
    const wait = speakAt - serverNow() - 800;
    if (wait <= 0) {
      fire();
      return;
    }
    const t = window.setTimeout(fire, wait);
    return () => clearTimeout(t);
  }, [key, room.round, speakAt]);

  // Bipes da contagem 3… 2… 1…
  useEffect(() => {
    const s = Math.ceil(toSpeak / 1000);
    if (toSpeak > 0 && s <= 3 && s !== lastTick.current) sfx.tick(s === 1);
    lastTick.current = toSpeak > 0 ? s : 0;
    if (toSpeak <= 0 && !listening && remaining > 0) {
      const r = Math.ceil(remaining / 1000);
      if (r <= 3 && r !== lastTick.current) sfx.tick(true);
    }
  }, [toSpeak, listening, remaining]);

  useEffect(() => {
    if (toSpeak <= 0) inputRef.current?.focus();
  }, [toSpeak <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await emitAck<{ ok: boolean; error?: string }>('ear:answer', text);
    if (res.ok) {
      setSent(text.trim());
      setError('');
      setText('');
      sfx.myTurn();
    } else {
      setError(res.error ?? 'Não deu para enviar.');
      sfx.wrong();
    }
  }

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <LangTag room={room} />
      <SoundGate />
      {toSpeak > 0 ? (
        <div className="py-10 text-center">
          <p className="font-display text-2xl text-muted sm:text-3xl">Palavra em…</p>
          <p key={Math.ceil(toSpeak / 1000)} className="pop-in font-display text-[120px] leading-none text-ok sm:text-[160px]">
            {Math.ceil(toSpeak / 1000)}
          </p>
          <p className="mt-2 text-sm text-muted">🔊 Atenção: ela só vai ser dita uma vez!</p>
        </div>
      ) : (
        <>
          <div className="my-6 flex flex-col items-center gap-2 text-center">
            <EarMark className={`h-20 w-20 ${listening ? 'animate-pulse' : 'opacity-70'}`} />
            <p className="font-display text-2xl">{listening ? 'Escuta…' : missed ? 'Você perdeu a palavra 😢' : 'O que você ouviu?'}</p>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ${remaining < 4000 ? 'bg-danger' : 'bg-ok'}`}
              style={{ width: `${Math.min(100, (remaining / answerTotal) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-right font-display text-xl tabular-nums text-muted">{Math.ceil(remaining / 1000)}s</p>
        </>
      )}

      {playing ? (
        <form onSubmit={submit} className={toSpeak > 0 ? 'pointer-events-none opacity-40' : ''}>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={text}
              disabled={toSpeak > 0}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={60}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escreva aqui o que ouviu"
              className="min-w-0 flex-1 rounded-2xl border-2 border-ok/50 bg-panel-2 px-4 py-4 font-display text-2xl outline-none placeholder:font-sans placeholder:text-base placeholder:text-muted focus:border-ok focus:ring-4 focus:ring-ok/15 sm:text-3xl"
            />
            <button disabled={!text.trim() || toSpeak > 0} className="btn-primary flex items-center gap-2 rounded-2xl px-5">
              <IconSend width={18} /> <span className="hidden sm:inline">{sent === null ? 'Enviar' : 'Trocar'}</span>
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          {sent !== null && (
            <div className="pop-in mt-3 rounded-2xl border border-ok/40 bg-ok/10 px-4 py-3 text-center">
              Sua resposta: <b className="font-display text-2xl text-ok">{sent}</b>
              <p className="text-xs text-muted">Dá para trocar até o tempo acabar.</p>
            </div>
          )}
        </form>
      ) : (
        <p className="mt-5 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>
      )}
    </section>
  );
}

// ---------- revelação ----------

function Letters({ guess, answers }: { guess: string; answers: string[] }) {
  // Compara com a forma aceita mais parecida.
  const target = answers.reduce((best, a) => (Math.abs(earNorm(a).length - earNorm(guess).length) < Math.abs(earNorm(best).length - earNorm(guess).length) ? a : best), answers[0]);
  const parts = diffLetters(guess, target);
  return (
    <span className="font-mono text-sm tracking-wide">
      {parts.map((p, i) => (
        <span key={i} className={p.k === 'ok' ? 'text-ok' : p.k === 'bad' ? 'text-danger line-through decoration-1' : 'text-muted/60 underline decoration-dotted'}>
          {p.ch}
        </span>
      ))}
    </span>
  );
}

function EarReveal({ room, meId, isHost }: Props) {
  const w = room.word;
  const remaining = Math.max(0, (room.endsAt ?? 0) - useNow(room.phase === 'reveal'));
  const player = (id: string) => room.players.find((p) => p.id === id);
  if (!w || !room.lang) return <section />;
  const lang = EAR_LANGS[room.lang];
  const written = w.answers[0];
  const showWritten = earNorm(written) !== earNorm(w.say) || /[^\u0000-ɏ\s'’-]/.test(w.say);

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <LangTag room={room} />
      <div className="mt-5 rounded-2xl border border-ok/40 bg-ok/10 p-5 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">A palavra era</p>
        <p className="pop-in font-display text-4xl break-words text-ok sm:text-5xl">{w.say}</p>
        {showWritten && <p className="mt-1 font-display text-2xl text-white">{w.answers.join(' ou ')}</p>}
        <p className="mt-2 text-sm text-muted">
          {lang.flag} significa <b className="text-white">“{w.meaning}”</b>
        </p>
        <button onClick={() => void play(w.audio)} className="btn-secondary mt-3 px-4 text-sm">
          🔊 Ouvir de novo
        </button>
      </div>

      <ul className="mt-4 space-y-2">
        {(room.results ?? []).map((r) => {
          const p = player(r.playerId);
          return (
            <li
              key={r.playerId}
              className={`slide-in flex items-center gap-3 rounded-2xl border p-3 ${r.playerId === meId ? 'border-pop/50' : 'border-line'} ${r.points > 0 ? 'bg-ok/5' : 'bg-panel-2/50'}`}
            >
              {p && <Avatar emoji={p.avatar} id={p.id} size={34} />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {p?.name}
                  {r.playerId === meId && ' (você)'}
                  {r.exact && <span className="ml-1.5 text-xs text-spark">🎯 perfeito!</span>}
                  {r.best && !r.exact && <span className="ml-1.5 text-xs text-spark">⭐ mais perto</span>}
                </p>
                <p className="text-xs break-all text-muted">
                  {r.answer === null ? 'não respondeu' : <Letters guess={r.answer} answers={w.answers} />}
                  {r.answer !== null && <span className="ml-2">· {r.similarity}% parecido</span>}
                </p>
              </div>
              <span className={`font-display text-xl ${r.points > 0 ? 'text-ok' : 'text-muted'}`}>{r.points > 0 ? `+${r.points}` : 0}</span>
            </li>
          );
        })}
      </ul>

      {room.phase === 'reveal' && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-muted">
            {room.round >= room.settings.rounds ? 'Resultado final' : 'Próxima palavra'} em {Math.ceil(remaining / 1000)}s…
          </span>
          {isHost && (
            <button onClick={() => socket.emit('ear:next')} className="btn-primary px-5">
              {room.round >= room.settings.rounds ? 'Ver campeão →' : 'Próxima →'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- placar ----------

function EarScoreboard({ room, meId }: { room: EarPublicRoom; meId: string }) {
  const rows = [...room.players].sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...rows.map((p) => p.score));
  return (
    <aside className="glass h-fit rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">Placar</h3>
        <span className="text-xs text-muted">
          palavra {room.round}/{room.settings.rounds}
        </span>
      </div>
      <ul className="space-y-2.5">
        {rows.map((p) => (
          <li key={p.id} className={p.left ? 'opacity-50' : ''}>
            <div className="flex items-center gap-2.5">
              <Avatar emoji={p.avatar} id={p.id} size={30} dim={!p.connected} />
              <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${p.id === meId ? 'text-ok' : ''}`}>{p.name}</span>
              {room.phase === 'question' && <span className="text-xs">{p.answered ? '✅' : '👂'}</span>}
              <span className="font-display text-lg tabular-nums">{p.score}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${(p.score / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
        <EarMark className="h-4 w-4" /> perfeito +{EAR_EXACT_POINTS} · perto até +{EAR_NEAR_MAX} · mais perto +{EAR_BEST_BONUS}
      </p>
    </aside>
  );
}
