/**
 * Temas disponíveis. Cada um tem seu banco em data/<id>.json.
 * wordForms: aceita plural e feminino ("gatas" -> gato) para palavras comuns.
 */
export const THEMES = {
  animals: { label: 'Animais', short: 'Animais', icon: '🦁', noun: 'animal', article: 'um', wordForms: true, aliases: ['animais'] },
  objects: { label: 'Objetos', short: 'Objetos', icon: '🧸', noun: 'objeto', article: 'um', wordForms: true, aliases: ['objetos'] },
  foods: { label: 'Comidas e frutas', short: 'Comidas', icon: '🍎', noun: 'comida ou fruta', article: 'uma', wordForms: true, aliases: ['comidas', 'frutas'] },
  colors: { label: 'Cores', short: 'Cores', icon: '🎨', noun: 'cor', article: 'uma', wordForms: true, aliases: ['cores'] },
  countries: { label: 'Países', short: 'Países', icon: '🌎', noun: 'país', article: 'um', wordForms: false, aliases: ['paises'] },
  famous: { label: 'Famosos', short: 'Famosos', icon: '⭐', noun: 'famoso', article: 'um', wordForms: false, aliases: ['famosos'] },
  professions: { label: 'Profissões', short: 'Profissões', icon: '💼', noun: 'profissão', article: 'uma', wordForms: true, aliases: ['profissoes'] },
  names: { label: 'Nomes de pessoas', short: 'Nomes', icon: '🙋', noun: 'nome', article: 'um', wordForms: false, aliases: ['nomes'] },
  cities: { label: 'Cidades', short: 'Cidades', icon: '🏙️', noun: 'cidade', article: 'uma', wordForms: false, aliases: ['cidades'] },
  brands: { label: 'Marcas', short: 'Marcas', icon: '🏷️', noun: 'marca', article: 'uma', wordForms: false, aliases: ['marcas'] },
  games: { label: 'Jogos e brincadeiras', short: 'Jogos', icon: '🎮', noun: 'jogo ou brincadeira', article: 'um', wordForms: false, aliases: ['jogos', 'games'] },
  movies: { label: 'Filmes', short: 'Filmes', icon: '🎬', noun: 'filme', article: 'um', wordForms: false, aliases: ['filmes'] },
  shows: { label: 'Séries, novelas e desenhos', short: 'Séries', icon: '📺', noun: 'série, novela ou desenho', article: 'uma', wordForms: false, aliases: ['series', 'desenhos', 'novelas'] },
  sports: { label: 'Esportes', short: 'Esportes', icon: '🏅', noun: 'esporte', article: 'um', wordForms: true, aliases: ['esportes'] },
  body: { label: 'Partes do corpo', short: 'Corpo', icon: '🫀', noun: 'parte do corpo', article: 'uma', wordForms: true, aliases: ['corpo'] },
  players: { label: 'Jogadores de futebol', short: 'Jogadores', icon: '⚽', noun: 'jogador', article: 'um', wordForms: false, aliases: ['jogadores'] },
  clubs: { label: 'Clubes de futebol', short: 'Clubes', icon: '🛡️', noun: 'clube', article: 'um', wordForms: false, aliases: ['clubes', 'times'] },
  insults: { label: 'Xingamentos', short: 'Xingamentos', icon: '🤬', noun: 'xingamento', article: 'um', wordForms: true, aliases: ['xingamentos'] },
} as const;

/** Temas que só entram se escolhidos de propósito (fora do modo Surpresa). */
export const ADULT_THEMES: readonly Theme[] = ['insults'];
/** Títulos: aceita sem o artigo inicial ("Rei Leão" = "O Rei Leão"). */
export const TITLE_THEMES: readonly Theme[] = ['movies', 'shows', 'games'];

export type Theme = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as Theme[];
/** "Surpresa": o tema muda a cada volta. */
export type ThemeSetting = Theme | 'mixed';
export const MIXED_THEME = { label: 'Surpresa', short: 'Surpresa', icon: '🎲' };

export function themeLabel(t: ThemeSetting) {
  return t === 'mixed' ? MIXED_THEME.label : THEMES[t].label;
}

/** "um animal", "uma cor"... */
export function themePrompt(t: Theme) {
  return `${THEMES[t].article} ${THEMES[t].noun}`;
}

export const TURN_TIMES = [5, 10, 15, 20, 30] as const;
export const MAX_PLAYERS = [2, 3, 4] as const;
export const START_LIVES = 2;

export interface Settings {
  theme: ThemeSetting;
  turnTime: (typeof TURN_TIMES)[number];
  maxPlayers: (typeof MAX_PLAYERS)[number];
}

export type Phase = 'lobby' | 'playing' | 'ended';

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  lives: number;
  connected: boolean;
  eliminated: boolean;
  left: boolean;
  correct: number;
}

export interface PublicSpectator {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
}

export interface HistoryItem {
  id: number;
  playerId: string;
  playerName: string;
  typed: string;
  canonical: string;
}

export interface PublicGame {
  /** Tema da volta atual (no modo Surpresa muda a cada volta). */
  theme: Theme;
  letter: string;
  round: number;
  currentPlayerId: string | null;
  /** 'turn' = cronômetro correndo; 'pause' = intervalo após explosão */
  status: 'turn' | 'pause';
  turnEndsAt: number | null;
  turnDuration: number;
  history: HistoryItem[];
}

export interface RankingEntry {
  playerId: string;
  name: string;
  avatar: string;
  place: number;
  correct: number;
  left: boolean;
}

export interface PublicRoom {
  code: string;
  hostId: string;
  hostName: string;
  settings: Settings;
  phase: Phase;
  players: PublicPlayer[];
  spectators: PublicSpectator[];
  game: PublicGame | null;
  ranking: RankingEntry[] | null;
  winnerId: string | null;
  serverNow: number;
}

export type GameFx =
  | { type: 'start' }
  | { type: 'letter'; letter: string; round: number; theme: Theme }
  | { type: 'turn'; playerId: string }
  | { type: 'correct'; playerId: string; canonical: string; typed: string }
  | { type: 'explode'; playerId: string; lives: number }
  | { type: 'eliminated'; playerId: string; reason: 'lives' | 'left' }
  | { type: 'winner'; playerId: string | null };

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: string;
  memberId?: string;
  token?: string;
}

export interface AnswerResult {
  ok: boolean;
  reason?: string;
  canonical?: string;
}

export const AVATARS = ['💣', '🔥', '😎', '🤖', '👻', '🦊', '🐸', '🐙', '🦁', '🐼', '🦄', '👽', '🤠', '🍕', '⚡', '👑'];
