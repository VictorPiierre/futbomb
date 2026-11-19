import { useRef, useState } from 'react';
import { SOM_CUSTOM_MAX, SOM_CUSTOM_TITLE_MAX, type SomPublicRoom } from '../../../shared/som';
import { SOM_CATEGORIES, SOM_DIFFICULTIES, type SomCategory, type SomDifficulty } from '../../../shared/som-library';
import { emitAck, socket } from '../net';
import { decodeFile, loadSound, playAudio, renderTrim, useNowPlaying } from '../som-audio';
import { sfx } from '../sound';

const EMOJIS = ['🔊', '😂', '💀', '🤡', '😱', '🔥', '💥', '🐸', '🐐', '🎤', '🏎️', '👽', '🤖', '💨', '🗿', '📯'];
const MAX_LEN = 2;

/** "Sons da sala": qualquer jogador envia um áudio (cortado em até 2s) que entra no sorteio desta sala. */
export default function SomUpload({ room, meId, isHost }: { room: SomPublicRoom; meId: string; isHost: boolean }) {
  const [open, setOpen] = useState(false);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(1.2);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🔊');
  const [cat, setCat] = useState<SomCategory>('meme');
  const [diff, setDiff] = useState<SomDifficulty>('dificil');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const nowPlaying = useNowPlaying();
  const sounds = room.customSounds;
  const full = sounds.length >= SOM_CUSTOM_MAX;
  const canAdd = room.phase === 'lobby' || room.phase === 'ended';

  async function pickFile(file: File | undefined) {
    setError('');
    setOk('');
    if (!file) return;
    if (file.size > 25_000_000) return setError('Arquivo grande demais (máx. 25 MB).');
    try {
      const b = await decodeFile(file);
      setBuffer(b);
      setFileName(file.name);
      setStart(0);
      setLength(Math.min(1.2, b.duration));
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, SOM_CUSTOM_TITLE_MAX));
    } catch {
      setError('Não consegui ler esse arquivo. Tente um mp3, wav, ogg ou m4a.');
    }
  }

  async function preview() {
    if (!buffer) return;
    const wav = await renderTrim(buffer, start, length);
    const ctx = new AudioContext();
    const b = await ctx.decodeAudioData(wav);
    void ctx.close();
    playAudio('upload-preview', b);
  }

  async function send() {
    if (!buffer || !title.trim()) return;
    setBusy(true);
    setError('');
    const wav = await renderTrim(buffer, start, length);
    const res = await emitAck<{ ok: boolean; error?: string }>('som:add-sound', { title, emoji, cat, diff }, wav);
    setBusy(false);
    if (!res.ok) {
      sfx.wrong();
      return setError(res.error ?? 'Não deu para enviar.');
    }
    sfx.correct();
    setOk(`“${title.trim()}” entrou no sorteio desta sala!`);
    setBuffer(null);
    setTitle('');
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const dur = buffer?.duration ?? 0;
  const maxStart = Math.max(0, dur - 0.3);

  return (
    <div className="mt-6 rounded-2xl border border-spark/30 bg-spark/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-spark">📁 Sons da sala ({sounds.length})</p>
        {canAdd && !full && (
          <button onClick={() => setOpen((o) => !o)} className="btn-secondary px-3 py-1.5 text-sm">
            {open ? 'Fechar' : '➕ Adicionar áudio'}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        Envie seus próprios sons absurdos: eles entram no sorteio desta sala (no “misturado” aparecem com prioridade). Ficam salvos enquanto a sala existir.
      </p>

      {open && canAdd && (
        <div className="pop-in mt-3 space-y-3 rounded-xl bg-ink/40 p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wider text-muted uppercase">Arquivo de áudio</span>
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm,.opus"
              onChange={(e) => void pickFile(e.target.files?.[0])}
              className="block w-full cursor-pointer text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:font-semibold file:text-white"
            />
          </label>

          {buffer && (
            <>
              <p className="truncate text-xs text-muted">
                {fileName} · {dur.toFixed(1)}s
              </p>
              <div>
                <span className="mb-1 flex justify-between text-xs font-semibold tracking-wider text-muted uppercase">
                  <span>Começa em</span> <span className="tabular-nums">{start.toFixed(2)}s</span>
                </span>
                <input type="range" min={0} max={maxStart} step={0.01} value={start} onChange={(e) => setStart(Number(e.target.value))} className="w-full accent-[var(--color-spark)]" disabled={maxStart === 0} />
              </div>
              <div>
                <span className="mb-1 flex justify-between text-xs font-semibold tracking-wider text-muted uppercase">
                  <span>Duração</span> <span className="tabular-nums">{Math.min(length, dur - start).toFixed(2)}s</span>
                </span>
                <input type="range" min={0.3} max={MAX_LEN} step={0.05} value={length} onChange={(e) => setLength(Number(e.target.value))} className="w-full accent-[var(--color-spark)]" />
              </div>
              <button onClick={() => void preview()} className="btn-secondary w-full py-2 text-sm">
                {nowPlaying === 'upload-preview' ? '🔊 Tocando…' : '▶ Ouvir o trecho'}
              </button>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold tracking-wider text-muted uppercase">Nome do som</span>
                <input
                  value={title}
                  maxLength={SOM_CUSTOM_TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Grito do primo no churrasco"
                  className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-spark"
                />
              </label>
              <div>
                <span className="mb-1 block text-xs font-semibold tracking-wider text-muted uppercase">Emoji</span>
                <div className="flex flex-wrap gap-1">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => setEmoji(e)} className={`grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-xl ${emoji === e ? 'bg-spark/30 ring-2 ring-spark' : 'bg-panel-2'}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-muted uppercase">Tema</span>
                  <select value={cat} onChange={(e) => setCat(e.target.value as SomCategory)} className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm">
                    {(Object.keys(SOM_CATEGORIES) as SomCategory[]).map((c) => (
                      <option key={c} value={c}>
                        {SOM_CATEGORIES[c].emoji} {SOM_CATEGORIES[c].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold tracking-wider text-muted uppercase">Dificuldade</span>
                  <select value={diff} onChange={(e) => setDiff(e.target.value as SomDifficulty)} className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm">
                    {(Object.keys(SOM_DIFFICULTIES) as SomDifficulty[]).map((d) => (
                      <option key={d} value={d}>
                        {SOM_DIFFICULTIES[d].emoji} {SOM_DIFFICULTIES[d].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-[11px] text-muted">
                O volume é ajustado automaticamente (até áudio estourado fica num volume seguro). Envie só áudios que você pode usar.
              </p>
              <button onClick={() => void send()} disabled={busy || !title.trim()} className="btn-primary w-full py-2.5">
                {busy ? 'Enviando…' : 'Adicionar à sala'}
              </button>
            </>
          )}
          {error && <p className="slide-in text-sm text-danger">{error}</p>}
        </div>
      )}
      {ok && <p className="slide-in mt-2 text-sm text-ok">{ok}</p>}

      {sounds.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {sounds.map((snd) => (
            <li key={snd.id} className="flex items-center gap-2 rounded-xl bg-ink/40 px-2.5 py-1.5 text-sm">
              <button onClick={async () => playAudio(snd.id, await loadSound(snd.id))} className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-spark/20 text-spark" aria-label={`Ouvir ${snd.title}`}>
                {nowPlaying === snd.id ? '🔊' : '▶'}
              </button>
              <span className="text-lg">{snd.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{snd.title}</span>
                <span className="block truncate text-[11px] text-muted">
                  {SOM_CATEGORIES[snd.cat].label} · {SOM_DIFFICULTIES[snd.diff].emoji} {SOM_DIFFICULTIES[snd.diff].label} · por {snd.byName}
                </span>
              </span>
              {(snd.byId === meId || isHost) && canAdd && (
                <button onClick={() => socket.emit('som:remove-sound', snd.id)} className="cursor-pointer px-1 text-muted hover:text-danger" aria-label={`Remover ${snd.title}`} title="Remover">
                  🗑️
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
