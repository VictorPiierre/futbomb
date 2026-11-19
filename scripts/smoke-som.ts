/**
 * Teste de ponta a ponta do "Faz Esse Som!" com 3 clientes.
 * Uso: com o servidor rodando com SOM_TEST_SOUNDS=1 (sons de mentira) e, de preferência, SOM_PACE=0.1 -> npm run smoke:som
 */
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import type { SomClip, SomPublicRoom } from '../shared/som.ts';
import { SOM_LIBRARY } from '../shared/som-library.ts';
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
check(a.state!.soundCount === (SOM_LIBRARY.length || 6) && !('theme' in a.state!.settings), `sem temas nem dificuldades: uma lista só (${a.state!.soundCount} sons)`);
a.socket.emit('room:settings', { rounds: 3 });
await waitFor(() => a.state?.settings.rounds === 3);

await a.emit('game:start');
const seen = new Set<string>();
for (let round = 1; round <= 3; round++) {
  await waitFor(() => a.state?.phase === 'record' && a.state.round === round);
  const s = a.state!;
  seen.add(s.sound!.id);
  check(!!s.sound && !!s.playAt, `rodada ${round}: som "${s.sound!.title}"`);
  check(!('cat' in s.sound!) && !('diff' in s.sound!), 'o som não tem tema nem dificuldade');

  if (round === 3) {
    // Ninguém grava: sem tempo, a gravação não acaba sozinha; o dono encerra.
    await sleep(1500);
    check(a.state!.phase === 'record' && a.state!.endsAt === null, 'sem tempo para gravar: a rodada não acaba sozinha');
    b.socket.emit('som:next');
    await sleep(300);
    check(a.state!.phase === 'record', 'só o dono encerra a gravação');
    a.socket.emit('som:next');
    await waitFor(() => a.state?.phase === 'results', 5000);
    check(a.state!.results!.length === 0, 'rodada sem gravações: resultado vazio, sem votação');
    a.socket.emit('som:next');
    break;
  }

  const early = await a.emit<{ ok: boolean }>('som:clip', 'x', 'text/html');
  check(!early.ok, 'gravação inválida é recusada');
  await waitFor(() => (a.state?.playAt ?? 0) < Date.now() + 50);
  await a.emit('som:clip', fakeClip('A'), 'audio/webm;codecs=opus');
  await sleep(200);
  check(a.state!.phase === 'record' && a.state!.players.find((p) => p.id === a.id)!.done, 'Ana apertou Pronto e aparece como pronta; os outros ainda não');
  await b.emit('som:clip', fakeClip('B'), 'audio/mp4');
  await c.emit('som:clip', fakeClip('C'), 'audio/wav');
  await waitFor(() => a.state?.phase === 'vote', 5000);
  await waitFor(() => a.clips?.round === round && b.clips?.round === round && c.clips?.round === round, 5000);
  const order = a.state!.order;
  check(order.length === 3 && a.clips!.clips.length === 3, '3 imitações no desfile');
  check([a, b, c].every((cl) => cl.clips!.clips.find((x) => x.mine)!.slot === order.indexOf(cl.id) + 1), 'a gravação de cada um bate com a ordem do desfile (foto e nome certos)');

  // Começa relembrando o original e só passa quando o dono aperta "Próximo".
  check(a.state!.slide!.index === -1 && a.state!.endsAt === null, 'desfile começa relembrando o original, sem tempo correndo');
  b.socket.emit('som:next');
  await sleep(1200);
  check(a.state!.slide!.index === -1, 'não avança sozinho e só o dono passa para o próximo');
  a.socket.emit('som:next');

  // Notas planejadas: Ana leva 🔥🔥 (+4), Beto 😐😬 (+1), Caio 😬😬 (+0).
  const plan: Record<string, Record<string, string>> = {
    [a.id]: { [b.id]: 'bom', [c.id]: 'bom' },
    [b.id]: { [a.id]: 'meh', [c.id]: 'ruim' },
    [c.id]: { [a.id]: 'ruim', [b.id]: 'ruim' },
  };
  for (let i = 0; i < 3; i++) {
    await waitFor(() => a.state?.slide?.index === i);
    const target = order[i];
    const owner = [a, b, c].find((cl) => cl.id === target)!;
    if (round === 1 && i === 0) {
      const self = await owner.emit<{ ok: boolean }>('som:vote', 'bom');
      check(!self.ok, 'não dá para votar em si mesmo');
      const bad = await [a, b, c].find((cl) => cl !== owner)!.emit<{ ok: boolean }>('som:vote', 'otimo');
      check(!bad.ok, 'só vale Ruim, Meh ou Bom');
    }
    const voters = [a, b, c].filter((cl) => cl !== owner);
    await voters[0].emit('som:vote', plan[target][voters[0].id]);
    await sleep(100);
    if (round === 1 && i === 0) check(a.state!.slide!.votes === null && !a.state!.slide!.reveal, 'as notas ficam escondidas até todos votarem');
    await voters[1].emit('som:vote', plan[target][voters[1].id]);
    await waitFor(() => !!a.state?.slide?.reveal);
    const t = a.state!.slide!.votes!;
    check(
      Object.entries(plan[target]).every(([voter, r]) => t[r as 'bom' | 'meh' | 'ruim'].includes(voter)),
      `notas de ${owner === a ? 'Ana' : owner === b ? 'Beto' : 'Caio'}: 😬${t.ruim.length} 😐${t.meh.length} 🔥${t.bom.length} (com quem votou)`,
    );
    if (round === 1 && i === 0) {
      await sleep(1000);
      check(a.state!.slide!.index === 0 && a.state!.phase === 'vote', 'depois das notas, espera o dono');
    }
    a.socket.emit('som:next');
  }
  await waitFor(() => a.state?.phase === 'results', 5000);
  const g = a.state!.gained!;
  check(g[a.id] === 4 && g[b.id] === 1 && g[c.id] === 0, `pontos: Ana +${g[a.id]} (🔥🔥), Beto +${g[b.id]} (😐😬), Caio +${g[c.id]} (😬😬)`);
  const top = a.state!.results![0];
  check(top.playerId === a.id && top.best && top.points === 4, 'Ana aparece em primeiro com a coroa');
  await sleep(1000);
  check(a.state!.phase === 'results' && a.state!.endsAt === null, 'o resultado também espera o dono');
  a.socket.emit('som:next');
}
await waitFor(() => a.state?.phase === 'ended');
check(seen.size === 3, 'sons diferentes em cada rodada');
check(a.state!.winnerId === a.id && a.state!.ranking![0].score === 8, `Ana campeã com ${a.state!.ranking![0].score} pontos`);

for (const cl of [a, b, c]) cl.socket.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
