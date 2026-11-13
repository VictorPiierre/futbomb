/**
 * Teste de ponta a ponta do Mentirômetro com 3 clientes.
 * Uso: com o servidor rodando -> npm run smoke:lie
 */
import { io, type Socket } from 'socket.io-client';
import { tooClose, type LiePublicRoom } from '../shared/lie.ts';
import { LIE_BANK } from '../server/lie-bank.ts';
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
    await sleep(30);
  }
}

// Banco: toda pergunta tem 3 mentiras prontas, nenhuma parecida demais com a verdade.
check(LIE_BANK.length >= 100, `banco com ${LIE_BANK.length} perguntas`);
check(LIE_BANK.every((q) => q.fakes.length === 3 && q.q.endsWith('?')), 'toda pergunta tem 3 mentiras prontas');
check(new Set(LIE_BANK.map((q) => q.q)).size === LIE_BANK.length, 'sem perguntas repetidas');
const bad = LIE_BANK.filter((q) => q.fakes.some((f) => tooClose(f, [q.answer])));
check(!bad.length, `nenhuma mentira pronta parecida demais com a verdade ${bad.map((q) => q.q).join(' / ')}`);
check(
  tooClose('para resfriar o cérebro, segundo a teoria mais aceita', ['Segundo a teoria mais aceita, para ajudar a resfriar o cérebro']),
  'frase com as mesmas palavras da verdade é barrada',
);
check(!tooClose('Para mandar mais oxigênio para o cérebro', ['Segundo a teoria mais aceita, para ajudar a resfriar o cérebro']), 'frase diferente passa');
check(tooClose('Cabeca', ['cabeça']) && tooClose('a cabeça', ['cabeça']) && tooClose('cabesa', ['cabeça']), 'mentira igual à verdade (com artigo/acento/1 letra) é barrada');
check(!tooClose('barriga', ['cabeça']) && !tooClose('4', ['3']), 'mentira diferente passa');

type Mine = { round: number; lie: string | null; pick: string | null; own: string | null };
class Client {
  socket: Socket;
  state: LiePublicRoom | null = null;
  mine: Mine | null = null;
  id = '';
  constructor() {
    this.socket = io(URL, { transports: ['websocket'] });
    this.socket.on('room:state', (s) => (this.state = s));
    this.socket.on('lie:mine', (p) => (this.mine = p));
  }
  emit<T>(ev: string, ...args: unknown[]) {
    return new Promise<T>((r) => this.socket.emit(ev, ...args, r));
  }
}

const [a, b, c] = [new Client(), new Client(), new Client()];
const r = await a.emit<JoinResult>('room:create', { name: 'Ana', game: 'lie' });
a.id = r.memberId!;
b.id = (await b.emit<JoinResult>('room:join', { code: r.code, name: 'Beto' })).memberId!;
c.id = (await c.emit<JoinResult>('room:join', { code: r.code, name: 'Caio' })).memberId!;
await waitFor(() => a.state?.players.length === 3);
check(a.state?.kind === 'lie', 'sala do Mentirômetro criada com 3 jogadores');
a.socket.emit('room:settings', { rounds: 5 });
await waitFor(() => a.state?.settings.rounds === 5);

await a.emit('game:start');
for (let round = 1; round <= 5; round++) {
  await waitFor(() => a.state?.phase === 'write' && a.state.round === round);
  const q = LIE_BANK.find((x) => x.q === a.state!.question)!;
  check(!!q && a.state!.options === null, `rodada ${round}: "${q.q.slice(0, 40)}…" (resposta escondida)`);
  if (round === 1) {
    const truth = await a.emit<{ ok: boolean; truth?: boolean }>('lie:write', q.answer.toUpperCase());
    check(!truth.ok && truth.truth, 'escrever a resposta certa como mentira é recusado');
  }
  await a.emit('lie:write', 'mentira da ana');
  await b.emit('lie:write', 'invenção do beto');
  await c.emit('lie:write', 'Mentira da Ana'); // igual à da Ana
  await waitFor(() => a.state?.phase === 'pick', 5000);
  await waitFor(() => a.mine?.round === round && !!a.mine.own && !!b.mine?.own && !!c.mine?.own, 3000);
  const opts = a.state!.options!;
  const truthOpt = opts.find((o) => o.text === q.answer)!;
  check(opts.length === 4 && !!truthOpt && opts.filter((o) => q.fakes.includes(o.text)).length === 1, `4 alternativas com a verdade: ${opts.map((o) => o.text).join(' | ')}`);
  check(a.mine!.own === c.mine!.own, 'mentiras iguais viraram uma alternativa só (Ana e Caio)');
  if (round === 1) {
    const ownPick = await a.emit<{ ok: boolean }>('lie:pick', a.mine!.own);
    check(!ownPick.ok, 'não dá para escolher a própria mentira');
  }
  // Ana acha a verdade; Beto cai na mentira da Ana/Caio; Caio cai na do Beto.
  await a.emit('lie:pick', truthOpt.id);
  await b.emit('lie:pick', a.mine!.own);
  await c.emit('lie:pick', b.mine!.own);
  await waitFor(() => a.state?.phase === 'reveal', 5000);
  const g = a.state!.gained!;
  check(g[a.id] === 3 && g[b.id] === 1 && g[c.id] === 1, `pontos da rodada: Ana +${g[a.id]} (verdade 2 + enganou 1), Beto +${g[b.id]}, Caio +${g[c.id]}`);
  const rev = a.state!.reveal!;
  check(rev[rev.length - 1].truth, 'a verdade é revelada por último');
  a.socket.emit('lie:next');
}
await waitFor(() => a.state?.phase === 'ended');
check(a.state!.winnerId === a.id && a.state!.ranking![0].score === 15, `Ana campeã com ${a.state!.ranking![0].score} pontos`);

for (const cl of [a, b, c]) cl.socket.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
