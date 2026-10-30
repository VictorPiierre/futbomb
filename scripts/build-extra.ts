/**
 * Gera os bancos "extra" (data/extra/<tema>.json) a partir de bases públicas:
 *  - nomes.csv.gz     — nomes do Censo/IBGE via brasil.io (https://data.brasil.io/dataset/genero-nomes/nomes.csv.gz)
 *  - municipios.json  — municípios do IBGE (https://servicodados.ibge.gov.br/api/v1/localidades/municipios)
 *  - kaikki-pt.jsonl  — Wiktionary em JSON (https://kaikki.org/dictionary/Portuguese/)
 *  - pt_br_full.txt   — frequência de palavras em legendas pt-BR
 *                       (https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt_br/pt_br_full.txt)
 *
 * Filtros de qualidade: do dicionário só entram palavras usadas de verdade (aparecem pelo menos
 * MIN_FREQ vezes nas legendas) e sentidos que não são arcaicos/obsoletos/raros; dos nomes, só os
 * que pelo menos MIN_NAME_PEOPLE pessoas têm no Brasil.
 *
 * Uso: npm run build:extra -- <pasta com os 3 arquivos>
 * Os arquivos extra só ampliam o reconhecimento; o sorteio de letras usa o banco principal.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { normalize } from '../shared/normalize.ts';
import { mergeRecords, type NameRecord } from './import-names.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'extra');
const MIN_FREQ = 5;
const MIN_NAME_PEOPLE = 200;
const SKIP_TAGS = new Set(['archaic', 'obsolete', 'rare', 'dated', 'historical', 'nonstandard', 'misspelling']);
// Conectivos que não precisam passar no filtro de frequência ("baleia-franca", "pé de moleque").
const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'com']);

let freq = new Map<string, number>();
function loadFreq(file: string) {
  freq = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [w, n] = line.trim().split(' ');
    if (w) freq.set(w.toLowerCase(), Number(n));
  }
}

/** Todas as partes "de verdade" da expressão precisam ser palavras usadas no dia a dia. */
function isCommon(term: string) {
  const parts = term.toLowerCase().split(/[\s-]+/).filter((w) => w && !CONNECTORS.has(w));
  return parts.length > 0 && parts.every((w) => w.length <= 2 || (freq.get(w) ?? 0) >= MIN_FREQ);
}

// Categorias do Wiktionary (campo "orig", sem o prefixo pt:) -> tema.
const ANIMAL_CATS =
  /^(Animals|Mammals|Birds|Fish|Insects|Reptiles|Amphibians|Snakes|Cats|Domestic cats|Dogs|Herding dogs|Hunting dogs|Toy dogs|Water dogs|Felids|Panthers|Mustelids|New World monkeys|Old World monkeys|Lesser apes|Ants|Myrmicine ants|Fowls|Bovines|Cattle|Female animals|Male animals|Baby animals|Vultures|Whales|Horses|Horse breeds|Turtles|Sea turtles|Equids|Corvids|Corvoid birds|Crabs|Cetaceans|Eagles|Sharks|Lamniform sharks|Canids|South American canids|Parrots|Marsupials|Vombatiforms|Bivalves|Worms|Earthworms|Flatworms|Shorebirds|Seabirds|Primates|Rodents|Squirrels|Pigs|Beetles|.*beetles|Owls|Frogs|Toads|Catfish|Crocodilians|Livestock|Camelids|Ratites|Elephants|Swallows|Cephalopods|True finches|Weaver finches|Cuckoos|Ducks|Dabbling ducks|Swans|Dinosaurs|Sheep|Goats|Mollusks|Gastropods|Vetigastropods|Shellfish|Crustaceans|Lizards|.*lizards|Ovenbirds|Thrushes|Mosquitoes|Bees|Tyrant flycatchers|African insectivores|Moths|Butterflies|Spiders|Arachnids|.*snakes|Rabbits|Hares|Eels|Penguins|Woodpeckers|Herons|Tits|Hummingbirds|Perching birds|Birds of prey|Suliform birds|Tubenose birds|Jackfish|.*fish|Flatfish|Pikes \(fish\)|Echinoderms|Cnidarians|Bats|Phocid seals|Seals|Dragonflies and damselflies|.*flies|Horseflies|Reindeers|Deer|Bears|Dolphins|Antelopes|Weasels|Amphibians)$/;
const FOOD_CATS =
  /^(Foods|Fruits|Vegetables|Cakes and pastries|Sweets|Desserts|Breads|Seafood|Meats|Cheeses|Grains|Dishes|Soups|Sauces|Spices|Herbs|Nuts|Legumes|Pasta|Sausages|Confectionery|Candies|Condiments|Salads|Snacks|Cookies|Pies|Fast food|Brazilian cuisine|Portuguese cuisine|Citrus fruits|Berries|Mushrooms|Edible mushrooms|Leaf vegetables|Root vegetables|Squashes|Pulses|Dairy products|Eggs)$/;
const OBJECT_CATS =
  /^(Tools|Clothing|Musical instruments|Percussion instruments|String instruments|Wind instruments|Keyboard instruments|Weapons|Firearms|Vehicles|Containers|Measuring instruments|Footwear|Headwear|Toys|Furniture|Light sources|Fasteners|Computer hardware|Kitchenware|Cookware|Cutlery|Tableware|Watercraft|Aircraft|Jewelry|Bags|Household appliances|Home appliances|Writing instruments|Stationery|Cosmetics|Puppets|Bottles|Undergarments|Coats|Garments|Trousers|Shirts|Dresses|Eyewear|Horse tack|Locks|Bedding|Kitchen utensils|Utensils|Boats|Automobiles|Bicycles|Electronic devices)$/;
const PROFESSION_CATS = /^(Occupations|Healthcare occupations|Musicians|Scientists|Athletes)$/;
const BODY_CATS = /^(Anatomy|Skeleton|Bones|Organs|Muscles|Teeth|Glands|Blood vessels|Body parts|Digestive system|Eye|Face|Hand|Foot|Head)$/;
const COLOR_CATS = /^(Colors|Reds|Greens|Blues|Yellows|Browns|Purples|Pinks|Oranges|Whites|Blacks|Grays|Greys)$/;
const SPORT_CATS = /^(Martial arts|Ball games|Team sports|Combat sports|Water sports|Racket sports|Winter sports|Cue sports|Equestrian sports)$/;

const RULES: [string, RegExp][] = [
  ['animals', ANIMAL_CATS], ['foods', FOOD_CATS], ['objects', OBJECT_CATS], ['professions', PROFESSION_CATS],
  ['body', BODY_CATS], ['colors', COLOR_CATS], ['sports', SPORT_CATS],
];

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep, c) => sep + c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (w) => w.toLowerCase());

async function fromWiktionary(file: string) {
  const buckets: Record<string, NameRecord[]> = Object.fromEntries(RULES.map(([t]) => [t, []]));
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  for await (const line of rl) {
    if (!line.includes('"lang_code": "pt"') || !line.includes('"pos": "noun"')) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const word: string = e.word;
    if (!word || word.length < 2 || /[0-9]/.test(word) || !isCommon(word)) continue;
    for (const sense of e.senses ?? []) {
      const tags: string[] = sense.tags ?? [];
      if (tags.includes('form-of') || tags.some((t) => SKIP_TAGS.has(t))) continue;
      const cats: string[] = (sense.categories ?? []).map((c: any) => String(c.orig ?? c.name ?? '')).filter((c: string) => c.startsWith('pt:')).map((c: string) => c.slice(3));
      for (const [theme, re] of RULES) {
        if (!cats.some((c) => re.test(c))) continue;
        const syn = (sense.synonyms ?? []).map((s: any) => s.word).filter((w: string) => w && w.length >= 2 && w.length <= 30 && isCommon(w));
        buckets[theme].push({ name: word.charAt(0).toUpperCase() + word.slice(1), aliases: syn });
      }
    }
  }
  return buckets;
}

async function fromNames(file: string): Promise<NameRecord[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()) });
  const out: NameRecord[] = [];
  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    const cols = line.split(',');
    const first = cols[2];
    if (first && /^[A-Z]{2,}$/.test(first) && Number(cols[5]) >= MIN_NAME_PEOPLE) out.push({ name: titleCase(first), aliases: [] });
  }
  return out;
}

function fromMunicipios(file: string): NameRecord[] {
  const data: { nome: string }[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  return data.map((m) => ({ name: m.nome, aliases: [] }));
}

function write(theme: string, incoming: NameRecord[], keepExisting = false) {
  const file = path.join(OUT, `${theme}.json`);
  const core: NameRecord[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${theme}.json`), 'utf8'));
  const coreKeys = new Set(core.map((r) => normalize(r.name)));
  // Cidades: preserva o que veio do Wikidata; os demais temas são refeitos do zero.
  const base: NameRecord[] = keepExisting && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  // Mantém o que já veio do Wikidata e não repete o que já está no banco principal.
  const { records } = mergeRecords(base, incoming.filter((r) => !coreKeys.has(normalize(r.name))));
  fs.writeFileSync(file, '[\n' + records.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
  console.log(`✔ extra/${theme}.json: ${records.length}`);
}

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: npm run build:extra -- <pasta com nomes.csv.gz, municipios.json, kaikki-pt.jsonl e pt_br_full.txt>');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
write('names', await fromNames(path.join(dir, 'nomes.csv.gz')));
write('cities', fromMunicipios(path.join(dir, 'municipios.json')), true);
loadFreq(path.join(dir, 'pt_br_full.txt'));
const wk = await fromWiktionary(path.join(dir, 'kaikki-pt.jsonl'));
for (const [theme, recs] of Object.entries(wk)) write(theme, recs);
