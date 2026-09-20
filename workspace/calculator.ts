export type Result<T> =
  | { success: true; value: T }
  | { success: false; error: string };

export const add = (a: number, b: number): Result<number> => ({ success: true, value: a + b });

export const subtract = (a: number, b: number): Result<number> => ({ success: true, value: a - b });

export const multiply = (a: number, b: number): Result<number> => ({ success: true, value: a * b });

export const divide = (a: number, b: number): Result<number> => {
  if (b === 0) {
    return { success: false, error: "division by zero" };
  }
  return { success: true, value: a / b };
};
