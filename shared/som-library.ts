/**
 * Biblioteca do "Faz Esse Som!".
 *
 * A graça do jogo é a dificuldade ABSURDA de reproduzir o som com a boca — nada de frases comuns.
 * Cada som é um arquivo curtinho (0,5–2s) em client/public/som/<id>.mp3.
 * Todos os sons daqui foram criados pelo próprio projeto (sintetizados com o ffmpeg ou feitos a partir
 * de uma voz neural offline e muito distorcidos — veja scripts/gen-som.ts). Os "memes" e o "phonk"
 * são criações originais no MESMO ESTILO das referências, não os áudios originais (que têm dono).
 *
 * O dono do site também pode salvar sons pela página /admin (ficam em data/som-extra.json + client/public/som).
 *
 * Para adicionar um som novo pelo terminal (de um arquivo que você tenha direito de usar):
 *   npm run som:add -- caminho/do/arquivo.mp3 id-do-som "Título" 🐸 categoria dificuldade [início] [duração]
 * Ex.: npm run som:add -- grito.mp3 grito-do-joao "Grito do João" 😱 meme impossivel 0.4 1.2
 * O comando corta (máx. 2s), controla o volume, salva em client/public/som/ e acrescenta a linha aqui.
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
  // ---- memes / shitpost: gritos e vozes absurdas ----
  { id: 'faaah', title: 'FAAAHHH agudo', emoji: '😩', cat: 'meme', diff: 'dificil' },
  { id: 'auugh', title: 'AUUGHHH bizarro', emoji: '😫', cat: 'meme', diff: 'dificil' },
  { id: 'grito-goofy', title: 'Grito goofy ahh distorcido', emoji: '🤪', cat: 'meme', diff: 'impossivel' },
  { id: 'grito-cartoon', title: 'Grito de gato de desenho', emoji: '🙀', cat: 'meme', diff: 'dificil' },
  { id: 'grito-saturado', title: 'Grito de microfone saturado', emoji: '🎙️', cat: 'meme', diff: 'impossivel' },
  { id: 'grito-agudo', title: 'Grito com pitch lá no alto', emoji: '🐭', cat: 'meme', diff: 'dificil' },
  { id: 'grito-bass', title: 'Grito de terror bass boosted', emoji: '🔊', cat: 'meme', diff: 'impossivel' },
  { id: 'risada-turbo', title: 'Risada goofy acelerada', emoji: '🤣', cat: 'meme', diff: 'impossivel' },
  { id: 'risada-maligna', title: 'Risada maligna distorcida', emoji: '😈', cat: 'meme', diff: 'dificil' },
  { id: 'oof-bass', title: 'OOF bass boosted', emoji: '💢', cat: 'meme', diff: 'dificil' },
  // ---- memes / shitpost: efeitos clássicos ----
  { id: 'boom-grave', title: 'BOOM grave dramático', emoji: '🗿', cat: 'meme', diff: 'dificil' },
  { id: 'cano-metal', title: 'Cano de metal caindo', emoji: '🔩', cat: 'meme', diff: 'impossivel' },
  { id: 'impacto-ameaca', title: 'Impacto grave ameaçador', emoji: '😨', cat: 'meme', diff: 'dificil' },
  { id: 'boing-exagerado', title: 'Boing exagerado', emoji: '🌀', cat: 'meme', diff: 'dificil' },
  { id: 'corrida-cartoon', title: 'Corrida goofy ahh', emoji: '🏃', cat: 'meme', diff: 'impossivel' },
  { id: 'buzina-goofy', title: 'Buzina goofy', emoji: '🚗', cat: 'meme', diff: 'dificil' },
  { id: 'apito-maluco', title: 'Apito sobe-e-desce', emoji: '🎺', cat: 'meme', diff: 'dificil' },
  { id: 'pum-eco', title: 'Pum com eco de catedral', emoji: '💨', cat: 'meme', diff: 'dificil' },
  { id: 'pum-bass', title: 'Pum bass boosted', emoji: '🍑', cat: 'meme', diff: 'impossivel' },
  { id: 'air-horn', title: 'Buzina de MLG estourada', emoji: '📯', cat: 'meme', diff: 'dificil' },
  { id: 'bong-grave', title: 'Bong grave', emoji: '🔔', cat: 'meme', diff: 'facil' },
  { id: 'bonk', title: 'Bonk na cabeça', emoji: '🔨', cat: 'meme', diff: 'facil' },
  { id: 'boowomp', title: 'Boowomp triste', emoji: '😔', cat: 'meme', diff: 'dificil' },
  { id: 'scratch', title: 'Scratch de disco acelerado', emoji: '💿', cat: 'meme', diff: 'impossivel' },
  { id: 'explosao-bass', title: 'Explosão bass boosted', emoji: '💥', cat: 'meme', diff: 'dificil' },
  { id: 'mola-metal', title: 'Mola de metal vibrando', emoji: '🪀', cat: 'meme', diff: 'impossivel' },
  // ---- memes / shitpost: caos estourado ----
  { id: 'erro-earrape', title: 'Erro do computador (earrape)', emoji: '🖥️', cat: 'meme', diff: 'dificil' },
  { id: 'notificacao-estourada', title: 'Notificação estourada', emoji: '📱', cat: 'meme', diff: 'dificil' },
  { id: 'alarme-agudo', title: 'Alarme de emergência agudo', emoji: '🚨', cat: 'meme', diff: 'dificil' },
  { id: 'sirene-meme', title: 'Sirene de polícia distorcida', emoji: '🚓', cat: 'meme', diff: 'dificil' },
  { id: 'modem-turbo', title: 'Internet discada turbo', emoji: '📠', cat: 'meme', diff: 'impossivel' },
  { id: 'glitch', title: 'Glitch eletrônico', emoji: '👾', cat: 'meme', diff: 'impossivel' },
  { id: 'gato-estourado', title: 'Gato gritando estourado', emoji: '😾', cat: 'meme', diff: 'dificil' },
  { id: 'cabra-bass', title: 'Cabra gritando bass boosted', emoji: '🐐', cat: 'meme', diff: 'impossivel' },
  { id: 'monstro-turbo', title: 'Monstro em velocidade absurda', emoji: '👹', cat: 'meme', diff: 'impossivel' },
  { id: 'goofy-combo', title: 'Combo goofy: buzina + grito + pancada', emoji: '🤡', cat: 'meme', diff: 'impossivel' },
  // ---- phonk insano (criações originais no estilo) ----
  { id: 'phonk-cowbell', title: 'Drift phonk: cowbell + 808', emoji: '🏎️', cat: 'phonk', diff: 'impossivel' },
  { id: 'phonk-montagem', title: 'Montagem automotiva', emoji: '🔊', cat: 'phonk', diff: 'impossivel' },
  { id: 'phonk-vocal', title: 'Vocal chops acelerados', emoji: '🗣️', cat: 'phonk', diff: 'impossivel' },
  { id: 'phonk-808', title: 'Drop de grave deslizando', emoji: '🫨', cat: 'phonk', diff: 'impossivel' },
  { id: 'phonk-bounce', title: 'Funk do bounce', emoji: '🍑', cat: 'phonk', diff: 'impossivel' },
  { id: 'phonk-caos', title: 'Phonk edit: grito + grave + cowbell', emoji: '💀', cat: 'phonk', diff: 'impossivel' },
  { id: 'phonk-sirene', title: 'Synth sirene do phonk', emoji: '🌀', cat: 'phonk', diff: 'impossivel' },
  // ---- animais ----
  { id: 'cuco', title: 'Relógio cuco', emoji: '🐦', cat: 'bicho', diff: 'facil' },
  { id: 'grilo', title: 'Grilo de madrugada', emoji: '🦗', cat: 'bicho', diff: 'dificil' },
  { id: 'sapo', title: 'Sapo coaxando', emoji: '🐸', cat: 'bicho', diff: 'dificil' },
  { id: 'passarinho', title: 'Passarinho agitado', emoji: '🐤', cat: 'bicho', diff: 'dificil' },
  { id: 'ave-rapina', title: 'Grito de ave de rapina', emoji: '🦅', cat: 'bicho', diff: 'dificil' },
  { id: 'rugido', title: 'Rugido de monstro', emoji: '🦁', cat: 'bicho', diff: 'dificil' },
  { id: 'miau', title: 'Gato fininho', emoji: '🐱', cat: 'bicho', diff: 'facil' },
  { id: 'guau', title: 'Cachorro latindo', emoji: '🐶', cat: 'bicho', diff: 'facil' },
  { id: 'muu', title: 'Vaca', emoji: '🐮', cat: 'bicho', diff: 'facil' },
  { id: 'galo', title: 'Galo italiano', emoji: '🐓', cat: 'bicho', diff: 'facil' },
  { id: 'cabra', title: 'Cabra tremendo', emoji: '🐐', cat: 'bicho', diff: 'dificil' },
  { id: 'pato', title: 'Pato apressado', emoji: '🦆', cat: 'bicho', diff: 'facil' },
  // ---- animes em japonês ----
  { id: 'nani', title: 'NANI?!', emoji: '😱', cat: 'anime', diff: 'facil' },
  { id: 'yamete', title: 'Yamete!', emoji: '🙅', cat: 'anime', diff: 'facil' },
  { id: 'sugoi', title: 'Sugoi!', emoji: '🤩', cat: 'anime', diff: 'facil' },
  { id: 'baka', title: 'BAKA!', emoji: '😤', cat: 'anime', diff: 'facil' },
  { id: 'kawaii', title: 'Kawaii!', emoji: '🥰', cat: 'anime', diff: 'dificil' },
  { id: 'yatta', title: 'Yatta!', emoji: '🙌', cat: 'anime', diff: 'facil' },
  { id: 'itadakimasu', title: 'Itadakimasu!', emoji: '🍜', cat: 'anime', diff: 'dificil' },
  // ---- jogos ----
  { id: 'moeda', title: 'Pegou a moeda', emoji: '🪙', cat: 'jogo', diff: 'facil' },
  { id: 'pulo', title: 'Pulinho 8-bit', emoji: '🕹️', cat: 'jogo', diff: 'facil' },
  { id: 'powerup', title: 'Power-up', emoji: '⭐', cat: 'jogo', diff: 'dificil' },
  { id: 'game-over', title: 'Game over', emoji: '💀', cat: 'jogo', diff: 'dificil' },
  { id: 'laser', title: 'Laser pew pew', emoji: '🔫', cat: 'jogo', diff: 'facil' },
  { id: 'fanfarra', title: 'Fanfarra de vitória', emoji: '🏆', cat: 'jogo', diff: 'dificil' },
  { id: 'robo-bip', title: 'Robô computando', emoji: '🤖', cat: 'jogo', diff: 'impossivel' },
  // ---- efeitos sonoros ----
  { id: 'boing', title: 'Boing!', emoji: '🌀', cat: 'efeito', diff: 'facil' },
  { id: 'apito', title: 'Apito subindo', emoji: '🎺', cat: 'efeito', diff: 'facil' },
  { id: 'queda', title: 'Caindo do penhasco', emoji: '🪂', cat: 'efeito', diff: 'facil' },
  { id: 'trombone', title: 'Trombone triste', emoji: '🎷', cat: 'efeito', diff: 'dificil' },
  { id: 'buzina', title: 'Buzina de palhaço', emoji: '🤡', cat: 'efeito', diff: 'facil' },
  { id: 'patinho', title: 'Patinho de borracha', emoji: '🐥', cat: 'efeito', diff: 'dificil' },
  { id: 'ricochete', title: 'Ricochete', emoji: '💫', cat: 'efeito', diff: 'dificil' },
  { id: 'bolhas', title: 'Bolhas', emoji: '🫧', cat: 'efeito', diff: 'dificil' },
  { id: 'plim', title: 'Plim!', emoji: '✨', cat: 'efeito', diff: 'facil' },
  { id: 'explosao', title: 'Explosão', emoji: '💣', cat: 'efeito', diff: 'dificil' },
  { id: 'sirene', title: 'Sirene', emoji: '🚨', cat: 'efeito', diff: 'facil' },
  { id: 'alarme', title: 'Alarme', emoji: '⏰', cat: 'efeito', diff: 'facil' },
  { id: 'alien', title: 'Alienígena chegando', emoji: '👽', cat: 'efeito', diff: 'dificil' },
  { id: 'disco-voador', title: 'Disco voador', emoji: '🛸', cat: 'efeito', diff: 'dificil' },
  { id: 'modem', title: 'Internet discada', emoji: '📠', cat: 'efeito', diff: 'impossivel' },
  { id: 'pum', title: 'Pum', emoji: '💨', cat: 'efeito', diff: 'facil' },
  // ↑ novos sons entram aqui (npm run som:add)
];

/** Sons salvos pelo dono do site na página /admin. */
export const SOM_EXTRA: SomEntry[] = extra as SomEntry[];

/** Biblioteca completa (o servidor acrescenta aqui, na hora, o que for salvo pelo /admin). */
export const SOM_LIBRARY: SomEntry[] = [...BASE, ...SOM_EXTRA];
