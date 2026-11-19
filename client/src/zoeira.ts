/**
 * Frases de zoeira para os momentos engraçados dos jogos.
 * A escolha é determinística pela "semente" (sala + rodada + jogador), então todo mundo vê a mesma frase.
 */
function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pick<T>(list: readonly T[], seed: string): T {
  return list[hash(seed) % list.length];
}

/** Pavio Curto: alguém deixou a bomba explodir na mão. */
export const EXPLODE = [
  (n: string) => `💥 ${n} virou pipoca!`,
  (n: string) => `💥 ${n} travou igual Windows 98 e a bomba explodiu!`,
  (n: string) => `💥 BOOM! ${n} ficou com o cabelo de cientista maluco.`,
  (n: string) => `💥 ${n} esqueceu todas as palavras do português.`,
  (n: string) => `💥 ${n} pensou, pensou… e explodiu.`,
  (n: string) => `💥 ${n} agora está defumado. 🥓`,
  (n: string) => `💥 Alguém chama os bombeiros pro ${n}!`,
  (n: string) => `💥 ${n} deu tela azul.`,
  (n: string) => `💥 ${n} segurou a bomba igual batata quente… e queimou.`,
  (n: string) => `💥 ${n} foi de base. Pelo menos foi com estilo.`,
];

/** Pavio Curto: eliminado. */
export const ELIMINATED = [
  (n: string) => `☠️ ${n} foi eliminado! F no chat.`,
  (n: string) => `☠️ ${n} virou cinzas. Descanse em paz.`,
  (n: string) => `☠️ ${n} saiu da partida carbonizado.`,
  (n: string) => `☠️ ${n} agora é só um fantasminha assistindo. 👻`,
  (n: string) => `☠️ Fim da linha pro ${n}. Alguém segura o choro.`,
];

/** Torre de Lava: engolido pela lava (n = nomes). */
export const SWALLOWED = [
  (n: string, many: boolean) => `🫕 ${n} ${many ? 'viraram' : 'virou'} fondue!`,
  (n: string, many: boolean) => `🔥 ${n} ${many ? 'derreteram' : 'derreteu'} igual sorvete no sol.`,
  (n: string, many: boolean) => `🌋 A lava ${many ? 'jantou' : 'almoçou'} ${n}.`,
  (n: string, many: boolean) => `🍢 ${n} ${many ? 'viraram' : 'virou'} espetinho de lava.`,
  (n: string, many: boolean) => `🔥 ${n} ${many ? 'tomaram' : 'tomou'} um banho quentinho demais.`,
  (n: string, many: boolean) => `🫠 ${n} ${many ? 'esqueceram' : 'esqueceu'} que o chão era lava.`,
];

/** Chutômetro: o chute mais absurdo da rodada. */
export const WILD_GUESS = [
  'chutou com o pé esquerdo',
  'chutou de olho fechado',
  'chutou na arquibancada',
  'chutou pra Marte',
  'chutou e o goleiro nem precisou pular',
  'usou a calculadora de cabeça pra baixo',
  'chutou baseado em sentimentos',
];

/** Ouvidão: a resposta mais longe da palavra. */
export const DEAF = [
  'Ouvido de tuberculoso',
  'Ouviu com o cotovelo',
  'Precisa de um cotonete urgente',
  'Escutou outra música',
  'Tradutor do Google em 2008',
  'Ouviu e escreveu em élfico',
];

/** Mentirômetro: título da mentira que mais enganou. */
export const BEST_LIE = [
  'Mentiroso profissional',
  'Deveria ser político',
  'Pinóquio ficaria orgulhoso',
  'Cara de pau nível máximo',
  'Advogado do diabo',
  'Contador de lorota oficial',
];

/** Mentirômetro: legenda para quem caiu numa mentira. */
export const FELL = ['caíram feito patinhos:', 'acreditaram:', 'foram enganados:', 'compraram essa:', 'engoliram essa:'];

/** Faz Esse Som!: título para o mais votado da rodada. */
export const BEST_IMITATION = [
  'Imitador profissional',
  'Deveria trabalhar com dublagem',
  'Cordas vocais de outro planeta',
  'Isso foi assustadoramente parecido',
  'O próprio som em pessoa',
  'Talento desperdiçado',
  'Ganhou na garganta',
];

/** Tela final: zoeira para o último colocado (lanterninha). */
export const LAST_PLACE = [
  'pelo menos participou',
  'veio só pela companhia',
  'estava jogando de olhos fechados',
  'jura que deixou os outros ganharem',
  'vai treinar escondido pra revanche',
  'jogou com o controle desligado',
  'diz que a internet caiu',
];
