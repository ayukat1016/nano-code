export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const add = (a: number, b: number): Result<number> => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, error: "Invalid number" };
  }
  return { ok: true, value: a + b };
};

export const subtract = (a: number, b: number): Result<number> => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, error: "Invalid number" };
  }
  return { ok: true, value: a - b };
};

export const multiply = (a: number, b: number): Result<number> => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, error: "Invalid number" };
  }
  return { ok: true, value: a * b };
};

export const divide = (a: number, b: number): Result<number> => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, error: "Invalid number" };
  }
  if (b === 0) {
    return { ok: false, error: "Division by zero" };
  }
  return { ok: true, value: a / b };
};
