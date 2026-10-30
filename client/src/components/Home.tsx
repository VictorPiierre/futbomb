import { useState, type FormEvent } from 'react';
import { AVATARS } from '../../../shared/types';
import { BallBomb, Logo } from './Icons';

interface Props {
  initialCode: string;
  profile: { name: string; avatar: string };
  error: string;
  busy: boolean;
  connected: boolean;
  onCreate: (name: string, avatar: string) => void;
  onJoin: (code: string, name: string, avatar: string) => void;
}

export default function Home({ initialCode, profile, error, busy, connected, onCreate, onJoin }: Props) {
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [code, setCode] = useState(initialCode);
  const [localError, setLocalError] = useState('');
  const invited = initialCode.length === 4;

  function validName() {
    if (!name.trim()) {
      setLocalError('Escolha um apelido para jogar.');
      return false;
    }
    setLocalError('');
    return true;
  }

  function submitJoin(e?: FormEvent) {
    e?.preventDefault();
    if (!validName()) return;
    if (code.trim().length !== 4) return setLocalError('O código da sala tem 4 letras.');
    onJoin(code.trim().toUpperCase(), name.trim(), avatar);
  }

  const shownError = localError || error;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="pop-in w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 text-muted">A bomba está com você. Diga um animal, uma cor, um famoso, um craque… antes que ela exploda!</p>
        </div>

        <form onSubmit={submitJoin} className="glass rounded-3xl p-5 shadow-2xl shadow-black/40 sm:p-6">
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-muted uppercase">Seu apelido</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            placeholder="Ex.: Victor"
            autoFocus={!name}
            className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-lg font-semibold outline-none transition focus:border-lime/70 focus:ring-4 focus:ring-lime/10"
          />

          <label className="mt-5 mb-2 block text-xs font-semibold tracking-wider text-muted uppercase">Avatar</label>
          <div className="grid grid-cols-8 gap-1.5">
            {AVATARS.map((a) => (
              <button
                type="button"
                key={a}
                onClick={() => setAvatar(a)}
                aria-label={`Avatar ${a}`}
                className={`aspect-square rounded-full text-xl transition ${
                  avatar === a ? 'scale-110 bg-lime/20 ring-2 ring-lime' : 'bg-panel-2 hover:bg-line'
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          {invited ? (
            <>
              <div className="mt-6 rounded-xl border border-violet/40 bg-violet/10 px-4 py-3 text-sm">
                Você foi convidado para a sala <b className="font-display text-violet-soft">#{initialCode}</b>
              </div>
              <button disabled={busy || !connected} className="btn-primary mt-4 w-full">
                Entrar na sala
              </button>
              <button
                type="button"
                disabled={busy || !connected}
                onClick={() => validName() && onCreate(name.trim(), avatar)}
                className="mt-3 w-full text-sm text-muted underline-offset-4 hover:text-white hover:underline"
              >
                ou criar uma sala nova
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy || !connected}
                onClick={() => validName() && onCreate(name.trim(), avatar)}
                className="btn-primary mt-6 w-full"
              >
                Criar sala
              </button>
              <div className="my-5 flex items-center gap-3 text-xs text-muted uppercase">
                <span className="h-px flex-1 bg-line" /> ou entre com um código <span className="h-px flex-1 bg-line" />
              </div>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase())}
                  placeholder="ABCD"
                  className="w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-3 text-center font-display text-xl tracking-[0.4em] uppercase outline-none focus:border-violet/70 focus:ring-4 focus:ring-violet/15"
                />
                <button disabled={busy || !connected} className="btn-secondary px-5">
                  Entrar em sala
                </button>
              </div>
            </>
          )}

          {shownError && <p className="slide-in mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{shownError}</p>}
          {!connected && <p className="mt-4 text-center text-sm text-muted">Conectando ao servidor…</p>}
        </form>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs text-muted">
          <Rule n="1" text="Uma letra é sorteada" />
          <Rule n="2" text="Diga uma palavra do tema" />
          <Rule n="3" text="Não deixe a bomba explodir" />
        </div>
      </div>
      <BallBomb className="pointer-events-none fixed -right-16 -bottom-16 h-64 w-64 opacity-[0.04]" />
    </div>
  );
}

function Rule({ n, text }: { n: string; text: string }) {
  return (
    <div className="rounded-2xl border border-line/60 bg-panel/50 p-3">
      <div className="font-display text-lg text-lime">{n}</div>
      {text}
    </div>
  );
}
