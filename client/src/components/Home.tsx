import { useState, type FormEvent } from 'react';
import { AVATARS, type GameKind } from '../../../shared/types';
import { BombMark, Logo, StopMark } from './Icons';

const GAMES: { id: GameKind; name: string; text: string; players: string }[] = [
  { id: 'pavio', name: 'Pavio Curto', text: 'A bomba passa de mão em mão: diga uma palavra do tema antes que ela exploda.', players: '2 a 4 jogadores' },
  { id: 'stop', name: 'Stop', text: 'Todos preenchem as categorias com a mesma letra. Quem terminar grita STOP!', players: '2 a 10 jogadores' },
];

interface Props {
  initialCode: string;
  profile: { name: string; avatar: string };
  error: string;
  busy: boolean;
  connected: boolean;
  onCreate: (name: string, avatar: string, game: GameKind) => void;
  onJoin: (code: string, name: string, avatar: string) => void;
}

export default function Home({ initialCode, profile, error, busy, connected, onCreate, onJoin }: Props) {
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [code, setCode] = useState(initialCode);
  const [game, setGame] = useState<GameKind>('pavio');
  const gameName = GAMES.find((g) => g.id === game)!.name;
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
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size="lg" game="hub" />
          <p className="mt-3 text-muted">Jogos de palavras para jogar com os amigos, em tempo real.</p>
        </div>

        {!invited && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            {GAMES.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGame(g.id)}
                className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-center transition sm:p-4 ${
                  game === g.id
                    ? g.id === 'stop' ? 'border-pop bg-pop/10' : 'border-fire bg-fire/10'
                    : 'border-line bg-panel/60 hover:border-line hover:bg-panel'
                }`}
              >
                {g.id === 'stop' ? <StopMark className="h-12 w-12" /> : <BombMark className="h-12 w-12" />}
                <span className={`font-display text-xl ${g.id === 'stop' ? 'text-pop' : 'text-fire'}`}>{g.name}</span>
                <span className="text-xs leading-snug text-muted">{g.text}</span>
                <span className="text-[11px] font-semibold text-muted/80">{g.players}</span>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submitJoin} className="glass rounded-3xl p-5 shadow-2xl shadow-black/40 sm:p-6">
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-muted uppercase">Seu apelido</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            placeholder="Ex.: Victor"
            autoFocus={!name}
            className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-lg font-semibold outline-none transition focus:border-fire/70 focus:ring-4 focus:ring-fire/10"
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
                  avatar === a ? 'scale-110 bg-fire/20 ring-2 ring-fire' : 'bg-panel-2 hover:bg-line'
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          {invited ? (
            <>
              <div className="mt-6 rounded-xl border border-pop/40 bg-pop/10 px-4 py-3 text-sm">
                Você foi convidado para a sala <b className="font-display text-pop-soft">#{initialCode}</b>
              </div>
              <button disabled={busy || !connected} className="btn-primary mt-4 w-full">
                Entrar na sala
              </button>
              <button
                type="button"
                disabled={busy || !connected}
                onClick={() => validName() && onCreate(name.trim(), avatar, game)}
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
                onClick={() => validName() && onCreate(name.trim(), avatar, game)}
                className="btn-primary mt-6 w-full"
              >
                Criar sala de {gameName}
              </button>
              <div className="my-5 flex items-center gap-3 text-xs text-muted uppercase">
                <span className="h-px flex-1 bg-line" /> ou entre com um código <span className="h-px flex-1 bg-line" />
              </div>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase())}
                  placeholder="ABCD"
                  className="w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-3 text-center font-display text-xl tracking-[0.4em] uppercase outline-none focus:border-pop/70 focus:ring-4 focus:ring-pop/15"
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

      </div>
      <BombMark className="pointer-events-none fixed -right-16 -bottom-16 h-64 w-64 opacity-[0.04]" />
      <StopMark className="pointer-events-none fixed -top-14 -left-14 h-52 w-52 opacity-[0.04]" />
    </div>
  );
}

