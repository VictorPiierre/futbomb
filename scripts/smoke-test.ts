/**
 * Teste de ponta a ponta do multiplayer: conecta 3 clientes Socket.IO reais ao servidor.
 * Uso: com o servidor rodando (npm start ou npm run dev:server) -> npm run smoke
 */
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { normalize } from '../shared/normalize.ts';
import type { AnswerResult, JoinResult, PublicRoom } from '../shared/types.ts';

const URL = process.env.URL ?? 'http://localhost:3000';
const names: { name: string; aliases: string[] }[] = JSON.parse(fs.readFileSync('data/players.json', 'utf8'));

class Client {
  socket: Socket;
  state: PublicRoom | null = null;
  memberId = '';
  token = '';
  constructor(public label: string) {
    this.socket = io(URL, { transports: ['websocket'] });
    this.socket.on('room:state', (s: PublicRoom) => (this.state = s));
  }
  emit<T>(event: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve) => this.socket.emit(event, ...args, resolve));
  }
}

let failures = 0;
function check(cond: unknown, msg: string) {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
}

async function waitFor(fn: () => boolean, ms = 40_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condição');
    await new Promise((r) => setTimeout(r, 50));
  }
}

function answerFor(letter: string, skip: Set<string>) {
  const rec = names.find((n) => normalize(n.name).startsWith(letter.toLowerCase()) && !skip.has(n.name));
  if (!rec) throw new Error('sem nome para ' + letter);
  skip.add(rec.name);
  return rec.name;
}

async function main() {
  const [a, b, c] = [new Client('Ana'), new Client('Beto'), new Client('Caio')];
  const byId = (id: string | null | undefined) => [a, b, c].find((x) => x.memberId === id)!;

  console.log('Salas');
  const created = await a.emit<JoinResult>('room:create', { name: 'Ana', avatar: '⚽' });
  check(created.ok && created.code?.length === 4, `sala criada (${created.code})`);
  a.memberId = created.memberId!;
  const code = created.code!;
  const bad = await b.emit<JoinResult>('room:join', { code: 'ZZZZ', name: 'Beto' });
  check(!bad.ok, 'código inválido é recusado');
  for (const cl of [b, c]) {
    const r = await cl.emit<JoinResult>('room:join', { code, name: cl.label, avatar: '🦁' });
    cl.memberId = r.memberId!;
    cl.token = r.token!;
  }
  await waitFor(() => a.state?.players.length === 3);
  check(true, 'três jogadores na sala, sincronizados');

  a.socket.emit('room:settings', { turnTime: 5, theme: 'players' });
  b.socket.emit('room:settings', { turnTime: 30 }); // não é anfitrião: deve ser ignorado
  await waitFor(() => c.state?.settings.turnTime === 5);
  await new Promise((r) => setTimeout(r, 200));
  check(c.state?.settings.turnTime === 5, 'só o anfitrião altera configurações');

  const notHost = await b.emit<{ ok: boolean }>('game:start');
  check(!notHost.ok, 'não anfitrião não inicia a partida');
  const started = await a.emit<{ ok: boolean }>('game:start');
  check(started.ok, 'anfitrião inicia a partida');
  await waitFor(() => !!b.state?.game?.currentPlayerId);

  console.log('Turnos e validação');
  const g = a.state!.game!;
  const cur = byId(g.currentPlayerId);
  const other = [a, b, c].find((x) => x !== cur)!;
  const used = new Set<string>();
  const outOfTurn = await other.emit<AnswerResult>('game:answer', answerFor(g.letter, new Set()));
  check(!outOfTurn.ok, `resposta fora da vez recusada (${outOfTurn.reason})`);
  const wrongLetter = await cur.emit<AnswerResult>('game:answer', g.letter === 'M' ? 'Neymar' : 'Messi');
  check(!wrongLetter.ok, `letra errada recusada (${wrongLetter.reason})`);
  await new Promise((r) => setTimeout(r, 300));
  const fake = await cur.emit<AnswerResult>('game:answer', g.letter + 'zqxwvbn');
  check(!fake.ok, `nome inventado recusado (${fake.reason})`);
  await new Promise((r) => setTimeout(r, 300));
  const valid = answerFor(g.letter, used);
  const okRes = await cur.emit<AnswerResult>('game:answer', valid.toUpperCase());
  check(okRes.ok, `"${valid.toUpperCase()}" aceito como ${okRes.canonical}`);
  await waitFor(() => a.state?.game?.currentPlayerId !== cur.memberId);
  check(true, 'bomba passou para o próximo jogador');
  const next = byId(a.state!.game!.currentPlayerId);
  const repeat = await next.emit<AnswerResult>('game:answer', valid);
  check(!repeat.ok, `repetição recusada (${repeat.reason})`);

  console.log('Reconexão');
  c.socket.disconnect();
  await waitFor(() => a.state?.players.find((p) => p.id === c.memberId)?.connected === false);
  check(true, 'queda de conexão detectada');
  c.socket = io(URL, { transports: ['websocket'] });
  c.socket.on('room:state', (s: PublicRoom) => (c.state = s));
  const re = await c.emit<JoinResult>('room:join', { code, token: c.token });
  check(re.ok && re.memberId === c.memberId, 'jogador reconectou com a mesma identidade');

  console.log('Saída, explosões e vitória (aguarde ~20s)');
  b.socket.emit('room:leave');
  await waitFor(() => !!a.state?.players.find((p) => p.id === b.memberId)?.eliminated);
  check(true, 'quem sai durante a partida é eliminado sem travar o jogo');
  let sawLifeLost = false;
  await waitFor(() => {
    if (a.state?.players.some((p) => p.lives === 1)) sawLifeLost = true;
    return a.state?.phase === 'ended';
  }, 60_000);
  check(sawLifeLost, 'tempo esgotado tira uma vida');
  const st = a.state!;
  check(!!st.winnerId && st.ranking?.[0].playerId === st.winnerId, `vencedor declarado: ${st.ranking?.[0].name}`);
  check(st.ranking?.length === 3, 'classificação com todos os participantes');

  console.log('Jogar novamente');
  const again = await byId(st.hostId).emit<{ ok: boolean }>('game:restart', true);
  await waitFor(() => a.state?.phase === 'playing');
  check(again.ok && a.state!.players.every((p) => p.lives === 2) && a.state!.game!.history.length === 0,
    'nova partida com vidas e respostas reiniciadas');
  check(a.state!.players.length === 2, 'quem saiu não volta para a nova partida');

  for (const cl of [a, b, c]) cl.socket.disconnect();
  console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
