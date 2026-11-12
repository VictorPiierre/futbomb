/**
 * Teste de ponta a ponta da Torre de Lava com 3 clientes.
 * Uso: com o servidor rodando (de preferência com LAVA_PACE=0.1) -> npm run smoke:lava
 */
import { io, type Socket } from 'socket.io-client';
import { climbFor, lavaRise, LAVA_START_HEIGHT, type LavaPublicRoom } from '../shared/lava.ts';
import { makeQuestion } from '../server/lava-room.ts';
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
    await sleep(20);
  }
}

// Contas geradas: sempre inteiras e coerentes.
for (const d of ['easy', 'medium', 'hard'] as const) {
  let ok = true;
  for (let i = 0; i < 3000; i++) {
    const q = makeQuestion(d);
    if (!Number.isInteger(q.answer) || q.answer < 0) ok = false;
  }
  check(ok, `contas do nível ${d}: respostas inteiras e não negativas`);
}

// Equilíbrio: quem sempre acerta em 1º cai até a 12ª rodada; quem sempre erra cai cedo.
const survive = (place: number | null) => {
  let h = LAVA_START_HEIGHT;
  let lava = 0;
  for (let r = 1; r < 40; r++) {
    h += place ? climbFor(r, place) : 0;
    lava += lavaRise(r);
    if (h <= lava) return r;
  }
  return 99;
};
check(survive(1) >= 9 && survive(1) <= 13, `sempre 1º sobrevive até a rodada ${survive(1)}`);
check(survive(2) < survive(1), `sempre 2º cai antes (rodada ${survive(2)})`);
check(survive(null) <= 3, `sempre erra cai na rodada ${survive(null)}`);

class Client {
  socket: Socket;
  state: LavaPublicRoom | null = null;
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
const r = await a.emit<JoinResult>('room:create', { name: 'Ana', game: 'lava' });
a.id = r.memberId!;
b.id = (await b.emit<JoinResult>('room:join', { code: r.code, name: 'Beto' })).memberId!;
c.id = (await c.emit<JoinResult>('room:join', { code: r.code, name: 'Caio' })).memberId!;
await waitFor(() => a.state?.players.length === 3);
check(a.state?.kind === 'lava', 'sala da Torre de Lava criada com 3 jogadores');
a.socket.emit('room:settings', { difficulty: 'medium' });
await waitFor(() => a.state?.settings.difficulty === 'medium');

await a.emit('game:start');
// Resolve a conta pelo texto (só para o teste).
const solve = (q: string) => {
  const t = q.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/(\d+)²/, '($1*$1)');
  const pct = t.match(/^(\d+)% de (\d+)$/);
  return pct ? (Number(pct[1]) * Number(pct[2])) / 100 : Function(`return ${t}`)();
};
let sawGhost = false;
let round = 0;
while (true) {
  await waitFor(() => a.state?.phase === 'countdown' || a.state?.phase === 'ended');
  if (a.state!.phase === 'ended') break;
  round = a.state!.round;
  if (round === 1) check(a.state!.question === null, 'na contagem a pergunta ainda não aparece');
  await waitFor(() => a.state?.phase === 'question');
  const q = a.state!.question!;
  const ans = solve(q);
  const opts = a.state!.options!;
  const wrong = opts.find((o) => o !== ans)!;
  if (round === 1) {
    check(opts.length === 4 && new Set(opts).size === 4 && opts.includes(ans), `4 alternativas diferentes com a certa: ${opts.join(' | ')}`);
    const outside = await c.emit<{ ok: boolean }>('lava:answer', 99999);
    check(!outside.ok, 'resposta fora das alternativas é recusada');
  }
  const cAlive = a.state!.players.find((p) => p.id === c.id)!.alive;
  // Ana acerta primeiro, Beto acerta depois, Caio erra (e continua respondendo como fantasma).
  const ra = await a.emit<{ ok: boolean; correct: boolean }>('lava:answer', ans);
  if (round === 1) {
    check(ra.correct, `rodada 1: ${q} = ${ans} — Ana acertou`);
    const again = await a.emit<{ ok: boolean }>('lava:answer', wrong);
    check(!again.ok, 'só vale a primeira resposta');
  }
  await sleep(60);
  const bAlive = a.state!.players.find((p) => p.id === b.id)!.alive;
  // A partir da 5ª, Beto erra para a partida acabar.
  await b.emit('lava:answer', round >= 5 ? wrong : ans);
  await sleep(30);
  await c.emit('lava:answer', wrong);
  await waitFor(() => a.state?.phase === 'ranking', 5000);
  const res = a.state!.results!;
  const ra2 = res.find((x) => x.playerId === a.id)!;
  check(res[0].playerId === a.id && ra2.place === 1 && ra2.climb === climbFor(round, 1), `rodada ${round}: Ana 1º lugar, sobe +${ra2.climb}`);
  if (round < 5 && bAlive) {
    const rb = res.find((x) => x.playerId === b.id)!;
    check(rb.place === 2 && rb.climb === climbFor(round, 2) && rb.timeMs! >= ra2.timeMs!, `rodada ${round}: Beto 2º (${rb.timeMs}ms), sobe +${rb.climb}`);
  }
  const rc = res.find((x) => x.playerId === c.id)!;
  check(!rc.correct && rc.climb === 0 && res[res.length - 1].playerId === c.id, `rodada ${round}: Caio errou, aparece por último com ✗`);
  if (!cAlive) {
    sawGhost = rc.ghost;
  }
  await waitFor(() => a.state?.phase === 'rise' || a.state?.phase === 'ended', 5000);
}
check(sawGhost, 'Caio engolido continuou respondendo e aparece como espectador');
check(a.state!.winnerId === a.id, `Ana venceu na rodada ${round}`);
check(a.state!.ranking![0].playerId === a.id && a.state!.ranking![2].playerId === c.id, 'ranking final: Ana, Beto, Caio');

for (const cl of [a, b, c]) cl.socket.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
