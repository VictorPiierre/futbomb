/**
 * Biblioteca do "Faz Esse Som!".
 *
 * Os sons são escolhidos pelo dono do site: ele salva cada um pela página /admin
 * (o arquivo vai para client/public/som/ e a linha para data/som-extra.json).
 * A graça do jogo é a dificuldade ABSURDA de reproduzir o som com a boca.
 *
 * Também dá para acrescentar pelo terminal:
 *   npm run som:add -- caminho/do/arquivo.mp3 id-do-som "Título" 🐸 categoria dificuldade [início] [duração]
 */
import extra from '../data/som-extra.json';

export type SomCategory = 'meme' | 'phonk' | 'musica' | 'bicho' | 'anime' | 'jogo' | 'efeito';
export type SomDifficulty = 'facil' | 'dificil' | 'impossivel';

export interface SomEntry {
  id: string;
  title: string;
  emoji: string;
  cat: SomCategory;
  diff: SomDifficulty;
  /** Arquivo em client/public/som (padrão: <id>.mp3). */
  file?: string;
}

export const SOM_CATEGORIES: Record<SomCategory, { label: string; emoji: string }> = {
  meme: { label: 'Memes / Shitpost', emoji: '😂' },
  phonk: { label: 'Phonk insano', emoji: '🔥' },
  musica: { label: 'Músicas', emoji: '🎤' },
  bicho: { label: 'Animais', emoji: '🐾' },
  anime: { label: 'Animes em japonês', emoji: '🎌' },
  jogo: { label: 'Jogos', emoji: '🕹️' },
  efeito: { label: 'Efeitos sonoros', emoji: '💥' },
};

export const SOM_DIFFICULTIES: Record<SomDifficulty, { label: string; emoji: string; hint: string }> = {
  facil: { label: 'Fácil', emoji: '🟢', hint: 'Sons esquisitos, mas dá pra imitar.' },
  dificil: { label: 'Difícil', emoji: '🟠', hint: 'Gritos estranhos, vozes agudas e sons complexos.' },
  impossivel: { label: 'Impossível', emoji: '💀', hint: 'Phonk, grave estourado, ruído eletrônico e caos.' },
};

/** Categorias em que o efeito de karaokê/show fica disponível na gravação. */
export const SOM_KARAOKE_CATS: SomCategory[] = ['musica', 'phonk'];
/** Categorias em que o "microfone estourado" fica disponível. */
export const SOM_BLOWN_CATS: SomCategory[] = ['meme'];

const BASE: SomEntry[] = [
  // ↑ novos sons entram aqui (npm run som:add)
];

/** Sons salvos pelo dono do site na página /admin. */
export const SOM_EXTRA: SomEntry[] = extra as SomEntry[];

/** Biblioteca completa (o servidor acrescenta aqui, na hora, o que for salvo pelo /admin). */
export const SOM_LIBRARY: SomEntry[] = [...BASE, ...SOM_EXTRA];
