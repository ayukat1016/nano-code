import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide, Result } from '../src/calculator';

describe('calculator', () => {
  it('adds numbers', () => {
    expect(add(2, 3)).toEqual({ ok: true, value: 5 });
  });

  it('rejects invalid numbers for add', () => {
    expect(add(NaN, 1)).toEqual({ ok: false, error: 'Invalid number' });
  });

  it('subtracts numbers', () => {
    expect(subtract(5, 3)).toEqual({ ok: true, value: 2 });
  });

  it('multiplies numbers', () => {
    expect(multiply(4, 3)).toEqual({ ok: true, value: 12 });
  });

  it('divides numbers', () => {
    expect(divide(10, 2)).toEqual({ ok: true, value: 5 });
  });

  it('rejects division by zero', () => {
    expect(divide(1, 0)).toEqual({ ok: false, error: 'Division by zero' });
  });

  it('rejects invalid numbers for divide', () => {
    expect(divide(1, Infinity)).toEqual({ ok: false, error: 'Invalid number' });
  });
});
