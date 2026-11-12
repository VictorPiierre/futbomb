/**
 * Teste de ponta a ponta do Ouvidão com 3 clientes.
 * Uso: com o servidor rodando -> npm run smoke:ear
 */
import { io, type Socket } from 'socket.io-client';
import { unscramble, type EarPublicRoom, type EarSay } from '../shared/ear.ts';
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
  state: EarPublicRoom | null = null;
  say: EarSay | null = null;
  id = '';
  constructor() {
    this.socket = io(URL, { transports: ['websocket'] });
    this.socket.on('room:state', (s) => (this.state = s));
    this.socket.on('ear:say', (p) => (this.say = p));
  }
  emit<T>(ev: string, ...args: unknown[]) {
    return new Promise<T>((r) => this.socket.emit(ev, ...args, r));
  }
}

const [a, b, c] = [new Client(), new Client(), new Client()];
const r = await a.emit<JoinResult>('room:create', { name: 'Ana', game: 'ear' });
a.id = r.memberId!;
b.id = (await b.emit<JoinResult>('room:join', { code: r.code, name: 'Beto' })).memberId!;
c.id = (await c.emit<JoinResult>('room:join', { code: r.code, name: 'Caio' })).memberId!;
await waitFor(() => a.state?.players.length === 3);
check(a.state?.kind === 'ear', 'sala do Ouvidão criada com 3 jogadores');

b.socket.emit('room:settings', { rounds: 15 });
a.socket.emit('room:settings', { langs: ['ja'], rounds: 5, difficulty: 'hard', answerTime: 10 });
await waitFor(() => a.state?.settings.rounds === 5);
check(a.state?.settings.langs.join() === 'ja' && a.state.settings.difficulty === 'hard', 'anfitrião configura (só japonês, difícil, 5 palavras)');

await a.emit('game:start');
for (let round = 1; round <= 5; round++) {
  await waitFor(() => a.state?.phase === 'question' && a.state.round === round && c.say?.round === round);
  const say = c.say!;
  check(say.lang === 'ja' && a.state!.word === null, `rodada ${round}: palavra chega embaralhada e não aparece no estado`);
  if (round === 1) {
    const early = await b.emit<{ ok: boolean }>('ear:answer', 'arigatou');
    check(!early.ok, 'não dá para responder antes da palavra ser dita');
  }
  await waitFor(() => Date.now() > say.speakAt + 50, 6000);
  const spoken = unscramble(say.blob);
  check(spoken.length > 0 && !/^[a-z ]+$/.test(spoken), 'texto da fala é japonês');
  await a.emit('ear:answer', 'xyz');
  await b.emit('ear:answer', 'abc');
  await c.emit('ear:answer', 'zzz');
  await waitFor(() => a.state?.phase === 'reveal', 5000);
  const w = a.state!.word!;
  check(w && w.answers.length > 0 && w.meaning, `revelação: ${w.say} = ${w.answers[0]} (“${w.meaning}”)`);
  a.socket.emit('ear:next');
}
await waitFor(() => a.state?.phase === 'ended');
check(a.state!.ranking!.length === 3, 'partida termina após 5 palavras com ranking');

// Pontuação: partida em inglês fácil; o bot lê a fala desembaralhada.
await a.emit('game:restart', false);
a.socket.emit('room:settings', { langs: ['en'], rounds: 5, difficulty: 'easy' });
await waitFor(() => a.state?.phase === 'lobby' && a.state.settings.langs.join() === 'en');
await a.emit('game:start');
await waitFor(() => a.state?.phase === 'question' && b.say?.round === 1);
await waitFor(() => Date.now() > b.say!.speakAt + 50, 6000);
const word = unscramble(b.say!.blob);
await b.emit('ear:answer', word.toUpperCase());
await c.emit('ear:answer', word.slice(0, -1) + (word.endsWith('x') ? 'y' : 'x'));
await a.emit('ear:answer', 'qqqqqqqqqq');
await waitFor(() => a.state?.phase === 'reveal', 5000);
const res = (id: string) => a.state!.results!.find((x) => x.playerId === id)!;
check(res(b.id).exact && res(b.id).points === 12, `Beto escreveu "${word.toUpperCase()}": perfeito, 10 + 2 de mais perto = ${res(b.id).points}`);
check(!res(c.id).exact && res(c.id).points > 0 && res(c.id).points < 10, `Caio errou uma letra: ${res(c.id).similarity}% → +${res(c.id).points}`);
check(res(a.id).points === 0, 'Ana chutou qualquer coisa: 0 pontos');

for (const cl of [a, b, c]) cl.socket.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
