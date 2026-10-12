import { it, expect } from 'vitest';
import { clock } from '@/features/world-clock/clock';

it("handles IANA daylight saving", () => {
  expect(clock(new Date("2026-01-01T12:00:00Z"), "America/New_York").time).toBe(
    "07:00:00",
  );
  expect(clock(new Date("2026-07-01T12:00:00Z"), "America/New_York").time).toBe(
    "08:00:00",
  );
});
