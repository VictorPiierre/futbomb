import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SomEntry } from '../../../shared/som-library';
import { emitAck, socket } from '../net';
import { decodeFile, loadSound, playAudio, renderTrim, useNowPlaying } from '../som-audio';
import { sfx } from '../sound';
import { SomMark } from './Icons';

const KEY_STORE = 'futbomb:admin';
const EMOJIS = ['🔊', '😂', '💀', '🤡', '😱', '🔥', '💥', '🐸', '🐐', '🎤', '🏎️', '👽', '🤖', '💨', '🗿', '📯', '🎌', '🐱', '🎸', '🥁'];
const MAX_LEN = 2;
const TITLE_MAX = 40;

type Res = { ok: boolean; error?: string; sounds?: SomEntry[]; configured?: boolean };

const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
};
const saveKey = (k: string | null) => {
  try {
    if (k) localStorage.setItem(KEY_STORE, k);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
};

/** Página /admin: só o dono do site (com a senha) salva sons novos no "Faz Esse Som!" para sempre. */
export default function SomAdmin() {
  const [key, setKey] = useState(readKey);
  const [logged, setLogged] = useState(false);
  const [sounds, setSounds] = useState<SomEntry[]>([]);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(!!readKey());

  async function login(k: string) {
    setChecking(true);
    const res = await emitAck<Res>('admin:login', k);
    setChecking(false);
    if (res.ok) {
      saveKey(k);
      setLogged(true);
      setSounds(res.sounds ?? []);
      setError('');
    } else {
      saveKey(null);
      setLogged(false);
      setError(res.error ?? 'Não deu para entrar.');
    }
  }

  // Lembra a senha neste navegador.
  useEffect(() => {
    const k = readKey();
    if (!k) return;
    const go = () => void login(k);
    if (socket.connected) go();
    else socket.once('connect', go);
  }, []);

  function logout() {
    saveKey(null);
    setKey('');
    setLogged(false);
  }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <SomMark className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wider text-muted uppercase">Área do dono · só com senha</p>
          <h1 className="font-display text-2xl text-sky sm:text-3xl">Sons do Faz Esse Som!</h1>
        </div>
        <a href="/" className="btn-secondary px-3 text-sm">
          ← Jogatina
        </a>
      </div>

      {!logged ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (key) void login(key);
          }}
          className="glass rounded-3xl p-5"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold tracking-wider text-muted uppercase">Senha</span>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 outline-none focus:border-sky"
            />
          </label>
          <button disabled={!key || checking} className="btn-primary mt-3 w-full py-3">
            {checking ? 'Conferindo…' : 'Entrar'}
          </button>
          {error && <p className="slide-in mt-3 text-sm text-danger">{error}</p>}
        </form>
      ) : (
        <>
          <Upload adminKey={key} onSaved={setSounds} />
          <SavedList adminKey={key} sounds={sounds} onChange={setSounds} />
          <button onClick={logout} className="mt-6 w-full cursor-pointer py-2 text-sm text-muted hover:text-white">
            Sair deste navegador
          </button>
        </>
      )}
    </div>
  );
}

function Upload({ adminKey, onSaved }: { adminKey: string; onSaved: (s: SomEntry[]) => void }) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(1.2);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🔊');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const nowPlaying = useNowPlaying();

  async function pickFile(file: File | undefined) {
    setError('');
    setOk('');
    if (!file) return;
    if (file.size > 50_000_000) return setError('Arquivo grande demais (máx. 50 MB).');
    try {
      const b = await decodeFile(file);
      setBuffer(b);
      setFileName(file.name);
      setStart(0);
      setLength(Math.min(1.2, b.duration));
      setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, TITLE_MAX));
    } catch {
      setError('Não consegui ler esse arquivo. Tente mp3, wav, ogg ou m4a (vídeo mp4 também costuma funcionar).');
    }
  }

  async function preview() {
    if (!buffer) return;
    const wav = await renderTrim(buffer, start, length);
    const ctx = new AudioContext();
    const b = await ctx.decodeAudioData(wav);
    void ctx.close();
    playAudio('admin-preview', b);
  }

  async function save() {
    if (!buffer || !title.trim()) return;
    setBusy(true);
    setError('');
    setOk('');
    const wav = await renderTrim(buffer, start, length);
    const res = await emitAck<Res>('admin:som-add', adminKey, { title, emoji }, wav);
    setBusy(false);
    if (res.sounds) onSaved(res.sounds);
    if (!res.ok) {
      sfx.wrong();
      return setError(res.error ?? 'Não deu para salvar.');
    }
    sfx.correct();
    setOk(`“${title.trim()}” foi salvo no jogo para sempre! Já entra no sorteio das próximas rodadas.`);
    setBuffer(null);
    setTitle('');
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const dur = buffer?.duration ?? 0;
  const maxStart = Math.max(0, dur - 0.3);
  const label = 'mb-1 block text-xs font-semibold tracking-wider text-muted uppercase';

  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="font-display text-xl">➕ Adicionar som</h2>
      <p className="mb-4 text-sm text-muted">Escolha um arquivo, marque o trecho (até 2s), dê um nome e salve. O volume é ajustado sozinho.</p>
      <label className="block">
        <span className={label}>Arquivo de áudio</span>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.ogg,.m4a,.aac,.webm,.opus,.mp4"
          onChange={(e) => void pickFile(e.target.files?.[0])}
          className="block w-full cursor-pointer text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:font-semibold file:text-white"
        />
      </label>

      {buffer && (
        <div className="pop-in mt-4 space-y-4">
          <p className="truncate text-xs text-muted">
            {fileName} · {dur.toFixed(1)}s
          </p>
          <div>
            <span className={`${label} flex justify-between`}>
              <span>Começa em</span> <span className="tabular-nums">{start.toFixed(2)}s</span>
            </span>
            <input type="range" min={0} max={maxStart} step={0.01} value={start} onChange={(e) => setStart(Number(e.target.value))} className="w-full accent-[var(--color-sky)]" disabled={maxStart === 0} />
          </div>
          <div>
            <span className={`${label} flex justify-between`}>
              <span>Duração</span> <span className="tabular-nums">{Math.min(length, dur - start).toFixed(2)}s</span>
            </span>
            <input type="range" min={0.3} max={MAX_LEN} step={0.05} value={length} onChange={(e) => setLength(Number(e.target.value))} className="w-full accent-[var(--color-sky)]" />
          </div>
          <button onClick={() => void preview()} className="btn-secondary w-full py-2.5">
            {nowPlaying === 'admin-preview' ? '🔊 Tocando…' : '▶ Ouvir o trecho'}
          </button>

          <label className="block">
            <span className={label}>Nome do som</span>
            <input
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 outline-none focus:border-sky"
            />
          </label>
          <div>
            <span className={label}>Emoji</span>
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => setEmoji(e)} className={`grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-xl ${emoji === e ? 'bg-sky/30 ring-2 ring-sky' : 'bg-panel-2'}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => void save()} disabled={busy || !title.trim()} className="btn-primary w-full py-3 text-lg">
            {busy ? 'Salvando no jogo…' : '💾 Salvar no jogo'}
          </button>
        </div>
      )}
      {error && <p className="slide-in mt-3 text-sm text-danger">{error}</p>}
      {ok && <p className="slide-in mt-3 text-sm text-ok">{ok}</p>}
    </section>
  );
}

function SavedList({ adminKey, sounds, onChange }: { adminKey: string; sounds: SomEntry[]; onChange: (s: SomEntry[]) => void }) {
  const nowPlaying = useNowPlaying();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function remove(s: SomEntry) {
    if (!window.confirm(`Apagar “${s.title}” do jogo? Isso não dá para desfazer.`)) return;
    setBusy(s.id);
    const res = await emitAck<Res>('admin:som-remove', adminKey, s.id);
    setBusy('');
    if (res.sounds) onChange(res.sounds);
    setError(res.ok ? '' : (res.error ?? 'Não deu para apagar.'));
  }

  return (
    <section className="glass mt-5 rounded-3xl p-5">
      <h2 className="font-display text-xl">📁 Seus sons salvos ({sounds.length})</h2>
      {sounds.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nenhum ainda. Os que você salvar aparecem aqui e entram no sorteio do jogo.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {[...sounds].reverse().map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 rounded-xl bg-ink/40 px-3 py-2">
              <button onClick={async () => playAudio(s.id, await loadSound(s.id, s.file))} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full bg-sky/20 text-sky" aria-label={`Ouvir ${s.title}`}>
                {nowPlaying === s.id ? '🔊' : '▶'}
              </button>
              <span className="text-xl">{s.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.title}</span>
                <span className="block truncate text-xs text-muted">{s.file}</span>
              </span>
              <button disabled={busy === s.id} onClick={() => void remove(s)} className="cursor-pointer px-1 text-muted hover:text-danger disabled:opacity-50" aria-label={`Apagar ${s.title}`} title="Apagar">
                {busy === s.id ? '…' : '🗑️'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
