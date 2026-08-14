export type CalcResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export const add = (a: number, b: number): CalcResult => ({ ok: true, value: a + b });

export const subtract = (a: number, b: number): CalcResult => ({ ok: true, value: a - b });

export const multiply = (a: number, b: number): CalcResult => ({ ok: true, value: a * b });

export const divide = (a: number, b: number): CalcResult => {
  if (b === 0) return { ok: false, error: 'division by zero' };
  return { ok: true, value: a / b };
};
