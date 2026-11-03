/**
 * Teste de ponta a ponta do Chutômetro com 3 clientes reais.
 * Uso: com o servidor rodando -> npm run smoke:quiz
 */
import { io, type Socket } from 'socket.io-client';
import fs from 'node:fs';
import {
  QUIZ_BET_PENALTY, QUIZ_CLOSE_BONUS, QUIZ_EXACT_BONUS, QUIZ_HIGHLOW_POINTS, QUIZ_POINTS,
  type QuizPublicRoom, type QuizQuestion,
} from '../shared/quiz.ts';

// O teste consulta a resposta nos arquivos para chutar exato, perto e longe de propósito.
const ANSWERS = new Map<string, number>();
for (const f of fs.readdirSync('data/quiz').filter((x) => x.endsWith('.json'))) {
  for (const q of JSON.parse(fs.readFileSync('data/quiz/' + f, 'utf8')) as QuizQuestion[]) ANSWERS.set(q.q, q.a);
}
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
const TARGET = Number(process.env.TARGET ?? 15);
a.socket.emit('room:settings', { target: TARGET, questionTime: 30 });
await waitFor(() => a.state?.settings.target === TARGET);

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
  const ans = ANSWERS.get(q.q)!;
  const isYear = q.unit === 'ano';
  const special = q.special;
  if (special) console.log('   rodada especial:', special);
  const anaBets = n === 3; // Ana usa a ficha na 3ª pergunta
  const caioBets = n === 2; // Caio usa a ficha e erra feio
  if (anaBets) await a.emit('quiz:bet');
  if (caioBets) await c.emit('quiz:bet');
  // Azarão: Beto aposta no Caio (que vai ser o pior) e Caio aposta na Ana (que vai ser a melhor).
  await b.emit('quiz:pick', c.id);
  await c.emit('quiz:pick', a.id);
  let expected: Record<string, number>;
  if (special === 'highlow') {
    const right = ans > q.reference! ? 'up' : 'down';
    const wrong = right === 'up' ? 'down' : 'up';
    await a.emit('quiz:guess', right);
    await b.emit('quiz:guess', wrong);
    await c.emit('quiz:guess', wrong);
    expected = { [a.id]: QUIZ_HIGHLOW_POINTS * (anaBets ? 2 : 1), [b.id]: 0, [c.id]: caioBets ? -QUIZ_BET_PENALTY : 0 };
  } else {
    const mult = special === 'double' ? 2 : 1;
    // Ana exata, Beto muito perto, Caio longe demais.
    await a.emit('quiz:guess', String(ans).replace('.', ','));
    await b.emit('quiz:guess', String(isYear ? ans + 1 : Math.round(ans * 1.03 * 10) / 10).replace('.', ','));
    await c.emit('quiz:guess', String(isYear ? ans + 100 : ans * 10).replace('.', ','));
    const ana = (QUIZ_POINTS[0] + QUIZ_EXACT_BONUS) * mult * (anaBets ? 2 : 1);
    const beto = (QUIZ_POINTS[1] + QUIZ_CLOSE_BONUS) * mult;
    expected = { [a.id]: ana, [b.id]: beto, [c.id]: caioBets ? -QUIZ_BET_PENALTY : 0 };
  }
  await waitFor(() => a.state?.phase === 'reveal' || a.state?.phase === 'ended', 5000);
  const res = a.state!.results!;
  const got = Object.fromEntries(res.map((r) => [r.playerId, r.points]));
  const ok = [a.id, b.id, c.id].every((id) => got[id] === expected[id]);
  check(ok, `pontos certos (exato/perto/longe${special ? ', ' + special : ''}${anaBets ? ', ficha da Ana' : ''}${caioBets ? ', ficha do Caio' : ''}): Ana ${got[a.id]}, Beto ${got[b.id]}, Caio ${got[c.id]}`);
  const pk = Object.fromEntries(res.map((r) => [r.playerId, r.pickPoints]));
  check(pk[a.id] === 0 && pk[b.id] === 1 && pk[c.id] === -1, `azarão: Beto acertou o pior (+${pk[b.id]}), Caio apontou o melhor (${pk[c.id]})`);
  if (!ok) console.log('   esperado:', expected[a.id], expected[b.id], expected[c.id], 'resposta', ans, q.q);
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
check(rk[0].score >= TARGET && rk[0].score > rk[1].score && a.state!.players.every((p) => p.score >= 0), `vencedor ${rk[0].name} com ${rk[0].score} pts (meta ${TARGET}) depois de ${n} perguntas`);

const again = await a.emit<{ ok: boolean }>('game:restart', true);
await waitFor(() => a.state?.phase === 'question');
check(again.ok && a.state!.players.every((p) => p.score === 0), 'jogar novamente zera os pontos');
check(!seen.has(a.state!.question!.q), 'a nova partida não repete pergunta da anterior');

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
