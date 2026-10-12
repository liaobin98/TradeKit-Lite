import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../cloud-functions/_lib/api.js";
import { onRequest } from "../cloud-functions/api/[[path]].js";
import { createApp } from "./app.mjs";

const token = "test-access-token-" + "x".repeat(32);
const env = { AI_API_KEY: "upstream-secret", AI_ACCESS_TOKEN: token };
const exchange = { rates: { USD: 1, CNY: 7, EUR: 0.9, GBP: 0.75, AED: 3.67 }, time_last_update_utc: "today" };
const result = { fields: { seller: "Demo" }, rows: [{ name: "Widget", qty: "2", price: "3" }] };
const upstream = () => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
const request = (path, options = {}) => ({ request: new Request("https://trade.example.com" + path, options) });
const aiRequest = (options = {}) => request("/api/ai", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ text: "seller: Demo" }),
  ...options,
});
const servers = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("shared API", () => {
  it("disables public AI without a strong access token and never exposes secrets", async () => {
    for (const config of [{}, { AI_API_KEY: "secret" }, { ...env, AI_ACCESS_TOKEN: "short" }]) {
      const handle = createApi({ env: config });
      expect(await (await handle(request("/api/config"))).json()).toEqual({ aiConfigured: false, aiRequiresToken: false });
      expect((await handle(aiRequest())).status).toBe(503);
    }
    const response = await createApi({ env })(request("/api/config"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ aiConfigured: true, aiRequiresToken: true });
  });

  it("keeps local AI available without a token", async () => {
    const handle = createApi({ env: { AI_API_KEY: "key" }, allowLocalAi: true, fetchImpl: upstream });
    expect((await handle(aiRequest({ headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" } }))).status).toBe(200);
  });

  it("authenticates independently of Origin, including requests with no Origin", async () => {
    const fetchImpl = vi.fn(upstream);
    const handle = createApi({ env, fetchImpl });
    for (const authorization of ["", "Bearer wrong", "Basic abc"]) {
      expect((await handle(aiRequest({ headers: { "Content-Type": "application/json", Authorization: authorization } }))).status).toBe(401);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await (await handle(aiRequest())).json()).toEqual(result);
    const options = fetchImpl.mock.calls[0][1];
    expect(options.headers.Authorization).toBe("Bearer upstream-secret");
    expect(JSON.parse(options.body).max_tokens).toBe(2048);
  });

  it("checks exact origins and supports an explicit reverse-proxy origin", async () => {
    const handle = createApi({ env });
    expect((await handle(request("/api/config", { headers: { Origin: "https://evil.example.com" } }))).status).toBe(403);
    expect((await handle(request("/api/config", { headers: { Origin: "null" } }))).status).toBe(403);
    expect((await handle(request("/api/config", { headers: { Origin: "https://trade.example.com" } }))).status).toBe(200);
    const proxy = createApi({ env: { ...env, ALLOWED_ORIGINS: "https://public.example.com" } });
    expect((await proxy(request("/api/config", { headers: { Origin: "https://public.example.com" } }))).status).toBe(200);
  });

  it("rejects unknown API paths and wrong methods as JSON", async () => {
    const handle = createApi({ env });
    expect((await handle(request("/api/missing"))).status).toBe(404);
    const response = await handle(request("/api/ai"));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect((await handle(request("/api/rates", { method: "OPTIONS" }))).status).toBe(405);
  });

  it("validates content type, JSON, text and actual body size before upstream calls", async () => {
    const fetchImpl = vi.fn(upstream);
    const handle = createApi({ env, fetchImpl });
    expect((await handle(aiRequest({ headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" } }))).status).toBe(415);
    for (const body of ["bad JSON", "null", "{}", '{"text":1}', JSON.stringify({ text: " " }), JSON.stringify({ text: "x".repeat(20001) })])
      expect((await handle(aiRequest({ body }))).status).toBe(400);
    expect((await handle(aiRequest({ body: JSON.stringify({ text: "a", extra: "x".repeat(1024 * 1024) }) }))).status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches valid exchange data for an hour and coalesces concurrent fetches", async () => {
    let time = 100000;
    const fetchImpl = vi.fn(async () => Response.json(exchange));
    const handle = createApi({ env: {}, fetchImpl, now: () => time });
    const responses = await Promise.all([handle(request("/api/rates")), handle(request("/api/rates"))]);
    expect((await responses[0].json()).rates.USD).toBe(7);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await handle(request("/api/rates"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time += 3600000;
    await handle(request("/api/rates"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid rates and retries after failures without poisoning the cache", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ rates: { ...exchange.rates, EUR: 0 } }))
      .mockResolvedValueOnce(Response.json(exchange));
    const handle = createApi({ env: {}, fetchImpl });
    expect((await handle(request("/api/rates"))).status).toBe(502);
    expect((await handle(request("/api/rates"))).status).toBe(200);
  });

  it('converts every supplied currency to CNY without assuming an upstream USD base', async () => {
    const handle = createApi({ env: {}, fetchImpl: async () => Response.json({
      rates: { USD: 2, CNY: 14, EUR: 1.8, GBP: 1.5, AED: 7.34, JPY: 300, HKD: 15.6, CAD: 2.7, VND: 50000 },
    }) });
    const response = await handle(request('/api/rates'));
    expect(response.status).toBe(200);
    const { rates } = await response.json();
    expect(rates.USD).toBe(7); expect(rates.CNY).toBe(1);
    expect(rates.JPY).toBeCloseTo(14 / 300); expect(rates.HKD).toBeCloseTo(14 / 15.6);
    expect(rates.CAD).toBeCloseTo(14 / 2.7); expect(rates.VND).toBeCloseTo(14 / 50000);
  });

  it('keeps valid default currencies when optional currencies are missing or invalid', async () => {
    const handle = createApi({ env: {}, fetchImpl: async () => Response.json({
      rates: { ...exchange.rates, JPY: 0, CAD: '1.35', SGD: -1, HKD: 7.8, IDR: 1e-320, invalid: 2 },
    }) });
    const response = await handle(request('/api/rates'));
    expect(response.status).toBe(200);
    const { rates } = await response.json();
    expect(rates.USD).toBe(7); expect(rates.HKD).toBeCloseTo(7 / 7.8);
    for (const code of ['JPY', 'CAD', 'SGD', 'IDR', 'invalid', 'CHF']) expect(rates).not.toHaveProperty(code);
  });

  it("enforces per-instance request limits and resets after a minute", async () => {
    let time = 100000;
    const handle = createApi({ env: { ...env, AI_RATE_LIMIT: "1" }, fetchImpl: upstream, now: () => time });
    expect((await handle(aiRequest())).status).toBe(200);
    const limited = await handle(aiRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    time += 60000;
    expect((await handle(aiRequest())).status).toBe(200);
  });

  it("limits concurrent upstream calls and releases the slot after failure", async () => {
    let release;
    const fetchImpl = vi.fn(() => new Promise((_, reject) => { release = reject; }));
    const handle = createApi({ env: { ...env, AI_MAX_CONCURRENT: "1" }, fetchImpl });
    const pending = handle(aiRequest());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect((await handle(aiRequest())).status).toBe(429);
    release(Error("secret upstream detail"));
    const failed = await pending;
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("secret");
    fetchImpl.mockImplementation(upstream);
    expect((await handle(aiRequest())).status).toBe(200);
  });

  it("sanitizes model errors and rejects malformed structured results", async () => {
    for (const data of [null, [], { fields: null }, { rows: null }, { fields: { seller: 3 } }, { rows: [{}], fields: [] }, { rows: new Array(201).fill({}) }]) {
      const handle = createApi({ env, fetchImpl: async () => Response.json({ choices: [{ message: { content: JSON.stringify(data) } }] }) });
      expect((await handle(aiRequest())).status).toBe(502);
    }
    const timeout = createApi({ env, fetchImpl: async () => { throw new DOMException("secret", "TimeoutError"); } });
    expect((await timeout(aiRequest())).status).toBe(504);
    const html = createApi({ env, fetchImpl: async () => new Response("<html>private error</html>") });
    expect((await html(aiRequest())).status).toBe(502);
  });

  it("uses EdgeOne runtime env and does not let missing protection enable cloud AI", async () => {
    const response = await onRequest({ ...request("/api/config"), env });
    expect(await response.json()).toEqual({ aiConfigured: true, aiRequiresToken: true });
    const disabled = await onRequest({ ...request("/api/ai", { method: "POST" }), env: { AI_API_KEY: "key", AI_ACCESS_TOKEN: "" } });
    expect(disabled.status).toBe(503);
  });
});

async function serve(options) {
  const server = createApp(options).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe("standalone server adapter", () => {
  it("serves the same authenticated API and JSON 404s over HTTP", async () => {
    const base = await serve({ env, production: true, fetchImpl: upstream });
    expect(await (await fetch(base + "/api/config")).json()).toEqual({ aiConfigured: true, aiRequiresToken: true });
    const response = await fetch(base + "/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: "Demo" }) });
    expect(await response.json()).toEqual(result);
    const missing = await fetch(base + "/api/unknown");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
    expect((await fetch(base + "/.env")).status).toBe(404);
    expect((await fetch(base + "/server.mjs")).status).toBe(404);
  });

  it("requires protection even when a production server binds to loopback", async () => {
    const base = await serve({ env: { AI_API_KEY: "key", HOST: "127.0.0.1" }, production: true });
    expect((await (await fetch(base + "/api/config")).json()).aiConfigured).toBe(false);
    expect((await fetch(base + "/api/ai", { method: "POST" })).status).toBe(503);
  });

  it("disables anonymous AI for non-loopback development binds", async () => {
    const base = await serve({ env: { AI_API_KEY: "key", HOST: "0.0.0.0" } });
    expect((await (await fetch(base + "/api/config")).json()).aiConfigured).toBe(false);
  });

  it("returns JSON for oversized requests without exposing internals", async () => {
    const base = await serve({ env, production: true });
    const response = await fetch(base + "/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(1024 * 1024) }) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "请求内容过大" });
  });
});
