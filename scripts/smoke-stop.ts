/**
 * Teste de ponta a ponta do Stop com 3 clientes reais.
 * Uso: com o servidor rodando -> npm run smoke:stop
 */
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { normalize } from '../shared/normalize.ts';
import type { StopPublicRoom } from '../shared/stop.ts';
import type { JoinResult, Theme } from '../shared/types.ts';

const URL = process.env.URL ?? 'http://localhost:3000';
const CATS: Theme[] = ['animals', 'colors', 'foods'];
const banks = Object.fromEntries(CATS.map((c) => [c, JSON.parse(fs.readFileSync(`data/${c}.json`, 'utf8'))])) as Record<Theme, { name: string }[]>;

let failures = 0;
const check = (cond: unknown, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, ms = 20_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await sleep(50);
  }
}

class Client {
  socket: Socket;
  state: StopPublicRoom | null = null;
  id = '';
  constructor() {
    this.socket = io(URL, { transports: ['websocket'] });
    this.socket.on('room:state', (s) => (this.state = s));
  }
  emit<T>(ev: string, ...args: unknown[]) {
    return new Promise<T>((r) => this.socket.emit(ev, ...args, r));
  }
}

const word = (cat: Theme, letter: string, skip = 0) =>
  banks[cat].filter((w) => normalize(w.name)[0] === letter.toLowerCase())[skip]?.name ?? '';

const [a, b, c] = [new Client(), new Client(), new Client()];
const r = await a.emit<JoinResult>('room:create', { name: 'Ana', game: 'stop' });
a.id = r.memberId!;
b.id = (await b.emit<JoinResult>('room:join', { code: r.code, name: 'Beto' })).memberId!;
c.id = (await c.emit<JoinResult>('room:join', { code: r.code, name: 'Caio' })).memberId!;
await waitFor(() => a.state?.players.length === 3);
check(a.state?.kind === 'stop', 'sala de Stop criada com 3 jogadores');

a.socket.emit('room:settings', { categories: CATS, rounds: 3, roundTime: 60 });
await waitFor(() => a.state?.settings.categories.length === 3);
check(true, 'anfitrião escolheu 3 categorias e 3 rodadas');

await a.emit('game:start');
for (let round = 1; round <= 3; round++) {
  await waitFor(() => a.state?.phase === 'playing' && a.state.round === round);
  const L = a.state!.letter;
  console.log(`Rodada ${round} — letra ${L}`);
  await sleep(a.state!.roundStartsAt! - a.state!.serverNow + 100);

  // Ana e Beto repetem a mesma resposta em animals (5 pts); Caio deixa cores em branco.
  a.socket.emit('stop:answer', { category: 'animals', text: word('animals', L) });
  b.socket.emit('stop:answer', { category: 'animals', text: word('animals', L) });
  c.socket.emit('stop:answer', { category: 'animals', text: word('animals', L, 1) || 'xyz' });
  a.socket.emit('stop:answer', { category: 'foods', text: word('foods', L) || `${L}inventado` });
  b.socket.emit('stop:answer', { category: 'foods', text: `${L}zzqx palavra inventada` });
  c.socket.emit('stop:answer', { category: 'foods', text: word('foods', L, 1) });
  if (round === 1) {
    const early = await b.emit<{ ok: boolean }>('stop:stop', null);
    check(!early.ok, 'STOP recusado com categorias em branco');
  }
  a.socket.emit('stop:answer', { category: 'colors', text: word('colors', L) || `${L}cor` });
  b.socket.emit('stop:answer', { category: 'colors', text: 'Azul' }); // letra errada se L != A
  await sleep(200);
  const stop = await a.emit<{ ok: boolean }>('stop:stop', null);
  check(stop.ok, 'Ana deu STOP com tudo preenchido');

  await waitFor(() => a.state?.phase === 'review');
  const ans = a.state!.answers!;
  const caioColor = ans.colors!.find((x) => x.playerId === c.id)!;
  check(caioColor.status === 'empty' && !caioColor.valid, 'resposta em branco não vale');
  const betoFood = ans.foods!.find((x) => x.playerId === b.id)!;
  check(betoFood.status === 'unknown' && !betoFood.valid, 'palavra inventada começa inválida');

  if (round === 1) {
    // Ana e Caio votam que a palavra inventada do Beto vale: maioria (2 de 2) vira.
    a.socket.emit('stop:vote', { category: 'foods', playerId: b.id, valid: true });
    c.socket.emit('stop:vote', { category: 'foods', playerId: b.id, valid: true });
    await waitFor(() => !!a.state?.answers?.foods?.find((x) => x.playerId === b.id)?.valid);
    check(true, 'votação da maioria aceita a resposta');
    const self = a.state!.answers!.animals!.find((x) => x.playerId === a.id)!;
    a.socket.emit('stop:vote', { category: 'animals', playerId: a.id, valid: false });
    await sleep(200);
    check(Object.keys(a.state!.answers!.animals!.find((x) => x.playerId === a.id)!.votes).length === Object.keys(self.votes).length, 'ninguém vota na própria resposta');
  }

  for (const cl of [a, b, c]) cl.socket.emit('stop:ready');
  await waitFor(() => a.state?.phase === 'scores' || a.state?.phase === 'ended');
  if (a.state!.phase === 'scores') {
    const animals = a.state!.answers!.animals!;
    const anaA = animals.find((x) => x.playerId === a.id)!;
    check(anaA.points === 5, `resposta repetida vale 5 (${anaA.text})`);
    console.log('   pontos da rodada:', a.state!.roundPoints);
    a.socket.emit('stop:next');
  }
}
await waitFor(() => a.state?.phase === 'ended');
const rk = a.state!.ranking!;
check(rk.length === 3 && rk[0].score >= rk[2].score, `fim de jogo: campeão ${rk[0].name} com ${rk[0].score} pts`);

const again = await a.emit<{ ok: boolean }>('game:restart', true);
await waitFor(() => a.state?.phase === 'playing' && a.state.round === 1);
check(again.ok && a.state!.players.every((p) => p.score === 0), 'jogar novamente zera os pontos');

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
