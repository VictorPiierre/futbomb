/**
 * Teste do salvamento pelo /admin com um GitHub de mentira (nada é enviado para o GitHub de verdade).
 * Uso: npx tsx scripts/smoke-admin.ts
 */
export {};

process.env.SOM_ADMIN_KEY = 'senha-de-teste';
process.env.GITHUB_TOKEN = 'token-de-teste';

const { addSound, checkKey, listSounds, removeSound } = await import('../server/som-admin.ts');
const { SOM_LIBRARY } = await import('../shared/som-library.ts');

let failures = 0;
const check = (cond: unknown, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};

// ---------- GitHub falso: guarda arquivos por caminho ----------
const files = new Map<string, string>([['data/som-extra.json', Buffer.from('[]\n').toString('base64')]]);
let head = 'c0';
let n = 0;
const blobs = new Map<string, string>();
const trees = new Map<string, Map<string, string>>([['t0', new Map(files)]]);
const commits = new Map<string, { tree: string; message: string }>([['c0', { tree: 't0', message: 'início' }]]);
const messages: string[] = [];
let raceOnce = false;

globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const path = String(url).replace('https://api.github.com/repos/VictorPiierre/futbomb', '');
  const body = init.body ? JSON.parse(String(init.body)) : null;
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
  if (path === '/git/ref/heads/main') return json({ object: { sha: head } });
  if (path.startsWith('/git/commits/')) return json({ tree: { sha: commits.get(path.split('/').pop()!)!.tree } });
  if (path.startsWith('/contents/data/som-extra.json')) {
    const sha = path.split('ref=')[1];
    const content = trees.get(commits.get(sha)!.tree)!.get('data/som-extra.json');
    return content ? json({ content }) : json({}, 404);
  }
  if (path === '/git/blobs') {
    const sha = `b${++n}`;
    blobs.set(sha, body.content);
    return json({ sha });
  }
  if (path === '/git/trees') {
    const t = new Map(trees.get(body.base_tree));
    for (const e of body.tree) {
      if (e.sha === null) t.delete(e.path);
      else t.set(e.path, blobs.get(e.sha)!);
    }
    const sha = `t${++n}`;
    trees.set(sha, t);
    return json({ sha });
  }
  if (path === '/git/commits') {
    const sha = `c${++n}`;
    commits.set(sha, { tree: body.tree, message: body.message });
    return json({ sha });
  }
  if (path === '/git/refs/heads/main') {
    const c = commits.get(body.sha)!;
    // Simula alguém mexendo no repositório no meio do caminho uma vez: o servidor deve tentar de novo.
    if (raceOnce) {
      raceOnce = false;
      return json({ message: 'Update is not a fast forward' }, 422);
    }
    head = body.sha;
    messages.push(c.message);
    return json({ object: { sha: head } });
  }
  return json({ message: 'not found' }, 404);
}) as typeof fetch;

const wav = (samples: number) => {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'ascii');
  b.write('WAVEfmt ', 8, 'ascii');
  return b;
};
const tree = () => trees.get(commits.get(head)!.tree)!;
const extra = () => JSON.parse(Buffer.from(tree().get('data/som-extra.json')!, 'base64').toString('utf8'));

check(checkKey('senha-de-teste') && !checkKey('outra') && !checkKey(''), 'só a senha certa entra');
const base = SOM_LIBRARY.length;

const bad = await addSound({ title: 'x', emoji: '🔊', cat: 'meme', diff: 'facil' }, Buffer.alloc(3000, 1));
check(!bad.ok, 'arquivo que não é o WAV da página é recusado');

raceOnce = true;
const r = await addSound({ title: 'Grito do Primo!', emoji: '😱', cat: 'meme', diff: 'impossivel' }, wav(20000));
check(r.ok && r.sound!.id.startsWith('grito-do-primo-') && r.sound!.file === `${r.sound!.id}.wav`, `som salvo com id ${r.sound?.id}`);
check(tree().has(`client/public/som/${r.sound!.id}.wav`), 'o arquivo .wav foi para o repositório');
check(extra().length === 1 && extra()[0].title === 'Grito do Primo!', 'data/som-extra.json atualizado no mesmo commit');
check(messages.length === 1 && messages[0].includes('[skip render]'), 'commit com [skip render] (o servidor não reinicia); conflito resolvido tentando de novo');
check(SOM_LIBRARY.length === base + 1 && SOM_LIBRARY.some((s) => s.id === r.sound!.id), 'o servidor já sorteia o som novo na hora');

const r2 = await addSound({ title: 'Drop do phonk', emoji: '🏎️', cat: 'phonk', diff: 'impossivel' }, wav(10000));
check(r2.ok && extra().length === 2 && listSounds().length === 2, 'segundo som salvo');

const del = await removeSound(r.sound!.id);
check(del.ok && !tree().has(`client/public/som/${r.sound!.id}.wav`) && extra().length === 1, 'apagar tira o arquivo e a linha do repositório');
check(SOM_LIBRARY.length === base + 1 && !SOM_LIBRARY.some((s) => s.id === r.sound!.id), 'e some do sorteio na hora');

globalThis.fetch = (async () => new Response('{"message":"Bad credentials"}', { status: 401 })) as typeof fetch;
const fail = await addSound({ title: 'Sem token', emoji: '🔊', cat: 'meme', diff: 'facil' }, wav(10000));
check(!fail.ok && /GITHUB_TOKEN/.test(fail.error!), 'token errado: avisa sem quebrar nada');
check(SOM_LIBRARY.length === base + 1, 'e não mexe na biblioteca');

console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo!');
process.exit(failures ? 1 : 0);
