import { it, expect } from 'vitest';
import { columns } from '@/features/documents/model';

it("reference PL/CD retain the shared priced product table", () => {
  expect(columns("PL").some((c) => c[0] === "price")).toBe(true);
  expect(columns("CD").some((c) => c[0] === "elements")).toBe(false);
});
