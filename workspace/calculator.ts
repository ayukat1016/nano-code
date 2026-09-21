export type Result = { ok: true; value: number } | { ok: false; error: string };

export const add = (a: number, b: number): Result => ({ ok: true, value: a + b });

export const subtract = (a: number, b: number): Result => ({ ok: true, value: a - b });

export const multiply = (a: number, b: number): Result => ({ ok: true, value: a * b });

export const divide = (a: number, b: number): Result => {
  if (b === 0) return { ok: false, error: "division_by_zero" };
  return { ok: true, value: a / b };
};
