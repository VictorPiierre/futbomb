import { createHash } from 'node:crypto';
import type { EarDifficulty, EarLang } from '../shared/ear.ts';

/**
 * Banco do Ouvidão. Formato: "fala|significado" ou "fala=resposta1/resposta2|significado"
 * (quando se aceita mais de uma forma de escrever).
 */
const RAW: Record<EarLang, Record<EarDifficulty, string[]>> = {
  en: {
    easy: [
      'dog|cachorro', 'house|casa', 'water|água', 'apple|maçã', 'happy|feliz', 'school|escola', 'friend|amigo', 'green|verde',
      'money|dinheiro', 'window|janela', 'chicken|frango', 'music|música', 'summer|verão', 'yellow|amarelo', 'kitchen|cozinha',
      'monkey|macaco', 'birthday|aniversário', 'pillow|travesseiro', 'orange|laranja', 'teacher|professor', 'doctor|médico', 'beach|praia',
    ],
    medium: [
      'knowledge|conhecimento', 'beautiful|bonito', 'strawberry|morango', 'necessary|necessário', 'neighbor|vizinho', 'February|fevereiro',
      'Wednesday|quarta-feira', 'thought|pensamento', 'through|através', 'weather|clima', 'library|biblioteca', 'vegetable|vegetal',
      'island|ilha', 'answer|resposta', 'daughter|filha', 'enough|suficiente', 'business|negócio', 'restaurant|restaurante',
      'breakfast|café da manhã', 'chocolate|chocolate', 'squirrel|esquilo', 'comfortable|confortável',
    ],
    hard: [
      'Worcestershire|molho inglês', 'rural juror|jurado rural', 'anemone|anêmona', 'colonel|coronel', 'phenomenon|fenômeno',
      'otorhinolaryngologist|otorrinolaringologista', 'sixth sick sheik|o sexto xeique doente', 'thoroughly|completamente',
      'specific Pacific|Pacífico específico', 'red lorry yellow lorry|caminhão vermelho, caminhão amarelo', 'entrepreneur|empreendedor',
      'Massachusetts|Massachusetts', 'onomatopoeia|onomatopeia', 'quarter past three|três e quinze', 'I scream for ice cream|eu grito por sorvete',
      'Mississippi|Mississippi', 'pronunciation|pronúncia', 'February thirteenth|treze de fevereiro', 'squirrels in the forest|esquilos na floresta',
      'how much wood would a woodchuck chuck|quanta madeira uma marmota roeria',
    ],
  },
  es: {
    easy: [
      'perro|cachorro', 'gato|gato', 'casa|casa', 'agua|água', 'leche|leite', 'rojo|vermelho', 'hola|olá', 'gracias|obrigado',
      'niño|menino', 'playa|praia', 'mesa|mesa', 'queso|queijo', 'hermano|irmão', 'zapato|sapato', 'calle|rua', 'llave|chave',
      'ventana|janela', 'pollo|frango', 'cerveza|cerveja', 'amigo|amigo', 'lluvia|chuva', 'naranja|laranja',
    ],
    medium: [
      'mariposa|borboleta', 'murciélago|morcego', 'cumpleaños|aniversário', 'ferrocarril|ferrovia', 'jirafa|girafa', 'zanahoria|cenoura',
      'guitarra|violão', 'ojalá|tomara', 'almohada|travesseiro', 'desayuno|café da manhã', 'escalofrío|calafrio', 'albóndiga|almôndega',
      'huevo|ovo', 'ajedrez|xadrez', 'cuchillo|faca', 'aguacate|abacate', 'llavero|chaveiro', 'quijada|mandíbula', 'girasol|girassol',
      'refrigerador|geladeira', 'jengibre|gengibre', 'lagartija|lagartixa',
    ],
    hard: [
      'tres tristes tigres|três tigres tristes', 'erre con erre cigarro|erre com erre, cigarro', 'otorrinolaringólogo|otorrinolaringologista',
      'desoxirribonucleico|desoxirribonucleico', 'ferrocarrilero|ferroviário', 'el perro de San Roque|o cachorro de São Roque',
      'parangaricutirimícuaro|cidade de trava-língua', 'me gusta la paella|eu gosto de paella', 'hoy hace mucho calor|hoje está muito calor',
      'Guadalajara|Guadalajara', 'cielo lleno de estrellas|céu cheio de estrelas', 'pájaro carpintero|pica-pau',
      'jugo de zanahoria|suco de cenoura', 'Hipopótamo|hipopótamo', 'el jefe de la oficina|o chefe do escritório',
      'yo quiero un helado|eu quero um sorvete', 'reloj despertador|relógio despertador', 'la llave del coche|a chave do carro',
      'Llanquihue|Llanquihue (lago no Chile)', 'cacahuate|amendoim',
    ],
  },
  fr: {
    easy: [
      'bonjour|bom dia', 'merci|obrigado', 'chat|gato', 'chien|cachorro', 'maison|casa', 'pain|pão', 'fromage|queijo', 'rouge|vermelho',
      'eau|água', 'oui|sim', 'livre|livro', 'pomme|maçã', 'école|escola', 'soleil|sol', 'fleur|flor', 'lune|lua', 'voiture|carro',
      'plage|praia', 'ami|amigo', 'café|café', 'nuit|noite', 'jour|dia',
    ],
    medium: [
      'grenouille|sapo', 'écureuil|esquilo', 'papillon|borboleta', 'boulangerie|padaria', 'champignon|cogumelo', 'fourchette|garfo',
      'aujourd’hui|hoje', 'oiseau|pássaro', 'parapluie|guarda-chuva', 'citrouille|abóbora', 'bibliothèque|biblioteca', 'déjeuner|almoço',
      'feuille|folha', 'quatre-vingts|oitenta', 'mademoiselle|senhorita', 'serrurerie|serralheria', 'portefeuille|carteira',
      'réveil|despertador', 'genou|joelho', 'cheveux|cabelos', 'escargot|caracol', 'pamplemousse|toranja',
    ],
    hard: [
      'je ne sais pas|eu não sei', 'les chaussettes de l’archiduchesse|as meias da arquiduquesa', 'quatre-vingt-dix-neuf|noventa e nove',
      'un chasseur sachant chasser|um caçador que sabe caçar', 'anticonstitutionnellement|anticonstitucionalmente', 'qu’est-ce que c’est|o que é isso',
      'il fait beau aujourd’hui|o tempo está bom hoje', 'écureuil roux|esquilo-vermelho', 'je voudrais un croissant|eu queria um croissant',
      'grenouille verte|sapo verde', 'le petit déjeuner|o café da manhã', 'Bordeaux|Bordeaux', 'serrurier|serralheiro',
      'où est la bibliothèque|onde fica a biblioteca', 'ça va bien merci|tudo bem, obrigado', 'Montpellier|Montpellier',
      'vingt-et-un|vinte e um', 'mille-feuille|mil-folhas', 'Champs-Élysées|Champs-Élysées', 'accueillir|acolher',
    ],
  },
  it: {
    easy: [
      'ciao|oi', 'grazie|obrigado', 'pizza|pizza', 'cane|cachorro', 'gatto|gato', 'casa|casa', 'acqua|água', 'pane|pão',
      'amore|amor', 'mare|mar', 'sole|sol', 'rosso|vermelho', 'bello|bonito', 'latte|leite', 'libro|livro', 'notte|noite',
      'fratello|irmão', 'gelato|sorvete', 'cucina|cozinha', 'scuola|escola', 'amico|amigo', 'mela|maçã',
    ],
    medium: [
      'gnocchi|nhoque', 'cioccolato|chocolate', 'farfalla|borboleta', 'aglio|alho', 'figlio|filho', 'ghiaccio|gelo',
      'sciarpa|cachecol', 'scoiattolo|esquilo', 'pipistrello|morcego', 'spaghetti|espaguete', 'cucchiaio|colher', 'arrivederci|até logo',
      'giraffa|girafa', 'zucchero|açúcar', 'ombrello|guarda-chuva', 'biglietto|bilhete', 'formaggio|queijo', 'chiacchierare|bater papo',
      'occhiali|óculos', 'gioielli|joias', 'giallo|amarelo', 'sbagliato|errado',
    ],
    hard: [
      'trentatré trentini|trinta e três trentinos', 'precipitevolissimevolmente|precipitadamente', 'sopra la panca la capra campa|sobre o banco a cabra vive',
      'come stai oggi|como você está hoje', 'gli gnocchi della nonna|os nhoques da vovó', 'ventiquattro|vinte e quatro',
      'scoiattolo sciocco|esquilo bobo', 'figlio di buona donna|filho de uma boa mulher', 'aglio olio e peperoncino|alho, azeite e pimenta',
      'spaghetti alla carbonara|espaguete à carbonara', 'mi chiamo Giuseppe|meu nome é Giuseppe', 'buongiorno principessa|bom dia, princesa',
      'chiacchierone|tagarela', 'quarantaquattro gatti|quarenta e quatro gatos', 'Ventimiglia|Ventimiglia', 'giocattolo|brinquedo',
      'stuzzicadenti|palito de dente', 'sciroppo|xarope', 'striscia|faixa', 'Sciacca|Sciacca (cidade)',
    ],
  },
  de: {
    easy: [
      'Hund|cachorro', 'Katze|gato', 'Haus|casa', 'Wasser|água', 'Brot|pão', 'danke|obrigado', 'hallo|olá', 'Apfel|maçã',
      'Bier|cerveja', 'Auto|carro', 'Buch|livro', 'Kind|criança', 'gut|bom', 'rot|vermelho', 'Milch|leite', 'Mutter|mãe',
      'Vater|pai', 'Schule|escola', 'Freund|amigo', 'Sonne|sol', 'Tisch|mesa', 'Käse|queijo',
    ],
    medium: [
      'Schmetterling|borboleta', 'Kartoffel|batata', 'Eichhörnchen|esquilo', 'Kühlschrank|geladeira', 'Frühstück|café da manhã',
      'Geburtstag|aniversário', 'Schildkröte|tartaruga', 'Krankenhaus|hospital', 'Flugzeug|avião', 'Handschuh|luva', 'Glühbirne|lâmpada',
      'Zahnbürste|escova de dente', 'Brötchen|pãozinho', 'Bahnhof|estação de trem', 'Schwein|porco', 'Erdbeere|morango',
      'Feuerwehr|bombeiros', 'Fernseher|televisão', 'Regenschirm|guarda-chuva', 'Gesundheit|saúde', 'Schnee|neve', 'Zwiebel|cebola',
    ],
    hard: [
      'Streichholzschächtelchen|caixinha de fósforos', 'Donaudampfschifffahrt|navegação a vapor no Danúbio', 'Fischers Fritz fischt frische Fische|Fritz, o pescador, pesca peixes frescos',
      'Rindfleisch|carne bovina', 'Eichhörnchen essen Nüsse|esquilos comem nozes', 'Quietscheentchen|patinho de borracha', 'Schwarzwälder Kirschtorte|torta Floresta Negra',
      'Ich liebe dich|eu te amo', 'Zwetschgen|ameixas', 'Wie geht es dir|como vai você', 'Brautkleid bleibt Brautkleid|vestido de noiva continua vestido de noiva',
      'Streuselkuchen|bolo de farofa', 'Kopfsteinpflaster|paralelepípedo', 'Verschlimmbesserung|piorar tentando melhorar',
      'Handschuhschneeballwerfer|lançador de bola de neve com luva', 'Zungenbrecher|trava-língua', 'Weihnachtsmann|Papai Noel',
      'Entschuldigung|com licença / desculpa', 'Fußballweltmeisterschaft|Copa do Mundo de futebol', 'Schlüsselbund|molho de chaves',
    ],
  },
};

export interface EarWord {
  id: string;
  lang: EarLang;
  say: string;
  answers: string[];
  meaning: string;
  /** Nome do arquivo de áudio em client/public/ear (gerado por scripts/gen-ear-audio.ts). */
  audio: string;
}

export function audioId(lang: string, diff: string, say: string) {
  return createHash('sha1').update(`${lang}|${diff}|${say}`).digest('hex').slice(0, 12);
}

export const EAR_WORDS: Record<EarLang, Record<EarDifficulty, EarWord[]>> = Object.fromEntries(
  Object.entries(RAW).map(([lang, byDiff]) => [
    lang,
    Object.fromEntries(
      Object.entries(byDiff).map(([diff, list]) => [
        diff,
        list.map((line, i) => {
          const [left, meaning] = line.split('|');
          const [say, alts] = left.split('=');
          // Apóstrofo tipográfico: a voz lê o texto original, a resposta aceita os dois.
          const answers = (alts ? alts.split('/') : [say]).map((a) => a.replace(/’/g, "'"));
          return { id: `${lang}-${diff}-${i}`, lang: lang as EarLang, say, answers, meaning, audio: audioId(lang, diff, say) };
        }),
      ]),
    ),
  ]),
) as never;
