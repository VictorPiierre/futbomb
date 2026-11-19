import { useEffect, useRef, useState } from 'react';
import {
  SOM_MAX_PLAYERS, SOM_MAX_REC_MS, SOM_RECORD_TIMES, SOM_ROUNDS, SOM_SLOT_MS, SOM_VOTE_POINTS, SOM_WIN_POINTS,
  type SomClip, type SomPublicRoom, type SomSettings,
} from '../../../shared/som';
import { SOM_BLOWN_CATS, SOM_CATEGORIES, SOM_DIFFICULTIES, SOM_KARAOKE_CATS, SOM_LIBRARY, type SomCategory, type SomDifficulty } from '../../../shared/som-library';
import { emitAck, inviteLink, serverNow, socket, useSocketEvent } from '../net';
import {
  getMic, loadSound, micSupported, playAudio, prepareClip, startRecording, stopPlayback, useNowPlaying,
  type ClipAudio, type MicEffect, type Recording,
} from '../som-audio';
import { audioCtx, sfx } from '../sound';
import { BEST_IMITATION, pick } from '../zoeira';
import Avatar from './Avatar';
import { IconCopy, IconCrown, IconLink, SomMark } from './Icons';
import SomUpload from './SomUpload';

interface Props {
  room: SomPublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

// ---------- estado fora do React (sobrevive a remontagens) ----------

type Mine = { round: number; recorded: boolean; vote: number | null };
let mine: Mine = { round: 0, recorded: false, vote: null };
socket.on('som:mine', (p: Mine) => (mine = p));

interface LoadedClip {
  slot: number;
  mine: boolean;
  audio: ClipAudio;
}
let clipStore: { round: number; clips: LoadedClip[] } | null = null;
const clipListeners = new Set<() => void>();
socket.on('som:clips', async (p: { round: number; clips: SomClip[] }) => {
  const clips = await Promise.all(p.clips.map(async (c) => ({ slot: c.slot, mine: c.mine, audio: await prepareClip(c.data, c.mime) })));
  if (clipStore) for (const c of clipStore.clips) URL.revokeObjectURL(c.audio.url);
  clipStore = { round: p.round, clips };
  for (const l of clipListeners) l();
});

function useClips(round: number) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    clipListeners.add(l);
    return () => {
      clipListeners.delete(l);
    };
  }, []);
  return clipStore?.round === round ? clipStore.clips : null;
}

/** Rodadas cujo som original já tocou automaticamente. */
const autoPlayed = new Set<string>();

function useNow(active = true) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

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
    <button onClick={() => void audioCtx()?.resume()} className="pop-in mb-4 w-full cursor-pointer rounded-2xl border-2 border-spark bg-spark/15 py-3 font-semibold text-spark">
      🔇 Toque aqui para ativar o som
    </button>
  );
}

/** Barrinhas de equalizador animadas. */
function Eq({ on, className = '' }: { on: boolean; className?: string }) {
  return (
    <span className={`inline-flex h-5 items-end gap-[3px] ${className}`} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`w-[4px] rounded-full bg-current ${on ? 'eq-bar' : 'h-1.5'}`} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

function Timer({ endsAt, total }: { endsAt: number | null; total: number }) {
  const now = useNow();
  const remaining = endsAt ? Math.max(0, endsAt - now) : 0;
  const last = useRef(0);
  useEffect(() => {
    const s = Math.ceil(remaining / 1000);
    if (s <= 5 && s > 0 && s !== last.current) sfx.tick(s <= 2);
    last.current = s;
  }, [remaining]);
  return (
    <div className="mt-4 flex items-center gap-3">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full rounded-full transition-[width] duration-200 ${remaining < 5000 ? 'bg-danger' : 'bg-sky'}`} style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }} />
      </div>
      <span className="w-10 text-right font-display text-xl tabular-nums text-muted">{Math.ceil(remaining / 1000)}s</span>
    </div>
  );
}

export default function SomGame(props: Props) {
  const { room } = props;
  if (room.phase === 'lobby') return <SomLobby {...props} />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {room.phase === 'record' ? <Record key={room.round} {...props} /> : room.phase === 'vote' ? <Vote key={room.round} {...props} /> : <Results key={room.round} {...props} />}
      <Scoreboard room={room} meId={props.meId} />
    </div>
  );
}

function DiffBadge({ diff }: { diff: SomDifficulty }) {
  const d = SOM_DIFFICULTIES[diff];
  const cls = diff === 'facil' ? 'border-ok/40 bg-ok/10 text-ok' : diff === 'dificil' ? 'border-fire/40 bg-fire/10 text-fire' : 'border-danger/50 bg-danger/15 text-danger';
  return (
    <span className={`rounded-full border px-3 py-0.5 text-xs font-bold ${cls} ${diff === 'impossivel' ? 'animate-pulse' : ''}`}>
      {d.emoji} {d.label.toUpperCase()}
    </span>
  );
}

/** Efeitos de microfone disponíveis para a categoria do som. */
function effectsFor(cat: SomCategory): { id: MicEffect; label: string }[] {
  if (SOM_KARAOKE_CATS.includes(cat)) return [{ id: 'karaoke', label: '🎤 Karaokê (reverb + eco)' }, { id: 'none', label: 'Sem efeito' }];
  if (SOM_BLOWN_CATS.includes(cat)) return [{ id: 'none', label: 'Normal' }, { id: 'blown', label: '💥 Microfone estourado' }];
  return [];
}

function RoundHeader({ room }: { room: SomPublicRoom }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
        Rodada {room.round}/{room.settings.rounds}
      </p>
      {room.sound && (
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full border border-sky/40 bg-sky/10 px-3 py-0.5 text-xs font-semibold text-sky">
            {SOM_CATEGORIES[room.sound.cat].emoji} {SOM_CATEGORIES[room.sound.cat].label}
          </span>
          <DiffBadge diff={room.sound.diff} />
        </div>
      )}
    </div>
  );
}

/** O som da rodada, com botão para ouvir de novo. */
function SoundCard({ room, disabled }: { room: SomPublicRoom; disabled?: boolean }) {
  const sound = room.sound!;
  const playing = useNowPlaying() === 'original';
  return (
    <div className={`pop-in mt-4 flex items-center gap-4 rounded-3xl border-2 p-4 transition ${playing ? 'border-sky bg-sky/15' : 'border-line bg-panel-2'}`}>
      <span className={`grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-ink/50 text-5xl ${playing ? 'wiggle' : ''}`}>{sound.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-2xl leading-tight sm:text-3xl">{sound.title}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-sky">{playing ? <><Eq on /> tocando…</> : 'Som original'}</p>
      </div>
      <button
        disabled={disabled}
        onClick={async () => playAudio('original', await loadSound(sound.id))}
        className="btn-secondary shrink-0 px-4 text-sm disabled:opacity-40"
      >
        🔁 <span className="hidden sm:inline">Ouvir de novo</span>
      </button>
    </div>
  );
}

// ---------- ouvir e gravar ----------

function Record({ room, meId }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const now = useNow();
  const toPlay = (room.playAt ?? 0) - now;
  const sound = room.sound!;

  // Toca o original para todos ao mesmo tempo, uma vez por rodada.
  useEffect(() => {
    void loadSound(sound.id);
    const key = `${room.code}-${room.round}-${room.playAt}`;
    if (!room.playAt || autoPlayed.has(key) || serverNow() > room.playAt + 1500) return;
    autoPlayed.add(key);
    void loadSound(sound.id).then((buf) => playAudio('original', buf, room.playAt!));
  }, [room.code, room.round, room.playAt, sound.id]);

  const [rec, setRec] = useState<Recording | null>(null);
  const [recStart, setRecStart] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(() => mine.round === room.round && mine.recorded);
  const [take, setTake] = useState<ClipAudio | null>(null);
  const [error, setError] = useState('');
  const effects = effectsFor(sound.cat);
  const [effect, setEffect] = useState<MicEffect>(effects[0]?.id ?? 'none');
  useSocketEvent<Mine>('som:mine', (p) => p.round === room.round && setSent(p.recorded));
  const recording = !!rec;
  const elapsed = recording ? Math.min(SOM_MAX_REC_MS, Date.now() - recStart) : 0;
  useEffect(() => () => rec?.stop(), [rec]);

  async function toggle() {
    if (rec) return rec.stop();
    setError('');
    if (!micSupported()) return setError('Seu navegador não permite gravar áudio. Tente o Chrome ou o Safari atualizados.');
    try {
      const r = await startRecording(SOM_MAX_REC_MS, setLevel, effect);
      setRec(r);
      setRecStart(Date.now());
      const { blob, mime } = await r.done;
      setRec(null);
      setBusy(true);
      const data = await blob.arrayBuffer();
      const res = await emitAck<{ ok: boolean; error?: string }>('som:clip', data, mime);
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? 'Não deu para enviar a gravação.');
        return sfx.wrong();
      }
      setSent(true);
      sfx.myTurn();
      if (take) URL.revokeObjectURL(take.url);
      setTake(await prepareClip(data, mime));
    } catch (e) {
      setRec(null);
      setBusy(false);
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? '🎙️ O microfone foi bloqueado. Libere o acesso ao microfone nas permissões do navegador e tente de novo.' : 'Não consegui acessar o microfone.');
    }
  }

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <SoundGate />
      <RoundHeader room={room} />
      {toPlay > 0 ? (
        <div className="py-10 text-center">
          <p className="font-display text-2xl text-muted sm:text-3xl">Prepare o ouvido…</p>
          <p key={Math.ceil(toPlay / 1000)} className="pop-in font-display text-[120px] leading-none text-sky sm:text-[160px]">
            {Math.ceil(toPlay / 1000)}
          </p>
          <p className="text-sm text-muted">
            {sound.emoji} {sound.title}
          </p>
        </div>
      ) : (
        <>
          <SoundCard room={room} disabled={recording} />
          <Timer endsAt={room.endsAt} total={room.settings.recordTime * 1000} />
          {playing ? (
            <div className="mt-4 flex flex-col items-center text-center">
              <p className="mb-4 text-sm text-muted">
                {recording ? 'Gravando… capriche! 😂' : sent ? 'Imitação enviada! Se quiser, grave de novo — vale a última.' : `Agora imite o som! Você tem até ${SOM_MAX_REC_MS / 1000}s de gravação.`}
              </p>
              {effects.length > 0 && (
                <div className="mb-4 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Efeito do microfone">
                  {effects.map((e) => (
                    <button
                      key={e.id}
                      disabled={recording || busy}
                      onClick={() => setEffect(e.id)}
                      className={`chip px-3 py-1.5 text-sm ${effect === e.id ? 'chip-on' : ''}`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={toggle}
                disabled={busy}
                aria-label={recording ? 'Parar gravação' : 'Gravar'}
                className={`relative grid h-32 w-32 cursor-pointer place-items-center rounded-full border-4 text-5xl transition disabled:opacity-60 ${
                  recording ? 'border-danger bg-danger/20' : 'border-sky bg-sky/15 hover:bg-sky/25'
                }`}
                style={{ transform: `scale(${1 + level * 0.18})` }}
              >
                {recording && (
                  <svg className="absolute inset-[-10px] -rotate-90" viewBox="0 0 100 100" aria-hidden>
                    <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="4" className="text-danger" strokeDasharray={`${(elapsed / SOM_MAX_REC_MS) * 295} 295`} />
                  </svg>
                )}
                <span className={recording ? 'animate-pulse' : ''}>{recording ? '⏹️' : '🎙️'}</span>
              </button>
              <p className="mt-3 font-display text-lg">{busy ? 'Enviando…' : recording ? 'Toque para parar' : sent ? 'Gravar de novo' : 'Toque para gravar'}</p>
              {sent && take && !recording && (
                <button onClick={() => playAudio('take', take)} className="pop-in mt-3 rounded-full border border-ok/40 bg-ok/10 px-4 py-1.5 text-sm font-semibold text-ok">
                  ▶ Ouvir minha imitação
                </button>
              )}
              {error && <p className="slide-in mt-3 text-sm text-danger">{error}</p>}
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>
          )}
        </>
      )}
    </section>
  );
}

// ---------- ouvir as imitações e votar ----------

function Vote({ room, meId }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const clips = useClips(room.round);
  const now = useNow();
  const nowPlaying = useNowPlaying();
  const [vote, setVote] = useState<number | null>(() => (mine.round === room.round ? mine.vote : null));
  const [error, setError] = useState('');
  const sound = room.sound!;
  const playlistAt = room.playlistAt ?? 0;
  const playlistEnd = playlistAt + SOM_SLOT_MS * (room.clipCount + 1);
  const listening = now < playlistEnd;

  // Sequência automática: original, depois cada imitação.
  useEffect(() => {
    if (!clips || !room.playlistAt) return;
    const timers: number[] = [];
    const items: { key: string; src: () => Promise<AudioBuffer | ClipAudio | null> }[] = [
      { key: 'original', src: () => loadSound(sound.id) },
      ...clips.map((c) => ({ key: `clip-${c.slot}`, src: async () => c.audio })),
    ];
    items.forEach((it, i) => {
      const at = room.playlistAt! + SOM_SLOT_MS * i;
      const wait = at - serverNow() - 300;
      if (at < serverNow()) return;
      timers.push(window.setTimeout(async () => playAudio(it.key, await it.src(), at), Math.max(0, wait)));
    });
    return () => timers.forEach(clearTimeout);
  }, [clips, room.playlistAt, sound.id]);
  useEffect(() => () => stopPlayback(), []);

  async function choose(slot: number) {
    const res = await emitAck<{ ok: boolean; error?: string }>('som:vote', slot);
    if (res.ok) {
      setVote(slot);
      setError('');
      sfx.myTurn();
    } else setError(res.error ?? 'Não deu.');
  }

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <SoundGate />
      <RoundHeader room={room} />
      <h2 className="mt-2 font-display text-2xl sm:text-3xl">{listening ? '🎧 Ouvindo as imitações…' : '🗳️ Qual foi a melhor imitação?'}</h2>
      <Timer endsAt={room.endsAt} total={room.endsAt ? room.endsAt - playlistAt : 1} />

      <button
        onClick={async () => playAudio('original', await loadSound(sound.id))}
        className={`mt-3 flex w-full cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${nowPlaying === 'original' ? 'border-sky bg-sky/15' : 'border-line bg-panel-2 hover:border-sky/50'}`}
      >
        <span className={`text-3xl ${nowPlaying === 'original' ? 'wiggle' : ''}`}>{sound.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold tracking-wider text-muted uppercase">Original</span>
          <span className="block font-display text-lg leading-tight">{sound.title}</span>
        </span>
        <span className="text-sky">{nowPlaying === 'original' ? <Eq on /> : '▶'}</span>
      </button>

      {!clips ? (
        <p className="mt-4 rounded-2xl bg-panel-2 p-4 text-center text-sm text-muted">Carregando as gravações…</p>
      ) : (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {clips.map((c, i) => {
            const on = nowPlaying === `clip-${c.slot}`;
            const voted = vote === c.slot;
            return (
              <div
                key={c.slot}
                className={`pop-in rounded-2xl border-2 p-3 transition ${on ? 'border-sky bg-sky/15' : voted ? 'border-ok bg-ok/10' : c.mine ? 'border-dashed border-line bg-panel-2/50' : 'border-line bg-panel-2'}`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex items-center gap-3">
                  <button onClick={() => playAudio(`clip-${c.slot}`, c.audio)} className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full bg-sky/20 text-xl text-sky hover:bg-sky/30" aria-label={`Ouvir imitação ${c.slot}`}>
                    {on ? <Eq on /> : '▶'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg">Imitação #{c.slot}</p>
                    <p className="text-xs text-muted">{c.mine ? 'sua imitação' : on ? 'tocando…' : 'toque para ouvir'}</p>
                  </div>
                </div>
                {playing && !c.mine && (
                  <button
                    onClick={() => choose(c.slot)}
                    className={`mt-2.5 w-full cursor-pointer rounded-xl py-2 text-sm font-bold transition ${voted ? 'bg-ok text-ink' : 'bg-ink/50 text-white hover:bg-sky/25'}`}
                  >
                    {voted ? '✅ Seu voto (dá para trocar)' : '👍 Votar nesta'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {!playing && <p className="mt-4 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>}
      {playing && clips && clips.every((c) => c.mine) && <p className="mt-4 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Só você gravou nesta rodada — não tem em quem votar.</p>}
    </section>
  );
}

// ---------- resultado da rodada ----------

function Results({ room, meId, isHost }: Props) {
  const results = room.results ?? [];
  const clips = useClips(room.round);
  const now = useNow();
  const nowPlaying = useNowPlaying();
  const remaining = room.endsAt ? Math.max(0, room.endsAt - now) : 0;
  const player = (id: string) => room.players.find((p) => p.id === id);
  const gained = room.gained ?? {};
  const sound = room.sound!;

  useEffect(() => {
    const won = results.find((r) => r.winner && r.playerId === meId);
    if (won) sfx.win();
    else if (results.length) sfx.correct();
    // Toca a imitação vencedora.
    const best = results.find((r) => r.winner);
    const clip = best && clipStore?.round === room.round ? clipStore.clips.find((c) => c.slot === best.slot) : null;
    if (clip) {
      const t = window.setTimeout(() => playAudio(`clip-${clip.slot}`, clip.audio), 700);
      return () => clearTimeout(t);
    }
  }, []);
  useEffect(() => () => stopPlayback(), []);

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <RoundHeader room={room} />
      <div className="mt-2 flex items-center gap-3">
        <span className="text-4xl">{sound.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wider text-muted uppercase">Resultado</p>
          <p className="font-display text-2xl leading-tight">{sound.title}</p>
        </div>
        <button onClick={async () => playAudio('original', await loadSound(sound.id))} className="btn-secondary px-3 text-sm">
          {nowPlaying === 'original' ? <Eq on className="text-sky" /> : '▶ Original'}
        </button>
      </div>

      {results.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-panel-2 p-6 text-center text-lg">Ninguém gravou nesta rodada 🤐</p>
      ) : (
        <ul className="mt-5 space-y-2.5">
          {results.map((r, i) => {
            const p = player(r.playerId);
            const clip = clips?.find((c) => c.slot === r.slot);
            const on = nowPlaying === `clip-${r.slot}`;
            return (
              <li key={r.slot} className={`pop-in rounded-2xl border-2 p-3 ${r.winner ? 'border-spark bg-spark/10' : 'border-line bg-panel-2'}`} style={{ animationDelay: `${i * 150}ms` }}>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {p && <Avatar emoji={p.avatar} id={p.id} size={44} />}
                    {r.winner && <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xl">👑</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-display text-lg ${r.playerId === meId ? 'text-sky' : ''}`}>
                      {p?.name ?? '?'} <span className="font-sans text-xs text-muted">· imitação #{r.slot}</span>
                    </p>
                    {r.winner && <p className="text-xs font-bold text-spark">🏆 {pick(BEST_IMITATION, `${room.code}-${room.round}-${r.slot}`)}</p>}
                    <p className="text-sm text-muted">
                      {r.voters.length} {r.voters.length === 1 ? 'voto' : 'votos'}
                      {(gained[r.playerId] ?? 0) > 0 && <b className="ml-2 text-ok">+{gained[r.playerId]}</b>}
                    </p>
                  </div>
                  {clip && (
                    <button onClick={() => playAudio(`clip-${r.slot}`, clip.audio)} className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-sky/20 text-sky hover:bg-sky/30" aria-label="Ouvir">
                      {on ? <Eq on /> : '▶'}
                    </button>
                  )}
                </div>
                {r.voters.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    votaram:
                    {r.voters.map((id) => {
                      const v = player(id);
                      return (
                        <span key={id} className="flex items-center gap-1 rounded-full bg-ink/40 py-0.5 pr-2 pl-0.5">
                          {v && <Avatar emoji={v.avatar} id={v.id} size={18} />} {v?.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {room.round >= room.settings.rounds ? 'Resultado final' : 'Próximo som'} em {Math.ceil(remaining / 1000)}s…
        </span>
        {isHost && (
          <button onClick={() => socket.emit('som:next')} className="btn-primary px-5">
            {room.round >= room.settings.rounds ? 'Ver campeão →' : 'Próximo →'}
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- placar ----------

function Scoreboard({ room, meId }: { room: SomPublicRoom; meId: string }) {
  const rows = [...room.players].sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...rows.map((p) => p.score));
  const waiting = room.phase === 'record' || room.phase === 'vote';
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
              <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${p.id === meId ? 'text-sky' : ''}`}>{p.name}</span>
              {waiting && <span className="text-xs">{p.done ? '✅' : room.phase === 'record' ? '🎙️' : '🤔'}</span>}
              <span className="font-display text-lg tabular-nums">{p.score}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-sky transition-[width] duration-500" style={{ width: `${(p.score / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
        <SomMark className="h-4 w-4 shrink-0" /> cada voto +{SOM_VOTE_POINTS} · mais votado da rodada +{SOM_WIN_POINTS}
      </p>
    </aside>
  );
}

// ---------- sala de espera ----------

function MicTest() {
  const [state, setState] = useState<'idle' | 'rec' | 'done' | 'error'>('idle');
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<ClipAudio | null>(null);
  const [msg, setMsg] = useState('');

  async function test() {
    if (!micSupported()) {
      setState('error');
      return setMsg('Seu navegador não permite gravar áudio.');
    }
    try {
      await getMic();
      setState('rec');
      const r = await startRecording(2000, setLevel);
      const { blob, mime } = await r.done;
      const t = await prepareClip(await blob.arrayBuffer(), mime);
      setTake(t);
      setState('done');
      playAudio('test', t);
    } catch {
      setState('error');
      setMsg('🎙️ Microfone bloqueado. Libere o acesso nas permissões do navegador.');
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-sky/30 bg-sky/10 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky">🎙️ Teste seu microfone antes de começar</p>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={test} disabled={state === 'rec'} className="btn-secondary px-4 text-sm">
          {state === 'rec' ? 'Gravando 2s…' : state === 'done' ? 'Testar de novo' : 'Testar microfone'}
        </button>
        {state === 'rec' && (
          <div className="h-2.5 w-32 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-sky transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
          </div>
        )}
        {state === 'done' && take && (
          <button onClick={() => playAudio('test', take)} className="text-sm font-semibold text-ok">
            ▶ Ouvir gravação
          </button>
        )}
      </div>
      {state === 'error' && <p className="mt-2 text-sm text-danger">{msg}</p>}
    </div>
  );
}

function SomLobby({ room, meId, isHost, onCopy }: Props) {
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
            <div key={p.id} className={`pop-in flex items-center gap-2.5 rounded-2xl border p-2.5 ${p.id === meId ? 'border-sky/50 bg-sky/5' : 'border-line bg-panel/60'}`}>
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

        <MicTest />
        <SomUpload room={room} meId={meId} isHost={isHost} />

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
          Toca um som curtinho e absurdo — grito estourado, pum bass boosted, drop de phonk, bicho, efeito de videogame… Todo mundo tenta <b className="text-sky">imitar no microfone</b>{' '}
          (dá para ouvir de novo antes de gravar). Depois todos escutam as imitações, sem saber de quem é cada uma, e votam na melhor — não vale votar em si mesmo.
          Cada voto: <b className="text-white">+{SOM_VOTE_POINTS}</b>. Mais votado da rodada: <b className="text-white">+{SOM_WIN_POINTS}</b>. Melhor com 3 ou mais jogadores!
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <SomSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2} className="btn-primary w-full py-4 text-xl">
                Começar o Faz Esse Som!
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

/** Temas com pelo menos um som, na ordem da biblioteca, com a quantidade. */
const THEMES = (Object.keys(SOM_CATEGORIES) as SomCategory[])
  .map((c) => [c, SOM_LIBRARY.filter((x) => x.cat === c).length] as const)
  .filter(([, n]) => n > 0);

export function SomSettingsPanel({ room, editable }: { room: SomPublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<SomSettings>) => editable && socket.emit('room:settings', patch);
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Tema</p>
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!editable} onClick={() => set({ theme: 'mix' })} className={`${chip(s.theme === 'mix')} col-span-2`}>
            🌀 Todos os temas misturados
          </button>
          {room.customSounds.length > 0 && (
            <button disabled={!editable} onClick={() => set({ theme: 'sala' })} className={`${chip(s.theme === 'sala')} col-span-2`}>
              📁 Só os sons da sala <span className="text-muted">({room.customSounds.length})</span>
            </button>
          )}
          {THEMES.map(([cat, count]) => (
            <button key={cat} disabled={!editable} onClick={() => set({ theme: cat })} className={`${chip(s.theme === cat)} text-sm`}>
              {SOM_CATEGORIES[cat].emoji} {SOM_CATEGORIES[cat].label} <span className="text-muted">({count})</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Dificuldade</p>
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!editable} onClick={() => set({ difficulty: 'sortear' })} className={`${chip(s.difficulty === 'sortear')} col-span-2`}>
            🎲 Sortear a cada rodada
          </button>
          {(Object.keys(SOM_DIFFICULTIES) as SomDifficulty[]).map((d) => (
            <button key={d} disabled={!editable} onClick={() => set({ difficulty: d })} className={`${chip(s.difficulty === d)} text-sm ${d === 'impossivel' ? 'col-span-2' : ''}`} title={SOM_DIFFICULTIES[d].hint}>
              {SOM_DIFFICULTIES[d].emoji} {SOM_DIFFICULTIES[d].label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          {s.difficulty === 'sortear' ? 'Cada rodada sorteia uma dificuldade (mais chance de difícil e impossível).' : SOM_DIFFICULTIES[s.difficulty].hint}
        </p>
      </div>
      <Row label="Rodadas">
        {SOM_ROUNDS.map((n) => (
          <button key={n} disabled={!editable} onClick={() => set({ rounds: n })} className={`${chip(s.rounds === n)} flex-1`}>
            {n}
          </button>
        ))}
      </Row>
      <Row label="Tempo para ouvir e gravar">
        {SOM_RECORD_TIMES.map((t) => (
          <button key={t} disabled={!editable} onClick={() => set({ recordTime: t })} className={`${chip(s.recordTime === t)} flex-1`}>
            {t}s
          </button>
        ))}
      </Row>
      <Row label="Máximo de jogadores">
        {SOM_MAX_PLAYERS.map((n) => (
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
