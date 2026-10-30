import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { AVATARS, type JoinResult, type Settings } from '../shared/types.ts';
import { NAME_INDEXES } from './names.ts';
import { Room } from './room.ts';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIST = path.join(ROOT, 'dist', 'client');
const ROOM_TTL_MS = 30 * 60_000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 10_000, pingTimeout: 8_000 });
const rooms = new Map<string, Room>();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    players: NAME_INDEXES.players.entities.length,
    clubs: NAME_INDEXES.clubs.entities.length,
  });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // Links de convite (/s/ABCD) e demais rotas caem no app React.
  app.get(/^\/(?!socket\.io|api).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I/O para evitar confusão
  for (;;) {
    const code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    if (!rooms.has(code)) return code;
  }
}

function cleanName(raw: unknown) {
  return String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
}

function cleanAvatar(raw: unknown) {
  return AVATARS.includes(String(raw)) ? String(raw) : AVATARS[0];
}

function removeRoom(room: Room) {
  room.destroy();
  rooms.delete(room.code);
}

interface SocketData {
  code?: string;
  memberId?: string;
}

function current(socket: Socket) {
  const data = socket.data as SocketData;
  const room = data.code ? rooms.get(data.code) : undefined;
  return { room, memberId: data.memberId ?? '' };
}

function attach(socket: Socket, room: Room, memberId: string) {
  const prev = current(socket);
  if (prev.room && prev.room !== room) {
    prev.room.leave(prev.memberId);
    socket.leave(prev.room.code);
  }
  socket.data = { code: room.code, memberId } satisfies SocketData;
  socket.join(room.code);
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload: { name?: string; avatar?: string }, ack?: (r: JoinResult) => void) => {
    const name = cleanName(payload?.name);
    if (!name) return ack?.({ ok: false, error: 'Escolha um apelido.' });
    const room = new Room(newCode(), io, removeRoom);
    rooms.set(room.code, room);
    const m = room.addMember(name, cleanAvatar(payload?.avatar), socket.id);
    if (typeof m === 'string') return ack?.({ ok: false, error: m });
    attach(socket, room, m.id);
    ack?.({ ok: true, code: room.code, memberId: m.id, token: m.token });
    room.broadcast();
  });

  socket.on(
    'room:join',
    (payload: { code?: string; name?: string; avatar?: string; token?: string }, ack?: (r: JoinResult) => void) => {
      const code = String(payload?.code ?? '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return ack?.({ ok: false, error: 'Sala não encontrada. Confira o código.' });

      // Reconexão (atualizou a página ou caiu a internet).
      const existing = payload?.token ? room.findByToken(String(payload.token)) : undefined;
      if (existing) {
        if (existing.socketId && existing.socketId !== socket.id) io.sockets.sockets.get(existing.socketId)?.disconnect();
        room.reconnect(existing, socket.id);
        attach(socket, room, existing.id);
        ack?.({ ok: true, code, memberId: existing.id, token: existing.token });
        return room.broadcast();
      }

      const name = cleanName(payload?.name);
      if (!name) return ack?.({ ok: false, error: 'Escolha um apelido.' });
      const m = room.addMember(name, cleanAvatar(payload?.avatar), socket.id);
      if (typeof m === 'string') return ack?.({ ok: false, error: m });
      attach(socket, room, m.id);
      ack?.({ ok: true, code, memberId: m.id, token: m.token });
      room.broadcast();
    },
  );

  socket.on('room:leave', () => {
    const { room, memberId } = current(socket);
    if (!room) return;
    socket.leave(room.code);
    socket.data = {};
    room.leave(memberId);
  });

  socket.on('room:settings', (patch: Partial<Settings>) => {
    const { room, memberId } = current(socket);
    room?.updateSettings(memberId, patch ?? {});
  });

  socket.on('room:seat', (take: boolean) => {
    const { room, memberId } = current(socket);
    if (take) room?.claimSeat(memberId);
    else room?.leaveSeat(memberId);
  });

  socket.on('game:start', (ack?: (r: { ok: boolean; error?: string }) => void) => {
    const { room, memberId } = current(socket);
    const error = room ? room.start(memberId) : 'Sala não encontrada.';
    ack?.({ ok: !error, error: error ?? undefined });
  });

  socket.on('game:restart', (startNow: boolean, ack?: (r: { ok: boolean; error?: string }) => void) => {
    const { room, memberId } = current(socket);
    const error = room ? room.restart(memberId, !!startNow) : 'Sala não encontrada.';
    ack?.({ ok: !error, error: error ?? undefined });
  });

  socket.on('game:answer', (text: string, ack?: (r: unknown) => void) => {
    const { room, memberId } = current(socket);
    ack?.(room ? room.answer(memberId, text) : { ok: false, reason: 'Sala não encontrada.' });
  });

  socket.on('game:typing', (text: string) => {
    const { room, memberId } = current(socket);
    room?.typing(memberId, text);
  });

  socket.on('disconnect', () => {
    const { room } = current(socket);
    room?.disconnect(socket.id);
  });
});

// Limpa salas abandonadas.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const nobody = !room.members.some((m) => m.connected);
    if (nobody && now - room.lastActivity > 2 * 60_000) removeRoom(room);
    else if (now - room.lastActivity > ROOM_TTL_MS && room.phase !== 'playing') removeRoom(room);
  }
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚽💣 FutBomb rodando em http://localhost:${PORT}`);
  console.log(`   Banco: ${NAME_INDEXES.players.entities.length} jogadores, ${NAME_INDEXES.clubs.entities.length} clubes`);
  if (!fs.existsSync(CLIENT_DIST)) console.log('   (modo dev: abra o front-end em http://localhost:5173)');
});
