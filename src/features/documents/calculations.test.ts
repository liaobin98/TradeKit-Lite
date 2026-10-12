import { describe, it, expect } from 'vitest';
import { fresh, row } from '@/features/documents/model';
import { amount, totals } from '@/features/documents/calculations';

describe("decimal calculations", () => {
  it("does not accumulate float errors", () => {
    const d = fresh("PI");
    d.rows = [{ ...row(), qty: "3", price: "0.1" }];
    d.fields.freight = "0.2";
    expect(amount(d.rows[0])).toBe("0.30");
    expect(totals(d).total).toBe("0.50");
  });
  it("reconciles displayed rounded line totals", () => {
    const d = fresh("QT");
    d.rows = [
      { ...row(), qty: "1", price: "0.005" },
      { ...row(), qty: "1", price: "0.005" },
    ];
    expect(totals(d).total).toBe("0.02");
  });
});
