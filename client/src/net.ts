import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

/**
 * Conexão única com o servidor. Por padrão usa a mesma origem (no dev o Vite faz o proxy);
 * com o front-end hospedado à parte (ex.: Vercel), defina VITE_SERVER_URL no build.
 */
const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;
const options = { transports: ['websocket', 'polling'] };
export const socket = SERVER_URL ? io(SERVER_URL, options) : io(options);

let offset = 0;
/** Ajusta o relógio local pelo do servidor (cronômetro é sempre do servidor). */
export function syncClock(serverNow: number) {
  offset = serverNow - Date.now();
}
export function serverNow() {
  return Date.now() + offset;
}

export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [event]);
}

export function emitAck<T>(event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => socket.timeout(8000).emit(event, ...args, (err: unknown, res: T) => {
    resolve(err ? ({ ok: false, error: 'Sem resposta do servidor.', reason: 'Sem resposta do servidor.' } as T) : res);
  }));
}

// ---------- persistência local ----------
const SESSION_KEY = 'futbomb:session';
const PROFILE_KEY = 'futbomb:profile';

export interface Session {
  code: string;
  token: string;
}

// sessionStorage: cada aba é um jogador diferente, mas sobrevive a um F5.
export function loadSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* modo privado */
  }
}

export function loadProfile(): { name: string; avatar: string } {
  try {
    return { name: '', avatar: '💣', ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return { name: '', avatar: '💣' };
  }
}
export function saveProfile(p: { name: string; avatar: string }) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function codeFromPath() {
  const m = location.pathname.match(/^\/s\/([A-Za-z]{4})\/?$/);
  return m ? m[1].toUpperCase() : '';
}

export function inviteLink(code: string) {
  return `${location.origin}/s/${code}`;
}
