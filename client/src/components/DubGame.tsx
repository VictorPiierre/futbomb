import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import {
  DUB_MAX_AUDIO_BYTES, DUB_MAX_CLIP_S, DUB_MAX_PLAYERS, DUB_ROUNDS,
  type DubPublicRoom, type DubScene, type DubSettings,
} from '../../../shared/dub';
import { emitAck, inviteLink, serverNow, socket } from '../net';
import { sfx } from '../sound';
import Avatar from './Avatar';
import { DubMark, IconCopy, IconCrown, IconLink, IconX } from './Icons';

interface Props {
  room: DubPublicRoom;
  meId: string;
  isHost: boolean;
  onCopy: () => void;
}

// ---------- gravações recebidas (guardadas fora do React para sobreviver a remontagens) ----------

type Clip = { url: string; mime: string };
let clips: { round: number; byPlayer: Record<string, Clip> } = { round: 0, byPlayer: {} };
const clipListeners = new Set<() => void>();
socket.on('dub:clips', (p: { round: number; clips: { playerId: string; mime: string; data: ArrayBuffer }[] }) => {
  if (p.round !== clips.round) for (const c of Object.values(clips.byPlayer)) URL.revokeObjectURL(c.url);
  const byPlayer: Record<string, Clip> = {};
  for (const c of p.clips) byPlayer[c.playerId] = { mime: c.mime, url: URL.createObjectURL(new Blob([c.data], { type: c.mime })) };
  clips = { round: p.round, byPlayer };
  clipListeners.forEach((f) => f());
});
function useClips(round: number) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    clipListeners.add(f);
    return () => void clipListeners.delete(f);
  }, []);
  return clips.round === round ? clips.byPlayer : {};
}

function useRemaining(endsAt: number | null) {
  const [ms, setMs] = useState(() => (endsAt ? Math.max(0, endsAt - serverNow()) : 0));
  useEffect(() => {
    const tick = () => setMs(endsAt ? Math.max(0, endsAt - serverNow()) : 0);
    tick();
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return ms;
}

// ---------- player do YouTube ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let ytApi: Promise<any> | null = null;
function loadYouTube(): Promise<any> {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return ytApi;
}

/**
 * Toca o trecho da cena. playAt = horário (relógio do servidor) em que começa;
 * quem chegar atrasado entra no ponto certo. Legendas em português ligadas.
 */
function VideoClip({ scene, playAt, muted, onPlay, onEnd, onTime }: {
  scene: DubScene;
  playAt: number | null;
  muted: boolean;
  onPlay?: (offsetS: number) => void;
  onEnd?: () => void;
  onTime?: (t: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const cb = useRef({ onPlay, onEnd, onTime });
  cb.current = { onPlay, onEnd, onTime };
  const ownLines = !!scene.lines?.length;
  const [blocked, setBlocked] = useState(false);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let dead = false;
    let started = false;
    let done = false;
    let poll = 0;
    const timers: number[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      try {
        playerRef.current?.pauseVideo();
      } catch { /* destruído */ }
      setEnded(true);
      cb.current.onEnd?.();
    };
    loadYouTube().then((YT) => {
      if (dead || !host.current) return;
      const el = document.createElement('div');
      host.current.appendChild(el);
      const player = new YT.Player(el, {
        videoId: scene.video,
        width: '100%',
        height: '100%',
        playerVars: {
          start: Math.floor(scene.start), end: Math.ceil(scene.end), controls: 0, disablekb: 1, fs: 0, rel: 0,
          iv_load_policy: 3, playsinline: 1, cc_load_policy: ownLines ? 0 : 1, cc_lang_pref: 'pt', hl: 'pt', autoplay: 0,
        },
        events: {
          onReady: () => {
            if (dead) return;
            // Sem som = volume 0 em vez de mute: o Chrome pausa vídeos mudos quando a aba
            // perde o foco, e a gravação não pode parar no meio.
            player.unMute();
            player.setVolume(muted ? 0 : 100);
            if (playAt == null) return;
            const go = () => {
              if (dead) return;
              const off = Math.max(0, (serverNow() - playAt) / 1000);
              if (off >= scene.end - scene.start) return finish();
              player.seekTo(scene.start + off, true);
              player.playVideo();
              timers.push(window.setTimeout(() => !started && !dead && setBlocked(true), 2500));
            };
            const wait = playAt - serverNow();
            if (wait > 0) timers.push(window.setTimeout(go, wait));
            else go();
          },
          onStateChange: (e: { data: number }) => {
            if (dead) return;
            if (e.data === YT.PlayerState.PLAYING && !started) {
              started = true;
              setBlocked(false);
              try {
                if (ownLines) player.unloadModule('captions');
                else {
                  player.loadModule('captions');
                  player.setOption('captions', 'track', { languageCode: 'pt' });
                }
              } catch { /* sem legenda */ }
              cb.current.onPlay?.(Math.max(0, player.getCurrentTime() - scene.start));
              poll = window.setInterval(() => {
                if (done) return;
                const t = player.getCurrentTime?.() ?? 0;
                cb.current.onTime?.(t);
                if (t >= scene.end - 0.05) finish();
              }, 50);
            }
            if (e.data === YT.PlayerState.ENDED && started) finish();
          },
        },
      });
      playerRef.current = player;
    });
    return () => {
      dead = true;
      clearInterval(poll);
      timers.forEach(clearTimeout);
      try {
        playerRef.current?.destroy();
      } catch { /* ignore */ }
      playerRef.current = null;
      if (host.current) host.current.innerHTML = '';
    };
  }, [scene.video, scene.start, scene.end, playAt, muted]);

  const waiting = useRemaining(playAt);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black">
      <div ref={host} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      {/* Bloqueia cliques no vídeo (pausar/abrir no YouTube). */}
      <div className="absolute inset-0" />
      {playAt != null && waiting > 0 && !ended && (
        <div className="absolute inset-0 grid place-items-center bg-black/55">
          <span className="pop-in font-display text-7xl text-sky">{Math.ceil(waiting / 1000)}</span>
        </div>
      )}
      {blocked && !ended && (
        <button
          onClick={() => {
            playerRef.current?.playVideo();
            setBlocked(false);
          }}
          className="absolute inset-0 grid cursor-pointer place-items-center bg-black/60 font-display text-2xl text-white"
        >
          ▶ Toque para assistir
        </button>
      )}
    </div>
  );
}

/** Vídeo + legenda de karaokê embaixo (quando a cena tem as falas com tempo). */
function SceneClip(props: Parameters<typeof VideoClip>[0]) {
  const { scene, playAt } = props;
  const [t, setT] = useState<number | null>(null);
  const lines = scene.lines;
  return (
    <div>
      <VideoClip
        {...props}
        onTime={(x) => {
          setT(x);
          props.onTime?.(x);
        }}
      />
      {lines?.length ? (playAt == null || t == null ? <Script lines={lines} /> : <Karaoke lines={lines} t={t} />) : null}
    </div>
  );
}

/** Roteiro completo, para ler antes de gravar. */
function Script({ lines }: { lines: [number, number, string][] }) {
  return (
    <div className="mt-3 max-h-44 overflow-y-auto rounded-2xl border border-line bg-ink/60 px-4 py-3">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Roteiro da cena</p>
      {lines.map(([, , text], i) => (
        <p key={i} className="text-sm leading-relaxed text-white/85">
          {text}
        </p>
      ))}
    </div>
  );
}

/**
 * Legenda de karaokê: a fala atual vai sendo pintada no ritmo em que deve ser dita,
 * a próxima aparece embaixo e uma barra avisa quando a próxima fala vai começar.
 */
function Karaoke({ lines, t }: { lines: [number, number, string][]; t: number }) {
  const idx = lines.findIndex(([a, b]) => t >= a && t < b);
  const nextIdx = idx >= 0 ? idx + 1 : lines.findIndex(([a]) => a > t);
  const cur = idx >= 0 ? lines[idx] : null;
  const next = nextIdx >= 0 && nextIdx < lines.length ? lines[nextIdx] : null;
  const progress = cur ? Math.min(100, ((t - cur[0]) / Math.max(0.3, cur[1] - cur[0])) * 100) : 0;
  // Aviso de "prepara" no último 1,5 s antes da próxima fala.
  const lead = !cur && next ? next[0] - t : null;
  const ready = lead != null && lead <= 1.5 ? 1 - lead / 1.5 : 0;
  return (
    <div className="mt-3 rounded-2xl border border-sky/30 bg-ink/80 px-4 py-4 text-center">
      <div className="flex min-h-[4.5rem] items-center justify-center">
        {cur ? (
          <p
            key={idx}
            className="font-display text-2xl leading-tight sm:text-4xl"
            style={{
              backgroundImage: `linear-gradient(90deg, var(--color-sky) ${progress}%, rgb(255 255 255 / 0.9) ${progress}%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {cur[2]}
          </p>
        ) : next ? (
          <div className="w-full">
            <p className="text-sm font-semibold tracking-wider text-muted uppercase">{ready > 0 ? 'Prepara…' : 'Pausa'}</p>
            <div className="mx-auto mt-2 h-2 w-48 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-sky" style={{ width: `${ready * 100}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-muted">🎬 Fim das falas</p>
        )}
      </div>
      <p className="mt-2 min-h-[1.5rem] truncate text-sm text-muted sm:text-base">{next ? <>Depois: <span className="text-white/70">{next[2]}</span></> : ''}</p>
    </div>
  );
}

// ---------- tela principal ----------

export default function DubGame(props: Props) {
  const { room } = props;
  const prev = useRef(room.phase);
  useEffect(() => {
    if (room.phase !== prev.current && (room.phase === 'watch' || room.phase === 'vote')) sfx.start();
    prev.current = room.phase;
  }, [room.phase]);

  if (room.phase === 'lobby') return <DubLobby {...props} />;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <section className="glass min-w-0 rounded-3xl p-4 sm:p-6">
        <SceneHeader room={room} />
        {room.phase === 'watch' && <WatchView room={room} isHost={props.isHost} />}
        {room.phase === 'record' && <RecordView key={room.round} {...props} />}
        {room.phase === 'show' && <ShowView key={`${room.round}-${room.showIndex}`} room={room} meId={props.meId} isHost={props.isHost} />}
        {room.phase === 'vote' && <VoteView key={room.round} room={room} meId={props.meId} />}
        {room.phase === 'results' && <ResultsView room={room} isHost={props.isHost} />}
        {room.phase === 'ended' && room.scene && <p className="mt-4 text-muted">Fim de jogo!</p>}
      </section>
      <DubScoreboard room={room} meId={props.meId} />
    </div>
  );
}

function SceneHeader({ room }: { room: DubPublicRoom }) {
  const remaining = useRemaining(room.endsAt);
  const labels: Record<string, string> = {
    watch: '🎬 Assista à cena original',
    record: '🎙️ Hora de dublar',
    show: '🍿 Sessão de dublagens',
    vote: '🗳️ Vote na melhor dublagem',
    results: '🏅 Resultado da rodada',
  };
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
          Rodada {room.round}/{room.settings.rounds} · {labels[room.phase] ?? ''}
        </p>
        <h2 className="font-display text-xl leading-tight sm:text-3xl">{room.scene?.title}</h2>
      </div>
      {room.endsAt && room.phase !== 'show' && room.phase !== 'watch' && (
        <span className={`font-display text-2xl tabular-nums ${remaining < 10_000 ? 'text-danger' : 'text-sky'}`}>
          {Math.ceil(remaining / 1000)}s
        </span>
      )}
    </div>
  );
}

function WatchView({ room, isHost }: { room: DubPublicRoom; isHost: boolean }) {
  return (
    <div>
      <SceneClip scene={room.scene!} playAt={room.startsAt} muted={false} />
      <p className="mt-3 text-sm text-muted">
        Preste atenção nas falas e no tempo: depois o vídeo volta <b className="text-white">sem som</b>, só com a legenda, e você grava a sua voz.
      </p>
      {isHost && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => socket.emit('dub:rewatch')} className="btn-secondary px-4 text-sm">
            🔁 Ver de novo
          </button>
          <button onClick={() => socket.emit('dub:skip')} className="btn-secondary px-4 text-sm">
            ⏭ Já vi, bora gravar
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- gravação ----------

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

type RecMode = 'idle' | 'count' | 'rec' | 'done' | 'preview' | 'sending' | 'sent';

function RecordView({ room, meId }: Props) {
  const me = room.players.find((p) => p.id === meId);
  const playing = !!me && !me.left;
  const [mode, setMode] = useState<RecMode>(me?.submitted ? 'sent' : 'idle');
  const [count, setCount] = useState(3);
  const [take, setTake] = useState(0);
  const [playAt, setPlayAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const result = useRef<{ blob: Blob; url: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    if (result.current) URL.revokeObjectURL(result.current.url);
  }, []);

  if (!playing) {
    return (
      <div>
        <SceneClip scene={room.scene!} playAt={null} muted />
        <p className="mt-4 text-center text-muted">Os jogadores estão gravando as dublagens… 🎙️</p>
      </div>
    );
  }

  async function record() {
    setError('');
    const mime = pickMime();
    if (mime === null) return setError('Seu navegador não consegue gravar áudio. Tente o Chrome.');
    try {
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return setError('Libere o microfone no navegador para gravar.');
    }
    setMode('count');
    for (let i = 3; i >= 1; i--) {
      setCount(i);
      sfx.tick(i === 1);
      await new Promise((r) => setTimeout(r, 800));
    }
    setTake((t) => t + 1);
    setPlayAt(serverNow());
    setMode('rec');
  }

  function startRecorder() {
    const mime = pickMime() || undefined;
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream.current!, { mimeType: mime, audioBitsPerSecond: 64_000 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      if (result.current) URL.revokeObjectURL(result.current.url);
      result.current = { blob, url: URL.createObjectURL(blob) };
      setMode('done');
    };
    rec.start(250);
    recorder.current = rec;
  }

  function stopRecorder() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function send() {
    const r = result.current;
    if (!r) return;
    if (r.blob.size > DUB_MAX_AUDIO_BYTES) return setError('A gravação ficou grande demais.');
    setMode('sending');
    const data = await r.blob.arrayBuffer();
    const res = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
      socket.timeout(45_000).emit('dub:audio', { round: room.round, mime: r.blob.type, data }, (err: unknown, res: { ok: boolean; error?: string }) =>
        resolve(err ? { ok: false, error: 'O envio demorou demais. Tente de novo.' } : res),
      ),
    );
    if (res.ok) {
      setMode('sent');
      sfx.correct();
    } else {
      setMode('done');
      setError(res.error ?? 'Não foi possível enviar.');
    }
  }

  return (
    <div>
      {mode === 'rec' ? (
        <div className="relative">
          <SceneClip key={`rec-${take}`} scene={room.scene!} playAt={playAt} muted onPlay={startRecorder} onEnd={stopRecorder} />
          <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-danger px-3 py-1 text-xs font-bold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> GRAVANDO
          </span>
        </div>
      ) : mode === 'preview' ? (
        <SceneClip
          key={`prev-${take}`}
          scene={room.scene!}
          playAt={playAt}
          muted
          onPlay={(off) => {
            const a = audio.current!;
            a.src = result.current!.url;
            a.currentTime = off;
            void a.play();
          }}
          onEnd={() => {
            audio.current?.pause();
            setMode('done');
          }}
        />
      ) : (
        <div className="relative">
          <SceneClip scene={room.scene!} playAt={null} muted />
          {mode === 'count' && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-black/60">
              <span key={count} className="pop-in font-display text-8xl text-sky">{count}</span>
            </div>
          )}
        </div>
      )}
      <audio ref={audio} className="hidden" />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(mode === 'idle' || mode === 'done') && (
          <button onClick={record} className="btn-primary px-6 py-3 text-lg">
            🎙️ {mode === 'done' ? 'Gravar de novo' : 'Gravar minha dublagem'}
          </button>
        )}
        {mode === 'done' && (
          <>
            <button
              onClick={() => {
                setPlayAt(serverNow() + 300);
                setMode('preview');
              }}
              className="btn-secondary px-4 py-3"
            >
              ▶ Ouvir
            </button>
            <button onClick={send} className="btn-primary bg-ok px-6 py-3 text-lg">
              ✅ Enviar
            </button>
          </>
        )}
        {mode === 'rec' && (
          <button onClick={stopRecorder} className="btn-secondary px-4 py-3">
            ⏹ Parar
          </button>
        )}
        {mode === 'sending' && <span className="text-muted">Enviando…</span>}
        {mode === 'sent' && (
          <span className="rounded-xl bg-ok/15 px-4 py-3 font-semibold text-ok">✅ Dublagem enviada! Esperando os outros…</span>
        )}
      </div>
      {error && <p className="slide-in mt-3 text-sm text-danger">{error}</p>}
      {mode === 'idle' && (
        <p className="mt-3 text-sm text-muted">
          Ao gravar, a cena passa sem som e com legenda — fale junto com os personagens. Pode gravar quantas vezes quiser antes de enviar. Use fone se puder!
        </p>
      )}
    </div>
  );
}

// ---------- exibição ----------

/** Toca a cena muda com a gravação de um jogador por cima. */
function DubPlayback({ scene, clip, playAt, onEnd }: { scene: DubScene; clip?: Clip; playAt: number | null; onEnd?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [needTap, setNeedTap] = useState(false);
  return (
    <div className="relative">
      <SceneClip
        scene={scene}
        playAt={playAt}
        muted
        onPlay={(off) => {
          const a = audio.current;
          if (!a || !clip) return;
          a.currentTime = off;
          a.play().catch(() => setNeedTap(true));
        }}
        onEnd={() => {
          audio.current?.pause();
          onEnd?.();
        }}
      />
      <audio ref={audio} src={clip?.url} preload="auto" className="hidden" />
      {!clip && <p className="mt-2 text-center text-sm text-muted">Carregando a gravação…</p>}
      {needTap && (
        <button
          onClick={() => {
            void audio.current?.play();
            setNeedTap(false);
          }}
          className="absolute inset-0 grid cursor-pointer place-items-center rounded-2xl bg-black/60 font-display text-2xl text-white"
        >
          🔊 Toque para ouvir
        </button>
      )}
    </div>
  );
}

function ShowView({ room, meId, isHost }: { room: DubPublicRoom; meId: string; isHost: boolean }) {
  const byPlayer = useClips(room.round);
  const id = room.showOrder[room.showIndex];
  const p = room.players.find((x) => x.id === id);
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        {p && <Avatar emoji={p.avatar} id={p.id} size={40} />}
        <p className="font-display text-xl">
          Dublagem de <span className="text-sky">{p?.name ?? '?'}</span>
          {id === meId && <span className="text-muted"> (você)</span>}
        </p>
        <span className="ml-auto text-sm text-muted">
          {room.showIndex + 1}/{room.showOrder.length}
        </span>
      </div>
      <DubPlayback scene={room.scene!} clip={byPlayer[id]} playAt={room.startsAt} />
      {isHost && (
        <button onClick={() => socket.emit('dub:skip')} className="btn-secondary mt-3 px-4 text-sm">
          ⏭ Próxima
        </button>
      )}
    </div>
  );
}

function VoteView({ room, meId }: { room: DubPublicRoom; meId: string }) {
  const byPlayer = useClips(room.round);
  const me = room.players.find((p) => p.id === meId);
  const canVote = !!me && !me.left && room.showOrder.some((x) => x !== meId);
  const [vote, setVote] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ id: string; at: number } | null>(null);
  return (
    <div>
      {replay && (
        <div className="mb-4">
          <DubPlayback key={replay.at} scene={room.scene!} clip={byPlayer[replay.id]} playAt={replay.at} onEnd={() => setReplay(null)} />
        </div>
      )}
      <p className="mb-3 text-sm text-muted">
        {canVote ? 'Qual foi a melhor? Não vale votar em si mesmo.' : 'Os jogadores estão votando…'}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {room.showOrder.map((id) => {
          const p = room.players.find((x) => x.id === id);
          if (!p) return null;
          const mine = id === meId;
          const chosen = vote === id;
          return (
            <div key={id} className={`flex items-center gap-2.5 rounded-2xl border p-2.5 ${chosen ? 'border-sky bg-sky/10' : 'border-line bg-panel/60'}`}>
              <Avatar emoji={p.avatar} id={p.id} size={36} />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {p.name}
                {mine && <span className="text-muted"> (você)</span>}
              </span>
              <button onClick={() => setReplay({ id, at: serverNow() + 400 })} className="btn-icon" title="Ouvir de novo" aria-label="Ouvir de novo">
                ▶
              </button>
              {canVote && !mine && (
                <button
                  onClick={() => {
                    setVote(id);
                    socket.emit('dub:vote', id);
                  }}
                  className={`chip px-3 py-1.5 text-sm ${chosen ? 'chip-on' : ''}`}
                >
                  {chosen ? '⭐ Votado' : 'Votar'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultsView({ room, isHost }: { room: DubPublicRoom; isHost: boolean }) {
  const rows = room.showOrder
    .map((id) => ({ p: room.players.find((x) => x.id === id), n: room.votes?.[id] ?? 0 }))
    .filter((r) => r.p)
    .sort((a, b) => b.n - a.n);
  const best = rows[0]?.n ?? 0;
  return (
    <div>
      <ul className="space-y-2">
        {rows.map(({ p, n }) => (
          <li key={p!.id} className={`pop-in flex items-center gap-3 rounded-2xl px-3 py-2.5 ${best > 0 && n === best ? 'bg-sky/15 ring-1 ring-sky/50' : 'bg-panel-2'}`}>
            <Avatar emoji={p!.avatar} id={p!.id} size={40} />
            <span className="min-w-0 flex-1 truncate font-display text-lg">
              {best > 0 && n === best && '👑 '}
              {p!.name}
            </span>
            <span className="text-sm text-muted">
              {n} {n === 1 ? 'voto' : 'votos'}
            </span>
            <span className="font-display text-lg text-sky">+{n + (best > 0 && n === best ? 1 : 0)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Cada voto vale 1 ponto e a dublagem mais votada ganha +1.</p>
      {isHost && (
        <button onClick={() => socket.emit('dub:skip')} className="btn-primary mt-4 px-6 py-3">
          {room.round >= room.settings.rounds ? 'Ver campeão' : 'Próxima cena'}
        </button>
      )}
    </div>
  );
}

function DubScoreboard({ room, meId }: { room: DubPublicRoom; meId: string }) {
  const rows = [...room.players].sort((a, b) => b.score - a.score);
  return (
    <aside className="glass h-fit rounded-2xl p-4">
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Placar</h3>
      <ul className="space-y-2.5">
        {rows.map((p) => (
          <li key={p.id} className={`flex items-center gap-2.5 ${p.left ? 'opacity-50' : ''}`}>
            <Avatar emoji={p.avatar} id={p.id} size={30} dim={!p.connected} />
            <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${p.id === meId ? 'text-sky' : ''}`}>{p.name}</span>
            {room.phase === 'record' && <span className="text-xs">{p.submitted ? '✅' : '🎙️'}</span>}
            {room.phase === 'vote' && <span className="text-xs">{p.voted ? '🗳️' : '🤔'}</span>}
            <span className="font-display text-lg tabular-nums">{p.score}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ---------- sala de espera ----------

function DubLobby({ room, meId, isHost, onCopy }: Props) {
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
          {room.players.length}/{room.settings.maxPlayers} dubladores
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
          Todo mundo assiste a uma cena famosa com o áudio original. Depois a cena volta <b className="text-white">sem som e com legenda</b> e cada um
          grava a sua dublagem pelo microfone — pode ser séria ou zoeira. No fim, as dublagens passam uma por uma para todos e cada um vota na melhor:{' '}
          <b className="text-sky">1 ponto por voto</b> e <b className="text-sky">+1</b> para a mais votada da rodada. Use fone de ouvido para a gravação
          sair limpa!
        </div>

        {isHost && <SceneQueue room={room} />}
      </section>

      <aside className="glass flex flex-col rounded-3xl p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Configurações</h2>
        <DubSettingsPanel room={room} editable={isHost} />
        {!isHost && <p className="mt-3 text-xs text-muted">Somente o anfitrião ({room.hostName}) altera as configurações.</p>}
        <div className="mt-auto pt-6">
          {isHost ? (
            <>
              <button onClick={start} disabled={ready < 2} className="btn-primary w-full py-4 text-xl">
                Começar a Dublagem
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

/** Anfitrião pode escolher cenas próprias do YouTube (entram antes das sorteadas). */
function SceneQueue({ room }: { room: DubPublicRoom }) {
  const [link, setLink] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  const inputRef: MutableRefObject<HTMLInputElement | null> = useRef(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const res = await emitAck<{ ok: boolean; error?: string }>('dub:scene', { link, start, end });
    if (res.ok) {
      setLink('');
      setStart('');
      setEnd('');
      setError('');
      inputRef.current?.focus();
    } else setError(res.error ?? 'Não deu para adicionar.');
  }

  return (
    <div className="mt-6 rounded-2xl border border-line p-4">
      <p className="mb-1 text-sm font-semibold">🎞️ Escolher cenas (opcional)</p>
      <p className="mb-3 text-xs text-muted">
        Cole um link do YouTube e o trecho (até {DUB_MAX_CLIP_S}s). Sem cenas na fila, sorteamos clássicos com legenda. A legenda só aparece se o vídeo
        tiver legenda em português.
      </p>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input ref={inputRef} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtube.com/watch?v=…" className="input min-w-0 flex-[3_1_220px]" />
        <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="início 0:10" className="input w-28 flex-1" />
        <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="fim 0:40" className="input w-28 flex-1" />
        <button disabled={!link.trim()} className="btn-secondary px-4">Adicionar</button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {room.queue.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {room.queue.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg bg-panel-2 px-3 py-1.5 text-sm">
              <span className="text-muted">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">youtu.be/{s.video} · {fmt(s.start)}–{fmt(s.end)}</span>
              <button onClick={() => socket.emit('dub:scene-remove', i)} className="cursor-pointer text-muted hover:text-danger" aria-label="Remover">
                <IconX width={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function DubSettingsPanel({ room, editable }: { room: DubPublicRoom; editable: boolean }) {
  const s = room.settings;
  const set = (patch: Partial<DubSettings>) => editable && socket.emit('room:settings', patch);
  const chip = (on: boolean) => `chip ${on ? 'chip-on' : editable ? '' : 'opacity-60'}`;
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Cenas por partida</p>
        <div className="flex gap-2">
          {DUB_ROUNDS.map((n) => (
            <button key={n} disabled={!editable} onClick={() => set({ rounds: n })} className={`${chip(s.rounds === n)} flex-1`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Máximo de jogadores</p>
        <div className="flex gap-2">
          {DUB_MAX_PLAYERS.map((n) => (
            <button key={n} disabled={!editable || n < room.players.length} onClick={() => set({ maxPlayers: n })} className={`${chip(s.maxPlayers === n)} flex-1`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-panel-2 p-3 text-xs text-muted">
        <DubMark className="h-10 w-10 shrink-0" />
        Precisa de microfone. Funciona melhor no Chrome, com fone de ouvido.
      </div>
    </div>
  );
}
