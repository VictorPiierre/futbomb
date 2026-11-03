/**
 * Teste de ponta a ponta do Chutômetro com 3 clientes reais.
 * Uso: com o servidor rodando -> npm run smoke:quiz
 */
import { io, type Socket } from 'socket.io-client';
import { QUIZ_EXACT_BONUS, QUIZ_POINTS, type QuizPublicRoom } from '../shared/quiz.ts';
import type { JoinResult } from '../shared/types.ts';

const URL = process.env.URL ?? 'http://localhost:3000';
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
    await sleep(40);
  }
}

class Client {
  socket: Socket;
  state: QuizPublicRoom | null = null;
  id = '';
  constructor() {
    this.socket = io(URL, { transports: ['websocket'] });
    this.socket.on('room:state', (s) => (this.state = s));
  }
  emit<T>(ev: string, ...args: unknown[]) {
    return new Promise<T>((r) => this.socket.emit(ev, ...args, r));
  }
}

const [a, b, c] = [new Client(), new Client(), new Client()];
const r = await a.emit<JoinResult>('room:create', { name: 'Ana', game: 'quiz' });
a.id = r.memberId!;
b.id = (await b.emit<JoinResult>('room:join', { code: r.code, name: 'Beto' })).memberId!;
c.id = (await c.emit<JoinResult>('room:join', { code: r.code, name: 'Caio' })).memberId!;
await waitFor(() => a.state?.players.length === 3);
check(a.state?.kind === 'quiz', 'sala do Chutômetro criada com 3 jogadores');
a.socket.emit('room:settings', { target: 15, questionTime: 30 });
await waitFor(() => a.state?.settings.target === 15);

const early = await b.emit<{ ok: boolean }>('quiz:guess', '10');
check(!early.ok, 'não dá para chutar antes de começar');
await a.emit('game:start');

const seen = new Set<string>();
let n = 0;
let exactTested = false;
while (a.state!.phase !== 'ended' && n < 40) {
  await waitFor(() => a.state?.phase === 'question' && a.state.number === n + 1);
  n++;
  const q = a.state!.question!;
  check(!seen.has(q.q), `pergunta ${n} nova: ${q.q.slice(0, 60)}`);
  seen.add(q.q);
  check(a.state!.answer === null, 'resposta escondida durante a pergunta');
  if (n === 1) {
    const bad = await a.emit<{ ok: boolean }>('quiz:guess', 'banana');
    check(!bad.ok, 'chute que não é número é recusado');
  }
  // Ana chuta perto (resposta exata quando já sabemos o formato), Beto médio, Caio longe.
  await a.emit('quiz:guess', '1');
  await b.emit('quiz:guess', '1.000');
  await c.emit('quiz:guess', '5 bilhões');
  await waitFor(() => a.state?.phase === 'reveal' || a.state?.phase === 'ended', 5000);
  const res = a.state!.results!;
  const answer = a.state!.answer!;
  const sorted = [...res].sort((x, y) => (x.place ?? 99) - (y.place ?? 99));
  const okOrder = sorted.every((x, i) => i === 0 || (x.diff ?? Infinity) >= (sorted[i - 1].diff ?? -1));
  const okPoints = res.every((x) => x.points === (QUIZ_POINTS[(x.place ?? 99) - 1] ?? 0) + (x.exact ? QUIZ_EXACT_BONUS : 0));
  check(okOrder && okPoints, `revelou ${answer}: mais perto ganhou ${sorted[0].points}, depois ${sorted[1].points} e ${sorted[2].points}`);
  if (!exactTested && a.state!.phase === 'reveal') {
    exactTested = true;
    console.log('   (placar:', a.state!.players.map((p) => `${p.name} ${p.score}`).join(', ') + ')');
  }
  if (a.state!.phase === 'reveal') {
    a.socket.emit('quiz:next');
    await waitFor(() => a.state?.phase !== 'reveal');
  }
}
await waitFor(() => a.state?.phase === 'ended');
const rk = a.state!.ranking!;
check(rk[0].score >= 15 && rk[0].score > rk[1].score, `vencedor ${rk[0].name} com ${rk[0].score} pts (meta 15) depois de ${n} perguntas`);

const again = await a.emit<{ ok: boolean }>('game:restart', true);
await waitFor(() => a.state?.phase === 'question');
check(again.ok && a.state!.players.every((p) => p.score === 0), 'jogar novamente zera os pontos');
check(!seen.has(a.state!.question!.q), 'a nova partida não repete pergunta da anterior');

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
