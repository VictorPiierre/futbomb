/**
 * Teste de ponta a ponta do Dublagem com 3 clientes reais (áudio falso).
 * Uso: com o servidor rodando -> npm run smoke:dub
 */
import { io, type Socket } from 'socket.io-client';
import type { DubPublicRoom } from '../shared/dub.ts';
import type { JoinResult } from '../shared/types.ts';

const URL = process.env.URL ?? 'http://localhost:3000';
let failures = 0;
const check = (cond: unknown, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, ms = 30_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await sleep(40);
  }
}

class Client {
  socket: Socket;
  state: DubPublicRoom | null = null;
  id = '';
  clips: { round: number; clips: { playerId: string; data: Buffer }[] } | null = null;
  constructor() {
    this.socket = io(URL, { transports: ['websocket'] });
    this.socket.on('room:state', (s) => (this.state = s));
    this.socket.on('dub:clips', (p) => (this.clips = p));
  }
  emit<T>(ev: string, ...args: unknown[]) {
    return new Promise<T>((r) => this.socket.emit(ev, ...args, r));
  }
}

const fakeAudio = (seed: number) => Buffer.alloc(4000, seed);

const [a, b, c] = [new Client(), new Client(), new Client()];
const r = await a.emit<JoinResult>('room:create', { name: 'Ana', game: 'dub' });
a.id = r.memberId!;
b.id = (await b.emit<JoinResult>('room:join', { code: r.code, name: 'Beto' })).memberId!;
c.id = (await c.emit<JoinResult>('room:join', { code: r.code, name: 'Caio' })).memberId!;
await waitFor(() => a.state?.players.length === 3);
check(a.state?.kind === 'dub', 'sala do Dublagem criada com 3 jogadores');

// Cenas curtas na fila para o teste andar rápido.
const bad = await a.emit<{ ok: boolean }>('dub:scene', { link: 'nada a ver', start: '0', end: '3' });
check(!bad.ok, 'link inválido é recusado');
const notHost = await b.emit<{ ok: boolean }>('dub:scene', { link: 'https://youtu.be/_t5yUErj-SA', start: '0', end: '3' });
check(!notHost.ok, 'só o anfitrião escolhe cenas');
for (let i = 0; i < 3; i++) await a.emit('dub:scene', { link: 'https://www.youtube.com/watch?v=_t5yUErj-SA', start: '0:00', end: '0:03' });
await waitFor(() => a.state?.queue.length === 3);
check(a.state?.queue[0].end === 3, 'cena própria entrou na fila (0:00–0:03)');

await a.emit('game:start');
await waitFor(() => a.state?.phase === 'watch');
check(a.state?.round === 1 && a.state.scene?.video === '_t5yUErj-SA', 'rodada 1: todos assistem à cena original');
const early = await b.emit<{ ok: boolean }>('dub:audio', { round: 1, mime: 'audio/webm', data: fakeAudio(1) });
check(!early.ok, 'não dá para enviar dublagem durante a cena original');

for (let round = 1; round <= 3; round++) {
  await waitFor(() => a.state?.phase === 'record' && a.state.round === round);
  check(true, `rodada ${round}: gravação liberada`);
  if (round === 1) {
    const tiny = await b.emit<{ ok: boolean }>('dub:audio', { round, mime: 'audio/webm', data: Buffer.alloc(10) });
    check(!tiny.ok, 'gravação vazia é recusada');
    const wrongType = await b.emit<{ ok: boolean }>('dub:audio', { round, mime: 'video/mp4', data: fakeAudio(1) });
    check(!wrongType.ok, 'formato que não é áudio é recusado');
  }
  for (const [i, cl] of [a, b, c].entries()) {
    const res = await cl.emit<{ ok: boolean; error?: string }>('dub:audio', { round, mime: 'audio/webm;codecs=opus', data: fakeAudio(i + 1) });
    check(res.ok, `${['Ana', 'Beto', 'Caio'][i]} enviou a dublagem`);
  }
  await waitFor(() => a.state?.phase === 'show');
  await waitFor(() => !!c.clips && c.clips.round === round && c.clips.clips.length === 3, 5000);
  const own = c.clips!.clips.find((x) => x.playerId === c.id);
  check(own && own.data.length === 4000 && own.data[0] === 3, 'todos recebem as 3 gravações (bytes intactos)');
  check(a.state?.showOrder.length === 3, 'exibição com as 3 dublagens');
  if (round === 1) {
    a.socket.emit('dub:skip');
    await waitFor(() => a.state?.showIndex === 1);
    check(true, 'anfitrião pula para a próxima dublagem');
  }
  await waitFor(() => a.state?.phase === 'vote');
  // Votar em si mesmo não conta.
  a.socket.emit('dub:vote', a.id);
  await sleep(200);
  check(!a.state?.players.find((p) => p.id === a.id)?.voted, 'não dá para votar em si mesmo');
  a.socket.emit('dub:vote', b.id);
  b.socket.emit('dub:vote', a.id);
  c.socket.emit('dub:vote', b.id);
  await waitFor(() => a.state?.phase === 'results', 5000);
  check(a.state?.votes?.[b.id] === 2 && a.state.votes[a.id] === 1 && a.state.votes[c.id] === 0, 'votos contados (Beto 2, Ana 1, Caio 0)');
  const score = (id: string) => a.state!.players.find((p) => p.id === id)!.score;
  check(score(b.id) === 3 * round && score(a.id) === round && score(c.id) === 0, `placar: Beto ${score(b.id)}, Ana ${score(a.id)}, Caio ${score(c.id)}`);
  a.socket.emit('dub:skip');
}

await waitFor(() => a.state?.phase === 'ended');
check(a.state?.winnerId === b.id && a.state.ranking?.[0].score === 9, 'Beto é o campeão com 9 pontos');

// Reconexão: novo socket com o token volta para a sala.
const back = await a.emit<{ ok: boolean }>('game:restart', true);
check(back.ok, 'jogar novamente');
await waitFor(() => a.state?.phase === 'watch' && a.state.round === 1);
check(a.state!.players.every((p) => p.score === 0), 'placar zerado na nova partida');

for (const cl of [a, b, c]) cl.socket.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
