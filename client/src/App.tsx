import { useCallback, useEffect, useState } from 'react';
import type { StopPublicRoom } from '../../shared/stop';
import type { GameKind, JoinResult, PublicRoom } from '../../shared/types';
import Home from './components/Home';
import RoomView from './components/RoomView';
import { codeFromPath, emitAck, loadProfile, loadSession, saveProfile, saveSession, socket, syncClock, useSocketEvent } from './net';

export default function App() {
  const [room, setRoom] = useState<PublicRoom | StopPublicRoom | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(() => {
    const s = loadSession();
    return !!s && s.code === codeFromPath();
  });

  useSocketEvent<PublicRoom | StopPublicRoom>('room:state', (state) => {
    syncClock(state.serverNow);
    setRoom(state);
  });

  const enter = useCallback((res: JoinResult) => {
    if (!res.ok || !res.code) {
      setError(res.error ?? 'Não foi possível entrar.');
      return false;
    }
    saveSession({ code: res.code, token: res.token! });
    setMeId(res.memberId!);
    setError('');
    if (codeFromPath() !== res.code) history.pushState(null, '', `/s/${res.code}`);
    return true;
  }, []);

  // A cada (re)conexão do socket, volta para a sala salva nesta aba.
  useEffect(() => {
    const rejoin = async () => {
      setConnected(true);
      const s = loadSession();
      if (!s || s.code !== codeFromPath()) return setRestoring(false);
      const res = await emitAck<JoinResult>('room:join', { code: s.code, token: s.token });
      if (!res.ok) {
        saveSession(null);
        setRoom(null);
        setMeId(null);
        setError('Sua sessão expirou. Entre novamente na sala.');
      } else enter(res);
      setRestoring(false);
    };
    const down = () => setConnected(false);
    if (socket.connected) void rejoin();
    socket.on('connect', rejoin);
    socket.on('disconnect', down);
    return () => {
      socket.off('connect', rejoin);
      socket.off('disconnect', down);
    };
  }, [enter]);

  // Botão "voltar" do navegador.
  useEffect(() => {
    const onPop = () => {
      if (room && codeFromPath() !== room.code) leave();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  async function create(name: string, avatar: string, game: GameKind) {
    saveProfile({ name, avatar });
    setBusy(true);
    enter(await emitAck<JoinResult>('room:create', { name, avatar, game }));
    setBusy(false);
  }

  async function join(code: string, name: string, avatar: string) {
    saveProfile({ name, avatar });
    setBusy(true);
    enter(await emitAck<JoinResult>('room:join', { code, name, avatar }));
    setBusy(false);
  }

  function leave() {
    socket.emit('room:leave');
    saveSession(null);
    setRoom(null);
    setMeId(null);
    if (location.pathname !== '/') history.pushState(null, '', '/');
  }

  if (room && meId && room.code === codeFromPath()) {
    return <RoomView room={room} meId={meId} connected={connected} onLeave={leave} />;
  }

  return (
    <Home
      initialCode={codeFromPath()}
      profile={loadProfile()}
      error={error}
      busy={busy || restoring}
      connected={connected}
      onCreate={create}
      onJoin={join}
    />
  );
}
