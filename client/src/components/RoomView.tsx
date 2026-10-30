import { useEffect, useRef, useState } from 'react';
import type { GameFx, PublicRoom } from '../../../shared/types';
import { inviteLink, useSocketEvent } from '../net';
import { isSoundOn, setSoundOn, sfx } from '../sound';
import Arena from './Arena';
import { IconCopy, IconGear, IconLogout, IconMute, IconVolume, IconX, Logo } from './Icons';
import Lobby, { SettingsPanel } from './Lobby';
import Victory from './Victory';

interface Props {
  room: PublicRoom;
  meId: string;
  connected: boolean;
  onLeave: () => void;
}

export default function RoomView({ room, meId, connected, onLeave }: Props) {
  const [sound, setSound] = useState(isSoundOn());
  const [toast, setToast] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const toastTimer = useRef<number>(undefined);

  const notify = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2200);
  };

  async function copyInvite() {
    const link = inviteLink(room.code);
    try {
      await navigator.clipboard.writeText(link);
      notify('Link de convite copiado!');
    } catch {
      window.prompt('Copie o link de convite:', link);
    }
  }

  // Sons de eventos gerais da partida.
  useSocketEvent<GameFx>('game:fx', (fx) => {
    if (fx.type === 'start') sfx.start();
    if (fx.type === 'winner') sfx.win();
  });

  useEffect(() => {
    document.title = room.phase === 'playing' && room.game ? `Letra ${room.game.letter} · FutBomb` : `Sala #${room.code} · FutBomb`;
  }, [room.phase, room.game?.letter, room.code]);

  const me = room.players.find((p) => p.id === meId);
  const isHost = room.hostId === meId;
  const status =
    room.phase === 'playing'
      ? { label: 'AO VIVO', cls: 'bg-lime/15 text-lime border-lime/30' }
      : room.phase === 'ended'
        ? { label: 'FIM DE JOGO', cls: 'bg-violet/15 text-violet-soft border-violet/30' }
        : { label: 'SALA DE ESPERA', cls: 'bg-panel-2 text-muted border-line' };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Logo />
          <div className="mx-auto hidden min-w-0 flex-col items-center leading-tight sm:flex">
            <span className="truncate text-sm font-semibold">Sala de {room.hostName || '—'}</span>
            <span className="font-display text-xs text-violet-soft">#{room.code}</span>
          </div>
          <span className="ml-auto font-display text-xs text-violet-soft sm:hidden">#{room.code}</span>
          <span className={`hidden rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wider sm:inline-block ${status.cls}`}>
            {room.phase === 'playing' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-lime align-middle" />}
            {status.label}
          </span>
          <div className="flex items-center gap-1.5">
            <button className="btn-icon" onClick={copyInvite} title="Copiar convite" aria-label="Copiar convite">
              <IconCopy width={17} />
            </button>
            <button
              className="btn-icon"
              onClick={() => {
                setSoundOn(!sound);
                setSound(!sound);
              }}
              title={sound ? 'Desativar sons' : 'Ativar sons'}
              aria-label={sound ? 'Desativar sons' : 'Ativar sons'}
            >
              {sound ? <IconVolume width={17} /> : <IconMute width={17} />}
            </button>
            <button className="btn-icon" onClick={() => setShowSettings(true)} title="Configurações" aria-label="Configurações">
              <IconGear width={17} />
            </button>
          </div>
        </div>
        {!connected && (
          <div className="bg-danger/90 py-1 text-center text-xs font-semibold text-white">Conexão perdida — reconectando…</div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">
        {room.phase === 'lobby' ? (
          <Lobby room={room} meId={meId} isHost={isHost} onCopy={copyInvite} />
        ) : (
          <Arena room={room} meId={meId} me={me} />
        )}
      </main>

      {room.phase === 'ended' && <Victory room={room} meId={meId} isHost={isHost} />}

      {showSettings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="pop-in w-full max-w-md rounded-3xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg">Configurações da sala</h2>
              <button className="btn-icon" onClick={() => setShowSettings(false)} aria-label="Fechar">
                <IconX width={16} />
              </button>
            </div>
            <SettingsPanel room={room} editable={isHost && room.phase === 'lobby'} />
            {!(isHost && room.phase === 'lobby') && (
              <p className="mt-3 text-xs text-muted">
                {isHost ? 'As configurações só podem ser alteradas antes da partida.' : 'Somente o anfitrião altera as configurações.'}
              </p>
            )}
            <button
              onClick={onLeave}
              className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-danger/40 bg-danger/10 py-2.5 font-semibold text-danger transition hover:bg-danger/20"
            >
              <IconLogout width={17} /> Sair da sala
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="slide-in fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-lime px-4 py-2 text-sm font-bold text-ink shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
