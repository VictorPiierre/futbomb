/** Reações rápidas que qualquer um da sala pode mandar (aparecem flutuando na tela de todos). */
export const REACTIONS = ['😂', '💀', '🔥', '👏', '😱', '🤡', '😭', '🫡'] as const;
export type Reaction = (typeof REACTIONS)[number];
/** Intervalo mínimo entre duas reações da mesma pessoa. */
export const REACTION_COOLDOWN_MS = 600;
