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
  { id: "1-108", title: "1 108", emoji: "🔊" },
  { id: "a-risada-do-kiko", title: "A risada do kiko", emoji: "😂" },
  { id: "aaaaaaaa-bird", title: "Aaaaaaaa bird", emoji: "🐦" },
  { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-e-lutador", title: "AAAAAAAAAA é lutador", emoji: "😱" },
  { id: "ack", title: "Ack", emoji: "😱" },
  { id: "ai-chaves-estourado", title: "Ai chaves estourado", emoji: "💥" },
  { id: "ai-chega-chega-estourado", title: "Ai chega chega estourado", emoji: "💥" },
  { id: "aiiiiiiiiiiiiiiiiiiiiiii-estourado", title: "Aiiiiiiiii estourado", emoji: "💥" },
  { id: "among-us-role-reveal-sound", title: "Among us role reveal sound", emoji: "📱" },
  { id: "anime-ahh", title: "Anime ahh", emoji: "🎌" },
  { id: "arrogante-neymar", title: "Arrogante neymar", emoji: "⚽" },
  { id: "aud-20200920-wa0045", title: "Áudio do zap", emoji: "🔊" },
  { id: "audio-do-carlinhos", title: "Audio do carlinhos", emoji: "🗣️" },
  { id: "ayyy-ayyy-ayyy-scream", title: "Ayyy ayyy ayyy scream", emoji: "😱" },
  { id: "baby-laughing-meme", title: "Baby laughing meme", emoji: "😂" },
  { id: "bankai-abarai-renji", title: "Bankai abarai renji", emoji: "🎌" },
  { id: "bankai-byakuya", title: "Bankai byakuya", emoji: "🎌" },
  { id: "bankai-kamishini-no-yari", title: "Bankai kamishini no yari", emoji: "🎌" },
  { id: "bankai-katen", title: "Bankai katen", emoji: "🎌" },
  { id: "bankai-shinji", title: "Bankai shinji", emoji: "🎌" },
  { id: "bob-esponja-fail-sound", title: "Bob esponja fail sound", emoji: "😱" },
  { id: "bom-diaaaaaaaaaaaaaaaa", title: "Bom diaaaaaaaaaaaaaaaa", emoji: "😱" },
  { id: "cat-laugh-meme-1", title: "Cat laugh meme 1", emoji: "🐱" },
  { id: "cebolinha-xingando", title: "Cebolinha xingando", emoji: "🔊" },
  { id: "chicken-on-tree-screaming", title: "Chicken on tree screaming", emoji: "🐦" },
  { id: "comedy-male-yelling-yee-ha-sound-effects-free-download-mp3cu", title: "Yee-ha!", emoji: "😱" },
  { id: "cuidado-som-estourado", title: "Cuidado som estourado", emoji: "💥" },
  { id: "death-whistle-57", title: "Death whistle 57", emoji: "🔊" },
  { id: "dolphin-laugh-lol", title: "Dolphin laugh lol", emoji: "🐬" },
  { id: "du-bist-gut-genug", title: "Du bist gut genug", emoji: "🔊" },
  { id: "e-q-eu-to-meio-gripadinha", title: "E q eu to meio gripadinha", emoji: "🗣️" },
  { id: "eagle-rahhh", title: "Eagle rahhh", emoji: "🐦" },
  { id: "elk-bugle", title: "Elk bugle", emoji: "🦌" },
  { id: "eu-nao-aguento-maaaais-mulher-com-raiva", title: "Eu nao aguento maaaais mulher com raiva", emoji: "😱" },
  { id: "faaah", title: "Faaah", emoji: "😱" },
  { id: "fading-scream", title: "Fading scream", emoji: "😱" },
  { id: "faz-o-l", title: "Faz o l", emoji: "🔊" },
  { id: "gato-mineiro", title: "Gato mineiro", emoji: "🐱" },
  { id: "goofy-ahh-snore", title: "Goofy ahh snore", emoji: "😴" },
  { id: "goofy-yell", title: "Goofy yell", emoji: "😱" },
  { id: "gopgopgop", title: "Gopgopgop", emoji: "🔊" },
  { id: "haaa-droga", title: "Haaa droga", emoji: "😱" },
  { id: "half-life-2-stalker-scream", title: "Half life 2 stalker scream", emoji: "😱" },
  { id: "hello-moto-estourado", title: "Hello moto estourado", emoji: "🎵" },
  { id: "ichigo-bankai", title: "Ichigo bankai", emoji: "🎌" },
  { id: "its-time-mariah-carey", title: "It's time (Mariah Carey)", emoji: "🎵" },
  { id: "kid-screaming-earrape", title: "Kid screaming earrape", emoji: "💥" },
  { id: "korn-twist-audiotrimmer", title: "Korn — Twist", emoji: "🎵" },
  { id: "long-brain-fart", title: "Long brain fart", emoji: "💨" },
  { id: "lula-alexandre-de-moraes", title: "Lula alexandre de moraes", emoji: "🗣️" },
  { id: "lula-e-neymar-47", title: "Lula e neymar 47", emoji: "🗣️" },
  { id: "lula-vai-todo-mindo-se-fdr", title: "Lula: vai todo mundo se f...", emoji: "🗣️" },
  { id: "m-e-o-w", title: "M e o w", emoji: "🐱" },
  { id: "makita-estourado", title: "Makita estourado", emoji: "💥" },
  { id: "miau-triste", title: "Miau triste", emoji: "🐱" },
  { id: "michael-jackson-hee-hee", title: "Michael jackson hee hee", emoji: "😂" },
  { id: "movie-1", title: "Movie", emoji: "🔊" },
  { id: "muda-muda-muda-sound-effect", title: "Muda muda muda sound effect", emoji: "🎌" },
  { id: "murder-in-my-mind-intro", title: "Murder In My Mind", emoji: "🎵" },
  { id: "musica-de-sigma-estourado", title: "Musica de sigma estourado", emoji: "🎵" },
  { id: "neon-blade-bass-boost", title: "Neon Blade bass boost", emoji: "🎵" },
  { id: "o-casal-mais-lindo-do-brasil", title: "O casal mais lindo do brasil", emoji: "😱" },
  { id: "oh-my-god-meme", title: "Oh my god meme", emoji: "🔊" },
  { id: "oh-wa-ah-ah-ah-disturbed-vocal-only", title: "Oh-wa-ah-ah-ah (Disturbed)", emoji: "🎵" },
  { id: "patchwork-frog-screaming", title: "Patchwork frog screaming", emoji: "🐸" },
  { id: "pega-o-jack-estourado", title: "Pega o jack estourado", emoji: "💥" },
  { id: "pegue-o-gato", title: "Pegue o gato", emoji: "🐱" },
  { id: "pergunta-pro-google", title: "Pergunta pro google", emoji: "📱" },
  { id: "plankton-oooooh", title: "Plankton oooooh", emoji: "🔊" },
  { id: "pou-estourado", title: "Pou estourado", emoji: "💥" },
  { id: "psycho-scream-soundbible", title: "Psycho scream soundbible", emoji: "😱" },
  { id: "raaar", title: "Raaar", emoji: "😱" },
  { id: "risada-do-gato", title: "Risada do gato", emoji: "🐱" },
  { id: "rpreplay-final1623689697-mov", title: "Gravação de tela misteriosa", emoji: "🔊" },
  { id: "scatman-john-intro", title: "Scatman John", emoji: "🎵" },
  { id: "scooby-doo-laugh-sped-up", title: "Scooby doo laugh sped up", emoji: "😂" },
  { id: "sia-chandelier", title: "Sia chandelier", emoji: "🎵" },
  { id: "slayer-angel-of-death-scream-when-you-accidentally-step-on-a", title: "Grito do Slayer (pisou no Lego)", emoji: "🎵" },
  { id: "som-buzina-estourado", title: "Som buzina estourado", emoji: "💥" },
  { id: "som-do-zap-zap-estourado", title: "Som do zap estourado", emoji: "💥" },
  { id: "song-aura", title: "Song aura", emoji: "🎵" },
  { id: "spiderman-meme-song", title: "Spiderman meme song", emoji: "🎵" },
  { id: "spongebob-fail", title: "Spongebob fail", emoji: "😱" },
  { id: "starwars-bird-e95kmuc", title: "Starwars bird", emoji: "🐦" },
  { id: "ta-travaaando-free-fire", title: "Ta travaaando free fire", emoji: "😱" },
  { id: "the-tokens-the-lion-sleeps-tonight-cutted", title: "The Lion Sleeps Tonight", emoji: "🎵" },
  { id: "the-who-yell-wont-get-fooled-again", title: "Grito do The Who", emoji: "🎵" },
  { id: "tiki-tiki-boosted", title: "Tiki tiki boosted", emoji: "🎵" },
  { id: "tom-and-jerry-scream-sound-effect", title: "Tom and jerry scream sound effect", emoji: "😱" },
  { id: "tom-and-jerry-screaming", title: "Tom and jerry screaming", emoji: "😱" },
  { id: "untitled-605", title: "Áudio sem nome 605", emoji: "🔊" },
  { id: "vai-corinthians-estouradasso", title: "Vai corinthians estouradasso", emoji: "⚽" },
  { id: "zehahaha-laugh", title: "Zehahaha laugh", emoji: "🎌" },
  // ↑ novos sons entram aqui (npm run som:add)
];

/** Sons salvos pelo dono do site na página /admin. */
export const SOM_EXTRA: SomEntry[] = (extra as SomEntry[]).map(({ id, title, emoji, file }) => ({ id, title, emoji, ...(file ? { file } : {}) }));

/** Biblioteca completa (o servidor acrescenta aqui, na hora, o que for salvo pelo /admin). */
export const SOM_LIBRARY: SomEntry[] = [...BASE, ...SOM_EXTRA];
