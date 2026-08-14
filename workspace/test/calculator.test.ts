import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide } from '../src/calculator';

describe('calculator', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toEqual({ ok: true, value: 5 });
  });

  it('returns error for invalid add input', () => {
    // @ts-expect-error testing runtime behavior with NaN
    expect(add(NaN, 3)).toEqual({ ok: false, error: 'Invalid number' });
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

  it('returns error for division by zero', () => {
    expect(divide(1, 0)).toEqual({ ok: false, error: 'Division by zero' });
  });

  it('returns error for invalid divide input', () => {
    // @ts-expect-error testing runtime behavior with Infinity
    expect(divide(Infinity, 2)).toEqual({ ok: false, error: 'Invalid number' });
  });
});
