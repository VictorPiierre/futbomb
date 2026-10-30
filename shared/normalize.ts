// Normalização usada na validação: ignora maiúsculas, acentos e pontuação.
const SPECIAL: Record<string, string> = {
  ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h',
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[øæœßłđðþıħ]/g, (c) => SPECIAL[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`´]/g, '')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function firstLetter(text: string): string {
  return normalize(text).charAt(0).toUpperCase();
}
