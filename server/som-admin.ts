/**
 * Página /admin do "Faz Esse Som!": só o dono do site (com a senha) salva sons novos para sempre.
 *
 * Os sons ficam no próprio repositório do jogo no GitHub (client/public/som/<id>.wav + data/som-extra.json),
 * igual aos sons que vieram com o jogo. O commit leva "[skip render]" para o servidor não reiniciar
 * (as partidas em andamento continuam); o servidor já passa a sortear o som na hora, e o site
 * (Vercel) publica o arquivo em ~1 minuto — até lá o áudio é lido direto do GitHub.
 *
 * Configuração (variáveis de ambiente no Render):
 *   SOM_ADMIN_KEY  senha da página /admin (escolhida pelo dono)
 *   GITHUB_TOKEN   token do GitHub com permissão "Contents: read and write" só no repositório do jogo
 *   GITHUB_REPO    opcional, padrão VictorPiierre/futbomb
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SOM_CATEGORIES, SOM_DIFFICULTIES, SOM_EXTRA, SOM_LIBRARY, type SomCategory, type SomDifficulty, type SomEntry } from '../shared/som-library.ts';

const REPO = process.env.GITHUB_REPO || 'VictorPiierre/futbomb';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const EXTRA_PATH = 'data/som-extra.json';
const SOUND_DIR = 'client/public/som';
export const ADMIN_MAX_BYTES = 400_000;
const TITLE_MAX = 40;

export function adminConfigured() {
  return !!process.env.SOM_ADMIN_KEY && !!process.env.GITHUB_TOKEN;
}

/** Compara a senha sem vazar tempo de comparação. */
export function checkKey(key: unknown) {
  const real = process.env.SOM_ADMIN_KEY;
  if (!real || typeof key !== 'string' || !key) return false;
  const a = createHash('sha256').update(key).digest();
  const b = createHash('sha256').update(real).digest();
  return timingSafeEqual(a, b);
}

// ---------- GitHub (API de dados do git: um commit com vários arquivos) ----------

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jogatina-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

interface Change {
  path: string;
  /** Conteúdo novo (base64) ou null para apagar o arquivo. */
  base64: string | null;
}

/** Lê o data/som-extra.json atual do repositório (a fonte da verdade). */
async function readExtra(commitSha: string): Promise<SomEntry[]> {
  try {
    const f = await gh<{ content: string }>(`/contents/${EXTRA_PATH}?ref=${commitSha}`);
    return JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'));
  } catch {
    return [];
  }
}

/**
 * Lê a lista atual, aplica `edit` e grava tudo num commit só. Se alguém mexeu no repositório
 * no meio do caminho, tenta de novo a partir da versão nova.
 */
async function commit(message: string, edit: (list: SomEntry[]) => { list: SomEntry[]; files: Change[] }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${BRANCH}`);
    const head = ref.object.sha;
    const headCommit = await gh<{ tree: { sha: string } }>(`/git/commits/${head}`);
    const { list, files } = edit(await readExtra(head));
    const changes: Change[] = [...files, { path: EXTRA_PATH, base64: Buffer.from(`${JSON.stringify(list, null, 2)}\n`).toString('base64') }];
    const tree = await Promise.all(
      changes.map(async (c) => {
        if (c.base64 === null) return { path: c.path, mode: '100644', type: 'blob', sha: null };
        const blob = await gh<{ sha: string }>('/git/blobs', { method: 'POST', body: JSON.stringify({ content: c.base64, encoding: 'base64' }) });
        return { path: c.path, mode: '100644', type: 'blob', sha: blob.sha };
      }),
    );
    const newTree = await gh<{ sha: string }>('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }) });
    const newCommit = await gh<{ sha: string }>('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }),
    });
    try {
      await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha, force: false }) });
      return list;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  throw new Error('não deu para salvar');
}

/** Atualiza a lista em memória (servidor) para bater com o repositório. */
function syncMemory(list: SomEntry[]) {
  const baseCount = SOM_LIBRARY.length - SOM_EXTRA.length;
  SOM_LIBRARY.splice(baseCount, SOM_LIBRARY.length - baseCount, ...list);
  SOM_EXTRA.splice(0, SOM_EXTRA.length, ...list);
}

// Uma operação por vez.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

function slug(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'som';
}

export async function addSound(meta: { title?: unknown; emoji?: unknown; cat?: unknown; diff?: unknown }, data: unknown): Promise<{ ok: boolean; error?: string; sound?: SomEntry }> {
  const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!buf || buf.length < 500) return { ok: false, error: 'Áudio vazio.' };
  if (buf.length > ADMIN_MAX_BYTES) return { ok: false, error: 'Áudio grande demais.' };
  // Só o WAV que a própria página gera (cortado em até 2s e com volume ajustado).
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, error: 'Formato de áudio inválido.' };
  const title = String(meta?.title ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (!title) return { ok: false, error: 'Dê um nome para o som.' };
  const emoji = [...String(meta?.emoji ?? '')].slice(0, 2).join('') || '🔊';
  const cat = String(meta?.cat) as SomCategory;
  const diff = String(meta?.diff) as SomDifficulty;
  if (!(cat in SOM_CATEGORIES)) return { ok: false, error: 'Tema inválido.' };
  if (!(diff in SOM_DIFFICULTIES)) return { ok: false, error: 'Dificuldade inválida.' };
  const id = `${slug(title)}-${randomBytes(2).toString('hex')}`;
  const sound: SomEntry = { id, title, emoji, cat, diff, file: `${id}.wav` };
  try {
    const list = await serial(() =>
      commit(`Add sound "${title}" via /admin [skip render]`, (current) => ({
        list: [...current.filter((s) => s.id !== id), sound],
        files: [{ path: `${SOUND_DIR}/${sound.file}`, base64: buf.toString('base64') }],
      })),
    );
    syncMemory(list);
    return { ok: true, sound };
  } catch (e) {
    console.error('admin addSound', e);
    return { ok: false, error: 'Não consegui salvar no GitHub. Confira o GITHUB_TOKEN no Render.' };
  }
}

export async function removeSound(id: unknown): Promise<{ ok: boolean; error?: string }> {
  if (typeof id !== 'string') return { ok: false, error: 'Som inválido.' };
  try {
    const list = await serial(() =>
      commit(`Remove sound "${id}" via /admin [skip render]`, (current) => {
        const s = current.find((x) => x.id === id);
        return { list: current.filter((x) => x.id !== id), files: s ? [{ path: `${SOUND_DIR}/${s.file ?? `${s.id}.mp3`}`, base64: null }] : [] };
      }),
    );
    syncMemory(list);
    return { ok: true };
  } catch (e) {
    console.error('admin removeSound', e);
    return { ok: false, error: 'Não consegui apagar no GitHub.' };
  }
}

export function listSounds() {
  return [...SOM_EXTRA];
}
