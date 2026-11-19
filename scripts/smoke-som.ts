/**
 * Teste de ponta a ponta do "Faz Esse Som!" com 3 clientes.
 * Uso: com o servidor rodando com SOM_TEST_SOUNDS=1 (sons de mentira) e, de preferência, SOM_PACE=0.1 -> npm run smoke:som
 */
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import type { SomClip, SomPublicRoom } from '../shared/som.ts';
import { SOM_CATEGORIES, SOM_DIFFICULTIES, SOM_LIBRARY } from '../shared/som-library.ts';
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
    await sleep(30);
  }
}

// Biblioteca (os sons do dono, salvos pelo /admin): ids únicos, arquivo existe, tema e dificuldade válidos.
check(new Set(SOM_LIBRARY.map((x) => x.id)).size === SOM_LIBRARY.length, `ids sem repetição (${SOM_LIBRARY.length} sons do dono)`);
const missing = SOM_LIBRARY.filter((x) => !fs.existsSync(`client/public/som/${x.file ?? `${x.id}.mp3`}`));
check(!missing.length, `todo som tem arquivo ${missing.map((x) => x.id).join(', ')}`);
check(SOM_LIBRARY.every((x) => x.cat in SOM_CATEGORIES && x.diff in SOM_DIFFICULTIES), 'todo som tem tema e dificuldade válidos');

class Client {
  socket: Socket;
  state: SomPublicRoom | null = null;
  clips: { round: number; clips: SomClip[] } | null = null;
  id = '';
  constructor() {
    this.socket = io(URL, { transports: ['websocket'] });
    this.socket.on('room:state', (s) => (this.state = s));
    this.socket.on('som:clips', (p) => (this.clips = p));
  }
  emit<T>(ev: string, ...args: unknown[]) {
    return new Promise<T>((r) => this.socket.emit(ev, ...args, r));
  }
}
const fakeClip = (tag: string) => Buffer.concat([Buffer.from(tag), Buffer.alloc(2000, tag.charCodeAt(0))]);

const [a, b, c] = [new Client(), new Client(), new Client()];
const r = await a.emit<JoinResult>('room:create', { name: 'Ana', game: 'som' });
a.id = r.memberId!;
b.id = (await b.emit<JoinResult>('room:join', { code: r.code, name: 'Beto' })).memberId!;
c.id = (await c.emit<JoinResult>('room:join', { code: r.code, name: 'Caio' })).memberId!;
await waitFor(() => a.state?.players.length === 3);
check(a.state?.kind === 'som', 'sala do Faz Esse Som! criada com 3 jogadores');
a.socket.emit('room:settings', { theme: 'xyz', difficulty: 'mole' });
await sleep(200);
check(a.state!.settings.theme === 'mix' && a.state!.settings.difficulty === 'sortear', 'padrão: todos os temas misturados e dificuldade sorteada; valores inválidos ignorados');
a.socket.emit('room:settings', { rounds: 3, theme: 'meme', difficulty: 'impossivel' });
await waitFor(() => a.state?.settings.rounds === 3 && a.state.settings.theme === 'meme');

await a.emit('game:start');
const seen = new Set<string>();
for (let round = 1; round <= 3; round++) {
  await waitFor(() => a.state?.phase === 'record' && a.state.round === round);
  const s = a.state!;
  seen.add(s.sound!.id);
  check(!!s.sound && !!s.playAt, `rodada ${round}: som "${s.sound!.title}"`);
  // Só há 1 som de teste por dificuldade: depois do primeiro, cai para outra dificuldade do mesmo tema.
  check(s.sound!.cat === 'meme' && (round > 1 || s.sound!.diff === 'impossivel'), `tema e dificuldade respeitados (${s.sound!.cat}, ${s.sound!.diff})`);

  if (round === 3) {
    // Ninguém grava: vai direto para o resultado vazio.
    await waitFor(() => a.state?.phase === 'results', 30_000);
    check(a.state!.results!.length === 0, 'rodada sem gravações: resultado vazio, sem votação');
    a.socket.emit('som:next');
    break;
  }

  const early = await a.emit<{ ok: boolean }>('som:clip', 'x', 'text/html');
  check(!early.ok, 'gravação inválida é recusada');
  await waitFor(() => (a.state?.playAt ?? 0) < Date.now() + 50);
  await a.emit('som:clip', fakeClip('A'), 'audio/webm;codecs=opus');
  await b.emit('som:clip', fakeClip('B'), 'audio/mp4');
  await c.emit('som:clip', fakeClip('C'), 'audio/webm');
  await waitFor(() => a.state?.phase === 'vote', 5000);
  await waitFor(() => a.clips?.round === round && b.clips?.round === round && c.clips?.round === round, 5000);
  check(a.state!.clipCount === 3 && a.clips!.clips.length === 3, '3 imitações na votação');
  const slotOf = (cl: Client) => cl.clips!.clips.find((x) => x.mine)!.slot;
  check([a, b, c].every((cl) => cl.clips!.clips.filter((x) => x.mine).length === 1), 'cada um sabe qual é só a sua imitação');
  check(new Set([slotOf(a), slotOf(b), slotOf(c)]).size === 3, 'slots diferentes para cada um');
  const self = await a.emit<{ ok: boolean }>('som:vote', slotOf(a));
  check(!self.ok, 'não dá para votar em si mesmo');
  // Ana recebe 2 votos (Beto e Caio), Beto recebe 1 (Ana).
  await a.emit('som:vote', slotOf(b));
  await b.emit('som:vote', slotOf(a));
  await c.emit('som:vote', slotOf(a));
  await waitFor(() => a.state?.phase === 'results', 30_000);
  const g = a.state!.gained!;
  check(g[a.id] === 5 && g[b.id] === 1 && g[c.id] === 0, `pontos: Ana +${g[a.id]} (2 votos + 3 bônus), Beto +${g[b.id]}, Caio +${g[c.id]}`);
  const top = a.state!.results![0];
  check(top.playerId === a.id && top.winner && top.voters.length === 2, 'Ana aparece em primeiro com a coroa');
  a.socket.emit('som:next');
}
await waitFor(() => a.state?.phase === 'ended');
check(seen.size === 3, 'sons diferentes em cada rodada');
check(a.state!.winnerId === a.id && a.state!.ranking![0].score === 10, `Ana campeã com ${a.state!.ranking![0].score} pontos`);

for (const cl of [a, b, c]) cl.socket.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
