import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide } from './calculator';

describe('calculator', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toEqual({ ok: true, value: 3 });
  });

  it('subtracts two numbers', () => {
    expect(subtract(5, 3)).toEqual({ ok: true, value: 2 });
  });

  it('multiplies two numbers', () => {
    expect(multiply(4, 3)).toEqual({ ok: true, value: 12 });
  });

  it('divides two numbers', () => {
    expect(divide(10, 2)).toEqual({ ok: true, value: 5 });
  });

  it('returns error on division by zero', () => {
    expect(divide(1, 0)).toEqual({ ok: false, error: 'division by zero' });
  });
});
