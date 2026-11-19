/**
 * Biblioteca do "Faz Esse Som!".
 *
 * Cada som é um arquivo curtinho (≈1s) em client/public/som/<id>.mp3.
 * Todos os sons daqui foram gerados pelo próprio projeto (sintetizados com o ffmpeg ou falados por
 * uma voz neural offline — veja scripts/gen-som.ts), então não há problema de direitos.
 *
 * Para adicionar um som novo (de um arquivo que você tenha direito de usar):
 *   npm run som:add -- caminho/do/arquivo.mp3 id-do-som "Título que aparece" 🐸 bicho
 * O comando corta para no máximo 1,5s, ajusta o volume, salva em client/public/som/ e
 * acrescenta a linha nesta lista automaticamente.
 */
export type SomCategory = 'bicho' | 'jogo' | 'desenho' | 'anime' | 'voz' | 'absurdo';

export interface SomEntry {
  id: string;
  title: string;
  emoji: string;
  cat: SomCategory;
}

export const SOM_CATEGORIES: Record<SomCategory, string> = {
  bicho: 'Bichos',
  jogo: 'Videogame',
  desenho: 'Desenho animado',
  anime: 'Grito de anime',
  voz: 'Vozes absurdas',
  absurdo: 'Efeitos absurdos',
};

export const SOM_LIBRARY: SomEntry[] = [
  // ---- bichos ----
  { id: 'cuco', title: 'Relógio cuco', emoji: '🐦', cat: 'bicho' },
  { id: 'grilo', title: 'Grilo de madrugada', emoji: '🦗', cat: 'bicho' },
  { id: 'sapo', title: 'Sapo coaxando', emoji: '🐸', cat: 'bicho' },
  { id: 'passarinho', title: 'Passarinho agitado', emoji: '🐤', cat: 'bicho' },
  { id: 'ave-rapina', title: 'Grito de ave de rapina', emoji: '🦅', cat: 'bicho' },
  { id: 'rugido', title: 'Rugido de monstro', emoji: '🦁', cat: 'bicho' },
  { id: 'miau', title: 'Gato fininho', emoji: '🐱', cat: 'bicho' },
  { id: 'guau', title: 'Cachorro espanhol', emoji: '🐶', cat: 'bicho' },
  { id: 'muu', title: 'Vaca alemã', emoji: '🐮', cat: 'bicho' },
  { id: 'galo', title: 'Galo italiano', emoji: '🐓', cat: 'bicho' },
  { id: 'cabra', title: 'Cabra tremendo', emoji: '🐐', cat: 'bicho' },
  { id: 'pato', title: 'Pato apressado', emoji: '🦆', cat: 'bicho' },
  // ---- videogame ----
  { id: 'moeda', title: 'Pegou a moeda', emoji: '🪙', cat: 'jogo' },
  { id: 'pulo', title: 'Pulinho 8-bit', emoji: '🕹️', cat: 'jogo' },
  { id: 'powerup', title: 'Power-up', emoji: '⭐', cat: 'jogo' },
  { id: 'game-over', title: 'Game over', emoji: '💀', cat: 'jogo' },
  { id: 'laser', title: 'Laser pew pew', emoji: '🔫', cat: 'jogo' },
  { id: 'fanfarra', title: 'Fanfarra de vitória', emoji: '🏆', cat: 'jogo' },
  { id: 'robo-bip', title: 'Robô computando', emoji: '🤖', cat: 'jogo' },
  // ---- desenho animado ----
  { id: 'boing', title: 'Boing!', emoji: '🌀', cat: 'desenho' },
  { id: 'apito', title: 'Apito subindo', emoji: '🎺', cat: 'desenho' },
  { id: 'queda', title: 'Caindo do penhasco', emoji: '🪂', cat: 'desenho' },
  { id: 'trombone', title: 'Trombone triste', emoji: '🎷', cat: 'desenho' },
  { id: 'buzina', title: 'Buzina de palhaço', emoji: '🤡', cat: 'desenho' },
  { id: 'patinho', title: 'Patinho de borracha', emoji: '🐥', cat: 'desenho' },
  { id: 'ricochete', title: 'Ricochete', emoji: '💥', cat: 'desenho' },
  { id: 'bolhas', title: 'Bolhas', emoji: '🫧', cat: 'desenho' },
  { id: 'plim', title: 'Plim!', emoji: '🔔', cat: 'desenho' },
  // ---- grito de anime ----
  { id: 'nani', title: 'NANI?!', emoji: '😱', cat: 'anime' },
  { id: 'yamete', title: 'Yamete!', emoji: '🙅', cat: 'anime' },
  { id: 'sugoi', title: 'Sugoi!', emoji: '🤩', cat: 'anime' },
  { id: 'baka', title: 'BAKA!', emoji: '😤', cat: 'anime' },
  { id: 'kawaii', title: 'Kawaii!', emoji: '🥰', cat: 'anime' },
  { id: 'yatta', title: 'Yatta!', emoji: '🙌', cat: 'anime' },
  { id: 'itadakimasu', title: 'Itadakimasu!', emoji: '🍜', cat: 'anime' },
  // ---- vozes absurdas ----
  { id: 'mamma-mia', title: 'Mamma mia!', emoji: '🤌', cat: 'voz' },
  { id: 'ay-caramba', title: '¡Ay, caramba!', emoji: '🌶️', cat: 'voz' },
  { id: 'oh-la-la', title: 'Oh là là!', emoji: '🥐', cat: 'voz' },
  { id: 'yeehaw', title: 'Yee-haw!', emoji: '🤠', cat: 'voz' },
  { id: 'vilao', title: 'Risada de vilão', emoji: '😈', cat: 'voz' },
  { id: 'esquilo', title: 'Esquilo cumprimentando', emoji: '🐿️', cat: 'voz' },
  { id: 'demonio', title: 'Bom dia do demônio', emoji: '👹', cat: 'voz' },
  { id: 'grito', title: 'Grito desesperado', emoji: '😫', cat: 'voz' },
  { id: 'kartoffel', title: 'KARTOFFEL!', emoji: '🥔', cat: 'voz' },
  { id: 'robo-voz', title: 'Voz de robô', emoji: '🦾', cat: 'voz' },
  // ---- efeitos absurdos ----
  { id: 'explosao', title: 'Explosão', emoji: '💣', cat: 'absurdo' },
  { id: 'sirene', title: 'Sirene', emoji: '🚨', cat: 'absurdo' },
  { id: 'alarme', title: 'Alarme', emoji: '⏰', cat: 'absurdo' },
  { id: 'alien', title: 'Alienígena chegando', emoji: '👽', cat: 'absurdo' },
  { id: 'disco-voador', title: 'Disco voador', emoji: '🛸', cat: 'absurdo' },
  { id: 'modem', title: 'Internet discada', emoji: '📠', cat: 'absurdo' },
  { id: 'pum', title: 'Pum', emoji: '💨', cat: 'absurdo' },
  // ↑ novos sons entram aqui (npm run som:add)
];
