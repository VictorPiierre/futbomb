import { normalize } from './normalize.ts';
import type { PublicSpectator } from './types.ts';

/**
 * Mentirômetro: aparece uma curiosidade com uma lacuna. Cada um inventa uma resposta falsa
 * que pareça verdadeira; depois todas aparecem misturadas com a certa e cada um tenta achar a verdade.
 */
export const LIE_ROUNDS = [5, 8, 10] as const;
export const LIE_WRITE_TIMES = [30, 45, 60] as const;
export const LIE_MAX_PLAYERS = [4, 6, 8, 10] as const;
export const LIE_PICK_MS = 25_000;
/** Revelação: um tempinho por alternativa + o placar. */
export const LIE_REVEAL_STEP_MS = 2_200;
export const LIE_REVEAL_TAIL_MS = 5_000;
/** Achou a verdade. */
export const LIE_TRUTH_POINTS = 2;
/** Por pessoa que caiu na sua mentira. */
export const LIE_FOOL_POINTS = 1;
export const LIE_MAX_LEN = 40;

export interface LieSettings {
  rounds: (typeof LIE_ROUNDS)[number];
  writeTime: (typeof LIE_WRITE_TIMES)[number];
  maxPlayers: (typeof LIE_MAX_PLAYERS)[number];
}

export type LiePhase = 'lobby' | 'write' | 'pick' | 'reveal' | 'ended';

export interface LiePlayer {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  left: boolean;
  score: number;
  /** Já escreveu a mentira (fase write) / já escolheu (fase pick). */
  done: boolean;
}

export interface LieOption {
  id: string;
  text: string;
}

/** Na revelação: de quem era cada alternativa e quem caiu nela. */
export interface LieReveal {
  id: string;
  text: string;
  truth: boolean;
  authors: string[];
  pickedBy: string[];
}

export interface LiePublicRoom {
  kind: 'lie';
  code: string;
  hostId: string;
  hostName: string;
  settings: LieSettings;
  phase: LiePhase;
  players: LiePlayer[];
  spectators: PublicSpectator[];
  round: number;
  question: string | null;
  endsAt: number | null;
  options: LieOption[] | null;
  reveal: LieReveal[] | null;
  /** Pontos ganhos nesta rodada por jogador. */
  gained: Record<string, number> | null;
  ranking: { playerId: string; name: string; avatar: string; place: number; score: number; left: boolean }[] | null;
  winnerId: string | null;
  serverNow: number;
}

export function lieNorm(text: string) {
  return normalize(text).replace(/\b(o|a|os|as|um|uma|de|do|da)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Mentira "igual" à verdade (ou quase igual) não vale. */
export function tooClose(lie: string, truths: string[]) {
  const l = lieNorm(lie).replace(/\s/g, '');
  return truths.some((t) => {
    const n = lieNorm(t).replace(/\s/g, '');
    if (!n || !l) return false;
    if (l === n) return true;
    // Uma letra de diferença em respostas de 5+ letras também conta como a certa.
    if (Math.abs(l.length - n.length) > 1 || n.length < 5) return false;
    let i = 0;
    let j = 0;
    let diff = 0;
    while (i < l.length && j < n.length) {
      if (l[i] === n[j]) {
        i++;
        j++;
        continue;
      }
      if (++diff > 1) return false;
      if (l.length > n.length) i++;
      else if (n.length > l.length) j++;
      else {
        i++;
        j++;
      }
    }
    return diff + (l.length - i) + (n.length - j) <= 1;
  });
}
