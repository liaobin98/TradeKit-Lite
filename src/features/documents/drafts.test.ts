import { describe, it, expect } from 'vitest';
import { fresh } from '@/features/documents/model';
import { loadDoc } from '@/features/documents/drafts';
import { save } from '@/features/workspace/settings';
import { KEY } from '@/features/workspace/workspace-storage';

describe("drafts", () => {
  const data = new Map<string, string>();
  const storage = {
    setItem: (k: string, v: string) => data.set(k, v),
    getItem: (k: string) => data.get(k) ?? null,
  } as unknown as Storage;
  it("round trips and isolates kinds", () => {
    const d = fresh("SC");
    save("draft:SC", d, storage);
    expect(loadDoc("SC", storage)).toEqual(d);
    expect(loadDoc("PL", storage)).toBeNull();
  });
  it("rejects corrupt data", () => {
    data.set(KEY + "draft:CI", "{}");
    expect(() => loadDoc("CI", storage)).toThrow();
  });
  it("propagates quota errors", () => {
    expect(() =>
      save("x", {}, {
        setItem: () => {
          throw Error("quota");
        },
      } as unknown as Storage),
    ).toThrow();
  });
});
