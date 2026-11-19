import { useEffect, useRef, useState } from 'react';
import {
  SOM_MAX_PLAYERS, SOM_MAX_REC_MS, SOM_RATING_ORDER, SOM_RATINGS, SOM_ROUNDS, type SomRating,
  type SomClip, type SomPublicRoom, type SomSettings,
} from '../../../shared/som';
import { emitAck, inviteLink, serverNow, socket, useSocketEvent } from '../net';
import {
  getMic, loadSound, micSupported, playAudio, prepareClip, startRecording, stopPlayback, useNowPlaying,
  applyModifiers, decodeBlob, SOM_MODIFIERS, type ClipAudio, type Recording, type SomModifier,
} from '../som-audio';
import { audioCtx, sfx } from '../sound';
import { BEST_IMITATION, pick } from '../zoeira';
import Avatar from './Avatar';
import { IconCopy, IconCrown, IconLink, SomMark } from './Icons';

interface Props {
  room: SomPublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

// ---------- estado fora do React (sobrevive a remontagens) ----------

type Mine = { round: number; recorded: boolean; slide?: number; vote?: SomRating | null };
let mine: Mine = { round: 0, recorded: false };
socket.on('som:mine', (p: Mine) => (mine = p));

interface LoadedClip {
  slot: number;
  mine: boolean;
  mime: string;
  audio: ClipAudio;
}
let clipStore: { round: number; clips: LoadedClip[] } | null = null;
const clipListeners = new Set<() => void>();
socket.on('som:clips', async (p: { round: number; clips: SomClip[] }) => {
  const clips = await Promise.all(p.clips.map(async (c) => ({ slot: c.slot, mine: c.mine, mime: c.mime, audio: await prepareClip(c.data, c.mime) })));
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

function RoundHeader({ room }: { room: SomPublicRoom }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
        Rodada {room.round}/{room.settings.rounds}
      </p>
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
        onClick={async () => playAudio('original', await loadSound(sound.id, sound.file))}
        className="btn-secondary shrink-0 px-4 text-sm disabled:opacity-40"
      >
        🔁 <span className="hidden sm:inline">Ouvir de novo</span>
      </button>
    </div>
  );
}

// ---------- ouvir e gravar ----------

function Record({ room, meId, isHost }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const now = useNow();
  const toPlay = (room.playAt ?? 0) - now;
  const sound = room.sound!;

  // Toca o original para todos ao mesmo tempo, uma vez por rodada.
  useEffect(() => {
    void loadSound(sound.id, sound.file);
    const key = `${room.code}-${room.round}-${room.playAt}`;
    if (!room.playAt || autoPlayed.has(key) || serverNow() > room.playAt + 1500) return;
    autoPlayed.add(key);
    void loadSound(sound.id, sound.file).then((buf) => playAudio('original', buf, room.playAt!));
  }, [room.code, room.round, room.playAt, sound.id]);

  const [rec, setRec] = useState<Recording | null>(null);
  const [recStart, setRecStart] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  /** Última gravação (ainda não enviada). */
  const [raw, setRaw] = useState<{ blob: Blob; mime: string; buffer: AudioBuffer | null } | null>(null);
  const [mods, setMods] = useState<SomModifier[]>([]);
  const [ready, setReady] = useState(() => mine.round === room.round && mine.recorded);
  const [sentAudio, setSentAudio] = useState<ClipAudio | null>(null);
  const [error, setError] = useState('');
  useSocketEvent<Mine>('som:mine', (p) => p.round === room.round && p.recorded && setReady(true));
  const recording = !!rec;
  const elapsed = recording ? Math.min(SOM_MAX_REC_MS, Date.now() - recStart) : 0;
  useEffect(() => () => rec?.stop(), [rec]);
  const active = room.players.filter((p) => !p.left && p.connected);
  const readyCount = active.filter((p) => p.done).length;

  async function toggle() {
    if (rec) return rec.stop();
    setError('');
    if (!micSupported()) return setError('Seu navegador não permite gravar áudio. Tente o Chrome ou o Safari atualizados.');
    try {
      const r = await startRecording(SOM_MAX_REC_MS, setLevel);
      setRec(r);
      setRecStart(Date.now());
      const { blob, mime } = await r.done;
      setRec(null);
      let buffer: AudioBuffer | null = null;
      try {
        buffer = await decodeBlob(blob);
      } catch {
        buffer = null; // sem modificadores neste navegador: vai a gravação original
      }
      setRaw({ blob, mime, buffer });
      sfx.myTurn();
    } catch (e) {
      setRec(null);
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? '🎙️ O microfone foi bloqueado. Libere o acesso ao microfone nas permissões do navegador e tente de novo.' : 'Não consegui acessar o microfone.');
    }
  }

  /** Gravação com os modificadores marcados (o que vai ser enviado). */
  async function rendered(): Promise<{ data: ArrayBuffer; mime: string }> {
    if (raw?.buffer) return { data: await applyModifiers(raw.buffer, mods), mime: 'audio/wav' };
    return { data: await raw!.blob.arrayBuffer(), mime: raw!.mime };
  }

  async function preview() {
    if (!raw) return;
    const { data, mime: type } = await rendered();
    playAudio('take', await prepareClip(data, type));
  }

  async function done() {
    if (!raw) return;
    setBusy(true);
    setError('');
    const { data, mime: type } = await rendered();
    const res = await emitAck<{ ok: boolean; error?: string }>('som:clip', data, type);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Não deu para enviar a gravação.');
      return sfx.wrong();
    }
    sfx.correct();
    stopPlayback();
    setSentAudio(await prepareClip(data, type));
    setReady(true);
  }

  const toggleMod = (m: SomModifier) => setMods((list) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]));

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
          <p className="mt-3 text-center text-xs text-muted">
            ✅ {readyCount} de {active.length} {readyCount === 1 ? 'pronto' : 'prontos'} — sem pressa, a rodada segue quando todo mundo apertar <b className="text-white">Pronto</b>.
          </p>

          {!playing ? (
            <p className="mt-4 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">Você está assistindo esta partida.</p>
          ) : ready ? (
            <div className="pop-in mt-5 rounded-2xl border-2 border-ok/50 bg-ok/10 p-5 text-center">
              <p className="text-5xl">✅</p>
              <p className="mt-1 font-display text-2xl">Pronto!</p>
              <p className="text-sm text-muted">Esperando os outros terminarem…</p>
              {sentAudio && (
                <button onClick={() => playAudio('take', sentAudio)} className="btn-secondary mt-3 px-4 text-sm">
                  ▶ Ouvir o que eu enviei
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4 flex flex-col items-center text-center">
              <p className="mb-4 text-sm text-muted">
                {recording ? 'Gravando… capriche! 😂 Toque para parar.' : raw ? 'Ouça, escolha os modificadores (se quiser) e aperte Pronto.' : 'Agora imite o som! Toque no microfone para gravar.'}
              </p>
              <button
                onClick={toggle}
                disabled={busy}
                aria-label={recording ? 'Parar gravação' : raw ? 'Gravar de novo' : 'Gravar'}
                className={`relative grid cursor-pointer place-items-center rounded-full border-4 transition disabled:opacity-60 ${raw && !recording ? 'h-20 w-20 text-3xl' : 'h-32 w-32 text-5xl'} ${
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
              <p className="mt-2 font-display text-lg">
                {recording ? `${(elapsed / 1000).toFixed(1)}s` : raw ? 'Gravar de novo' : 'Toque para gravar'}
              </p>

              {raw && !recording && (
                <div className="pop-in mt-4 w-full rounded-2xl bg-ink/40 p-4">
                  <button onClick={() => void preview()} className="btn-secondary w-full py-2.5">
                    ▶ Ouvir minha imitação{mods.length ? ' (com modificadores)' : ''}
                  </button>
                  <p className="mt-4 mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Modificadores (opcional — pode marcar vários)</p>
                  {raw.buffer ? (
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {SOM_MODIFIERS.map((m) => (
                        <button key={m.id} onClick={() => toggleMod(m.id)} className={`chip px-3 py-1.5 text-sm ${mods.includes(m.id) ? 'chip-on' : ''}`} aria-pressed={mods.includes(m.id)}>
                          {m.emoji} {m.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">Este navegador não deixa aplicar modificadores — vai a gravação normal.</p>
                  )}
                  <button onClick={() => void done()} disabled={busy} className="btn-primary mt-5 w-full py-3.5 text-xl">
                    {busy ? 'Enviando…' : '✅ Pronto!'}
                  </button>
                </div>
              )}
              {error && <p className="slide-in mt-3 text-sm text-danger">{error}</p>}
            </div>
          )}

          {isHost && (
            <button
              onClick={() => {
                if (readyCount < active.length && !window.confirm(`Ainda faltam ${active.length - readyCount} pessoa(s) apertar Pronto. Encerrar a gravação mesmo assim?`)) return;
                socket.emit('som:next');
              }}
              className="mt-5 w-full cursor-pointer py-2 text-sm text-muted hover:text-white"
            >
              ⏭️ Encerrar a gravação e ir para o desfile
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---------- desfile: uma imitação por vez ----------

/** Baixa a gravação de alguém (o arquivo leva o nome da pessoa e do som). */
function downloadClip(clip: LoadedClip, who: string, sound: string) {
  const type = clip.mime.split(';')[0];
  const ext = type.includes('mp4') || type.includes('aac') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('mpeg') ? 'mp3' : type.includes('wav') ? 'wav' : 'webm';
  const slug = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'som';
  const a = document.createElement('a');
  a.href = clip.audio.url;
  a.download = `${slug(who)}-imitando-${slug(sound)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function DownloadButton({ clip, who, sound, className = '' }: { clip: LoadedClip | undefined; who: string; sound: string; className?: string }) {
  if (!clip) return null;
  return (
    <button onClick={() => downloadClip(clip, who, sound)} className={`btn-secondary px-3 text-sm ${className}`} title="Baixar o áudio" aria-label={`Baixar o áudio de ${who}`}>
      ⬇️ <span className="hidden sm:inline">Baixar</span>
    </button>
  );
}

/** Botão "Próximo" (só o dono da sala vê). */
function HostNext({ isHost, label, hostName }: { isHost: boolean; label: string; hostName: string }) {
  return isHost ? (
    <button onClick={() => socket.emit('som:next')} className="btn-primary w-full py-3.5 text-lg">
      {label}
    </button>
  ) : (
    <p className="rounded-xl bg-panel-2 py-3 text-center text-sm text-muted">Esperando {hostName} passar para o próximo…</p>
  );
}

const playedSlides = new Set<string>();

function Vote({ room, meId, isHost }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const clips = useClips(room.round);
  const nowPlaying = useNowPlaying();
  const sound = room.sound!;
  const slide = room.slide!;
  const index = slide.index;
  const total = room.order.length;
  const targetId = index >= 0 ? room.order[index] : null;
  const target = targetId ? room.players.find((p) => p.id === targetId) : null;
  const clip = index >= 0 ? clips?.find((c) => c.slot === index + 1) : undefined;
  const mineSlide = targetId === meId;
  const [vote, setVote] = useState<SomRating | null>(() => (mine.round === room.round && mine.slide === index ? (mine.vote ?? null) : null));
  const [error, setError] = useState('');
  const key = `${room.code}-${room.round}-${index}`;
  const onAir = index < 0 ? nowPlaying === 'original' : nowPlaying === `clip-${index + 1}`;

  // Cada slide toca sozinho uma vez, na mesma hora para todo mundo.
  useEffect(() => {
    if (playedSlides.has(key) || serverNow() > slide.playAt + 4000) return;
    if (index < 0) {
      playedSlides.add(key);
      void loadSound(sound.id, sound.file).then((buf) => playAudio('original', buf, slide.playAt));
    } else if (clip) {
      playedSlides.add(key);
      playAudio(`clip-${index + 1}`, clip.audio, slide.playAt);
    }
  }, [key, clip, index, slide.playAt, sound.id, sound.file]);
  useEffect(() => () => stopPlayback(), []);
  useEffect(() => {
    if (slide.reveal && targetId === meId) {
      const pts = SOM_RATING_ORDER.reduce((n, r) => n + (slide.votes?.[r].length ?? 0) * SOM_RATINGS[r].points, 0);
      if (pts > 0) sfx.correct();
    }
  }, [slide.reveal, targetId, meId, slide.votes]);

  async function choose(r: SomRating) {
    const res = await emitAck<{ ok: boolean; error?: string }>('som:vote', r);
    if (res.ok) {
      setVote(r);
      setError('');
      sfx.myTurn();
    } else setError(res.error ?? 'Não deu.');
  }

  // ---- relembrando o original ----
  if (index < 0) {
    return (
      <section className="glass rounded-3xl p-5 sm:p-7">
        <SoundGate />
        <RoundHeader room={room} />
        <h2 className="mt-2 font-display text-2xl sm:text-3xl">🔁 Relembrando o som original…</h2>
        <SoundCard room={room} />
        <p className="mt-4 text-sm text-muted">
          Agora vem o desfile: {total} {total === 1 ? 'imitação' : 'imitações'}, uma de cada vez. Vote <b className="text-white">😬 Ruim</b>, <b className="text-white">😐 Meh</b> ou{' '}
          <b className="text-white">🔥 Bom</b>!
        </p>
        <div className="mt-5">
          <HostNext isHost={isHost} label="Começar o desfile →" hostName={room.hostName} />
        </div>
      </section>
    );
  }

  const votes = slide.votes;
  const gained = votes ? SOM_RATING_ORDER.reduce((n, r) => n + votes[r].length * SOM_RATINGS[r].points, 0) : 0;
  const player = (id: string) => room.players.find((p) => p.id === id);

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <SoundGate />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
          Imitação {index + 1} de {total} · rodada {room.round}/{room.settings.rounds}
        </p>
        <div className="flex gap-1">
          {room.order.map((id, i) => (
            <span key={id} className={`h-2 w-6 rounded-full ${i < index ? 'bg-sky/60' : i === index ? 'bg-sky' : 'bg-panel-2'}`} />
          ))}
        </div>
      </div>

      <div key={index} className="pop-in mt-4 flex flex-col items-center text-center">
        <div className={`rounded-full p-1.5 transition ${onAir ? 'turn-glow bg-sky/30' : ''}`}>
          <div className={onAir ? 'wiggle' : ''}>{target && <Avatar emoji={target.avatar} id={target.id} size={150} />}</div>
        </div>
        <p className={`mt-3 font-display text-4xl leading-tight sm:text-5xl ${targetId === meId ? 'text-sky' : ''}`}>
          {target?.name ?? '?'}
          {targetId === meId && <span className="block font-sans text-sm text-muted">(você)</span>}
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted">
          imitando {sound.emoji} <b className="text-white">{sound.title}</b> {onAir && <Eq on className="text-sky" />}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button
            disabled={!clip}
            onClick={() => clip && playAudio(`clip-${index + 1}`, clip.audio)}
            className="btn-secondary px-4 text-sm disabled:opacity-40"
          >
            {onAir ? '🔊 Tocando…' : clip ? '🔁 Ouvir de novo' : 'Carregando…'}
          </button>
          <button onClick={async () => playAudio('original', await loadSound(sound.id, sound.file))} className="btn-secondary px-4 text-sm">
            {nowPlaying === 'original' ? '🔊 Original…' : '▶ Original'}
          </button>
          <DownloadButton clip={clip} who={target?.name ?? 'imitacao'} sound={sound.title} />
        </div>
      </div>

      {votes ? (
        <div className="pop-in mt-6">
          <div className="grid grid-cols-3 gap-2">
            {SOM_RATING_ORDER.map((r) => (
              <div key={r} className={`rounded-2xl border-2 p-3 text-center ${r === 'bom' ? 'border-ok/50 bg-ok/10' : r === 'meh' ? 'border-spark/40 bg-spark/10' : 'border-danger/40 bg-danger/10'}`}>
                <p className="text-4xl">{SOM_RATINGS[r].emoji}</p>
                <p className="font-display text-3xl">{votes[r].length}</p>
                <p className="text-xs text-muted">{SOM_RATINGS[r].label}</p>
                <div className="mt-1 flex flex-wrap justify-center gap-0.5">
                  {votes[r].map((id) => {
                    const v = player(id);
                    return v ? <Avatar key={id} emoji={v.avatar} id={v.id} size={22} /> : null;
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center font-display text-2xl text-ok">
            {target?.name} +{gained} {gained === 1 ? 'ponto' : 'pontos'}
          </p>
        </div>
      ) : playing && !mineSlide ? (
        <div className="mt-6">
          <p className="mb-2 text-center text-sm text-muted">Qual a nota dessa imitação?</p>
          <div className="grid grid-cols-3 gap-2">
            {SOM_RATING_ORDER.map((r) => (
              <button
                key={r}
                onClick={() => choose(r)}
                className={`cursor-pointer rounded-2xl border-2 py-4 text-center transition active:scale-95 ${
                  vote === r
                    ? r === 'bom'
                      ? 'border-ok bg-ok/25 scale-105'
                      : r === 'meh'
                        ? 'border-spark bg-spark/25 scale-105'
                        : 'border-danger bg-danger/25 scale-105'
                    : 'border-line bg-panel-2 hover:border-sky/60'
                }`}
              >
                <span className="block text-4xl sm:text-5xl">{SOM_RATINGS[r].emoji}</span>
                <span className="mt-1 block font-display text-lg">{SOM_RATINGS[r].label}</span>
              </button>
            ))}
          </div>
          {vote && <p className="mt-2 text-center text-xs text-muted">Voto registrado — dá para trocar até as notas aparecerem.</p>}
        </div>
      ) : (
        <p className="mt-6 rounded-xl bg-panel-2 p-3 text-center text-sm text-muted">
          {mineSlide ? 'Essa é a sua! 🙈 Veja o que a galera acha…' : 'Você está assistindo esta partida.'}
        </p>
      )}
      {error && <p className="mt-2 text-center text-sm text-danger">{error}</p>}

      <div className="mt-5">
        <HostNext isHost={isHost} label={index + 1 >= total ? 'Ver resultado da rodada →' : 'Próximo →'} hostName={room.hostName} />
      </div>
    </section>
  );
}

// ---------- resultado da rodada ----------

function Results({ room, meId, isHost }: Props) {
  const results = room.results ?? [];
  const clips = useClips(room.round);
  const nowPlaying = useNowPlaying();
  const player = (id: string) => room.players.find((p) => p.id === id);
  const sound = room.sound!;
  const last = room.round >= room.settings.rounds;

  useEffect(() => {
    const won = results.find((r) => r.best && r.playerId === meId);
    if (won) sfx.win();
    else if (results.length) sfx.correct();
  }, []);
  useEffect(() => () => stopPlayback(), []);

  return (
    <section className="glass rounded-3xl p-5 sm:p-7">
      <RoundHeader room={room} />
      <div className="mt-2 flex items-center gap-3">
        <span className="text-4xl">{sound.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wider text-muted uppercase">Resultado da rodada</p>
          <p className="font-display text-2xl leading-tight">{sound.title}</p>
        </div>
        <button onClick={async () => playAudio('original', await loadSound(sound.id, sound.file))} className="btn-secondary px-3 text-sm">
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
              <li key={r.slot} className={`pop-in rounded-2xl border-2 p-3 ${r.best ? 'border-spark bg-spark/10' : 'border-line bg-panel-2'}`} style={{ animationDelay: `${i * 150}ms` }}>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {p && <Avatar emoji={p.avatar} id={p.id} size={44} />}
                    {r.best && <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xl">👑</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-display text-lg ${r.playerId === meId ? 'text-sky' : ''}`}>{p?.name ?? '?'}</p>
                    {r.best && <p className="text-xs font-bold text-spark">🏆 {pick(BEST_IMITATION, `${room.code}-${room.round}-${r.slot}`)}</p>}
                    <p className="text-sm text-muted">
                      {SOM_RATING_ORDER.map((k) => `${SOM_RATINGS[k].emoji} ${r.votes[k].length}`).join('  ')}
                      <b className="ml-2 text-ok">+{r.points}</b>
                    </p>
                  </div>
                  {clip && (
                    <button onClick={() => playAudio(`clip-${r.slot}`, clip.audio)} className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-sky/20 text-sky hover:bg-sky/30" aria-label={`Ouvir ${p?.name}`}>
                      {on ? <Eq on /> : '▶'}
                    </button>
                  )}
                  <DownloadButton clip={clip} who={p?.name ?? 'imitacao'} sound={sound.title} className="h-11" />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5">
        <HostNext isHost={isHost} label={last ? 'Ver campeão →' : 'Próximo som →'} hostName={room.hostName} />
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
              {waiting && <span className="text-xs">{room.phase === 'vote' && room.slide && room.order[room.slide.index] === p.id ? '🎤' : p.done ? '✅' : room.phase === 'record' ? '🎙️' : room.slide && room.slide.index < 0 ? '' : '🤔'}</span>}
              <span className="font-display text-lg tabular-nums">{p.score}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-sky transition-[width] duration-500" style={{ width: `${(p.score / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
        <SomMark className="h-4 w-4 shrink-0" /> {SOM_RATING_ORDER.map((r) => `${SOM_RATINGS[r].emoji} ${SOM_RATINGS[r].label} +${SOM_RATINGS[r].points}`).join(' · ')}
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
  const empty = room.soundCount === 0;

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

        {empty && (
          <div className="mt-6 rounded-2xl border-2 border-dashed border-spark/50 bg-spark/10 p-4 text-sm">
            <p className="font-semibold text-spark">🔇 Ainda não tem nenhum som no jogo</p>
            <p className="mt-1 text-muted">O dono do site precisa adicionar os sons antes da primeira partida. Assim que adicionar, eles aparecem aqui.</p>
          </div>
        )}
        <MicTest />

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
          (dá para ouvir de novo, gravar quantas vezes quiser e colocar modificadores como 💥 estourado, 🎤 microfone de show e 🐿️ esquilo). Sem tempo: segue quando todos apertam Pronto. Depois vem o desfile: aparece a foto e o nome de cada um, toca a imitação e todo mundo vota <b className="text-white">😬 Ruim</b> (+0),{' '}
          <b className="text-white">😐 Meh</b> (+1) ou <b className="text-white">🔥 Bom</b> (+2) — não vale votar em si mesmo. Dá para baixar o áudio de qualquer um. Quem passa para o próximo é o dono da sala.
        </div>
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <SomSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2 || empty} className="btn-primary w-full py-4 text-xl">
                Começar o Faz Esse Som!
              </button>
              {ready < 2 && !empty && <p className="mt-2 text-center text-xs text-muted">Precisa de pelo menos 2 jogadores conectados.</p>}
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

export function SomSettingsPanel({ room, editable }: { room: SomPublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<SomSettings>) => editable && socket.emit('room:settings', patch);
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;
  return (
    <div className="space-y-5">
      <p className="rounded-xl bg-panel-2 px-3 py-2 text-sm">
        🔊 <b>{room.soundCount}</b> {room.soundCount === 1 ? 'som no jogo' : 'sons no jogo'}
      </p>
      <Row label="Rodadas">
        {SOM_ROUNDS.map((n) => (
          <button key={n} disabled={!editable} onClick={() => set({ rounds: n })} className={`${chip(s.rounds === n)} flex-1`}>
            {n}
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
