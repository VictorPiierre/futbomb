/**
 * Banco do Mentirômetro: curiosidades verdadeiras com uma lacuna (____).
 * Formato: "pergunta|resposta|outras formas aceitas separadas por /".
 * A resposta é a que aparece entre as alternativas; as outras formas só servem
 * para recusar mentiras que, na verdade, são a resposta certa.
 */
const RAW = [
  'O coração do camarão fica localizado na ____.|cabeça',
  'O polvo tem ____ corações.|três|3',
  'O sangue do polvo é da cor ____.|azul',
  'O animal nacional da Escócia é o ____.|unicórnio',
  'Em 1932, a Austrália declarou guerra contra ____ — e perdeu.|emus|emu/ema/emas',
  'As lontras-marinhas dormem de ____ para não se afastarem umas das outras.|mãos dadas|mao dada/de maos dadas',
  'O mel, guardado direitinho, praticamente nunca ____.|estraga|apodrece/vence',
  'Um dia em Vênus é mais longo que um ____ em Vênus.|ano',
  'Cleópatra viveu mais perto da invenção do ____ do que da construção da Grande Pirâmide.|iPhone|celular/smartphone',
  'As bananas são levemente ____.|radioativas|radioativa',
  'Entre 1808 e 1821, a capital do Império Português ficava na cidade do ____.|Rio de Janeiro|rio',
  'O primeiro item vendido no eBay foi um ____ quebrado.|apontador laser|laser/ponteiro laser',
  'O hino nacional da Grécia tem ____ estrofes.|158',
  'Os golfinhos dormem com ____ do cérebro acordada.|metade',
  'A Coca-Cola foi vendida no começo como ____.|remédio|xarope/medicamento',
  'A Mona Lisa não tem ____.|sobrancelhas|sobrancelha',
  'Na Suíça é proibido ter só um ____, porque ele fica solitário.|porquinho-da-índia|porquinho da india/porquinho',
  'O zumbido do sabre de luz de Star Wars foi feito com o som de um ____ antigo.|projetor de cinema|projetor',
  'Os elefantes são os únicos mamíferos que não conseguem ____.|pular|saltar',
  'O primeiro despertador mecânico só tocava às ____ da manhã.|4 horas|quatro/4/4h',
  'O nome de batismo do Silvio Santos é ____.|Senor Abravanel|senor',
  'O nome de batismo da Xuxa é Maria da Graça ____.|Meneghel',
  'Pelé ganhou o apelido porque, criança, falava errado o nome do goleiro ____.|Bilé|bile',
  'O apelido "Garrincha" é o nome de um ____.|passarinho|pássaro/passaro/ave',
  'O nome "Brasil" vem de ____.|uma árvore|arvore/pau-brasil/pau brasil',
  'Nos Estados Unidos do século 18, a lagosta era considerada comida de ____.|presos|presidiários/prisioneiros/pobres',
  'Antes de se chamar Google, o buscador se chamava ____.|BackRub|back rub',
  'Quando foi fundada, em 1889, a Nintendo fabricava ____.|cartas de baralho|baralho/cartas',
  'O primeiro nome da Pepsi era ____.|Brad\'s Drink|brads drink/brad drink',
  'A língua da girafa é da cor ____.|roxa|azul/preta/arroxeada',
  'Os coalas chegam a dormir até ____ horas por dia.|22',
  'Por baixo do pelo branco, a pele do urso-polar é ____.|preta|negra',
  'Em inglês, um bando de corvos é chamado de "um ____ de corvos".|assassinato|murder',
  'O velcro foi inventado depois que o criador observou ____ grudados no pelo do cachorro.|carrapichos|carrapicho',
  'O criador da embalagem de Pringles foi enterrado dentro de uma ____ de Pringles.|lata|tubo',
  'Seres humanos compartilham cerca de 60% do DNA com a ____.|banana',
  'Entre os cavalos-marinhos, quem fica grávido é o ____.|macho|pai',
  'A Lua se afasta da Terra cerca de ____ por ano.|3,8 cm|4 cm/4 centimetros/3.8 cm',
  'O Seu Madruga devia ____ meses de aluguel.|14|catorze/quatorze',
  'O "S" no peito do Super-Homem, no planeta dele, significa ____.|esperança',
  'O Mickey quase se chamou ____.|Mortimer',
  'O nome completo da Barbie é Barbara Millicent ____.|Roberts',
  'Antes de virarem The Beatles, eles se chamavam ____.|The Quarrymen|quarrymen',
  'A palavra "robô" vem do tcheco "robota", que significa ____.|trabalho forçado|trabalho/servidão',
  'Em Marte, o pôr do sol é ____.|azul|azulado',
  'O primeiro vídeo do YouTube foi gravado num ____.|zoológico|zoo',
  'Em italiano, o símbolo @ se chama "chiocciola", que quer dizer ____.|caracol',
  'O personagem Pac-Man foi inspirado numa ____ sem um pedaço.|pizza',
  'O nome LEGO vem do dinamarquês "leg godt", que significa ____.|brincar bem|brinque bem/jogar bem',
  'O Mario, da Nintendo, se chamava ____ no primeiro jogo em que apareceu.|Jumpman|jump man',
  'O país com mais pirâmides no mundo é o ____.|Sudão|sudao',
  'O maior deserto do mundo é a ____.|Antártida|antartica/antartida',
  'Na América do Sul, o Brasil só não faz fronteira com o Chile e o ____.|Equador',
  'Antes de se chamar Tóquio, a cidade se chamava ____.|Edo',
  'Um bebê nasce com cerca de ____ ossos.|300|trezentos',
  'Proporcionalmente ao tamanho, o músculo mais forte do corpo humano é o ____.|masseter|músculo da mandíbula/mandibula/maxilar',
  'O primeiro animal a orbitar a Terra foi uma cadela chamada ____.|Laika',
  'O McDonald\'s já testou ____ com sabor de chiclete para o lanche das crianças.|brócolis|brocolis',
  'Nas Olimpíadas de 1900, uma das provas foi tiro em ____ vivos.|pombos|pombas/pombo',
  'A Torre Eiffel fica até 15 centímetros mais alta no ____.|verão|calor',
  'As vacas têm melhores amigas e ficam ____ quando são separadas delas.|estressadas|estressada/tristes/ansiosas',
  'Os flamingos são cor-de-rosa por causa da ____.|alimentação|comida/dieta/camarão/camarões',
  'Uma pessoa produz cerca de ____ de saliva por dia.|1 litro|um litro/1l',
  'Os dados de jogar são tão antigos que já foram encontrados dados com cerca de ____ anos.|5 mil|5000/cinco mil',
  'O Japão tem cerca de 4 milhões de ____ espalhadas pelas ruas.|máquinas de venda automática|maquinas de venda/vending machines/maquinas automaticas',
  'O ketchup era originalmente um molho feito de ____ fermentado.|peixe',
  'A cenoura laranja se popularizou na Holanda; antes, as cenouras mais comuns eram ____.|roxas|roxa/amarelas/brancas',
  'O primeiro produto com código de barras escaneado num caixa foi um pacote de ____.|chiclete|goma de mascar/chicletes',
  'Os ratos não conseguem ____.|vomitar',
  'O som de um trovão é causado pelo ar que se ____ de repente com o calor do raio.|expande|dilata/esquenta',
  'A Finlândia tem mais ____ do que carros.|saunas|sauna',
  'Segundo a empresa que a criou, a Hello Kitty não é uma gata: é uma ____.|menina|garota/criança',
  'Os tubarões já existiam antes das ____.|árvores|arvores',
  'O Monte Everest tem conexão de ____ no acampamento base.|internet|wi-fi/4g',
  'A estátua do Cristo Redentor é atingida por ____ várias vezes por ano.|raios|raio',
  'O nome original do Bob Esponja era ____ Esponja.|SpongeBoy|sponge boy/menino',
];

export interface LieQuestion {
  id: number;
  q: string;
  answer: string;
  /** Resposta + formas alternativas (para recusar "mentiras" que são verdade). */
  truths: string[];
}

export const LIE_BANK: LieQuestion[] = RAW.map((line, id) => {
  const [q, answer, alts] = line.split('|');
  return { id, q, answer, truths: [answer, ...(alts ? alts.split('/') : [])] };
});
