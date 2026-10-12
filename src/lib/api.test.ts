import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("uses same-origin credentials and sends the provided access token", async () => {
    const fetchMock = vi.fn(async (_path: string, _options: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchJson("/api/ai", { headers: { Authorization: "Bearer access-token" } })).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", headers: { Authorization: "Bearer access-token" } });
  });

  it.each([200, 403, 503])("handles HTML security/SPA pages with status %s", async (status) => {
    vi.stubGlobal("fetch", async () => new Response("<html>challenge</html>", { status, headers: { "Content-Type": "text/html" } }));
    await expect(fetchJson("/api/ai")).rejects.toThrow("安全验证");
  });

  it.each([401, 403, 429, 504])("reports JSON API errors with status %s", async (status) => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "可读错误" }, { status }));
    await expect(fetchJson("/api/ai")).rejects.toThrow("可读错误");
  });

  it("rejects malformed JSON and non-object responses", async () => {
    vi.stubGlobal("fetch", async () => new Response("not JSON", { headers: { "Content-Type": "application/json" } }));
    await expect(fetchJson("/api/config")).rejects.toThrow("格式不正确");
    vi.stubGlobal("fetch", async () => Response.json(null));
    await expect(fetchJson("/api/config")).rejects.toThrow("格式不正确");
  });

  it("reports network errors and timeouts", async () => {
    vi.stubGlobal("fetch", async () => { throw TypeError("Failed to fetch"); });
    await expect(fetchJson("/api/config")).rejects.toThrow("无法连接");
    vi.stubGlobal("fetch", async () => { throw new DOMException("timeout", "TimeoutError"); });
    await expect(fetchJson("/api/config")).rejects.toThrow("超时");
  });
});
