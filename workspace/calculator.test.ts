import { describe, it, expect } from "vitest";
import { add, subtract, multiply, divide } from "./calculator";

describe("calculator", () => {
  it("adds two numbers", () => {
    const r = add(1, 2);
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(3);
  });

  it("subtracts two numbers", () => {
    const r = subtract(5, 3);
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(2);
  });

  it("multiplies two numbers", () => {
    const r = multiply(4, 3);
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(12);
  });

  it("divides two numbers", () => {
    const r = divide(10, 2);
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(5);
  });

  it("handles division by zero", () => {
    const r = divide(1, 0);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("division by zero");
  });
});
