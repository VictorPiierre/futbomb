/**
 * Biblioteca do "Faz Esse Som!": uma lista só, sem temas nem dificuldades.
 *
 * Os sons são escolhidos pelo dono do site: ele salva cada um pela página /admin
 * (o arquivo vai para client/public/som/ e a linha para data/som-extra.json).
 *
 * Também dá para acrescentar pelo terminal:
 *   npm run som:add -- caminho/do/arquivo.mp3 id-do-som "Título" 🐸 [início] [duração]
 */
import extra from '../data/som-extra.json';

export interface SomEntry {
  id: string;
  title: string;
  emoji: string;
  /** Arquivo em client/public/som (padrão: <id>.mp3). */
  file?: string;
}

const BASE: SomEntry[] = [
  // ↑ novos sons entram aqui (npm run som:add)
];

/** Sons salvos pelo dono do site na página /admin. */
export const SOM_EXTRA: SomEntry[] = (extra as SomEntry[]).map(({ id, title, emoji, file }) => ({ id, title, emoji, ...(file ? { file } : {}) }));

/** Biblioteca completa (o servidor acrescenta aqui, na hora, o que for salvo pelo /admin). */
export const SOM_LIBRARY: SomEntry[] = [...BASE, ...SOM_EXTRA];
