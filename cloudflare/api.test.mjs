import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createCloudflareApi, secureResponse } from './api.js';
import worker from './worker.js';

const token = 'fixture-access-' + 'x'.repeat(40);
const bindings = { AI_API_KEY: 'fixture-key', AI_ACCESS_TOKEN: token };
const request = (path, options) => new Request('https://tradekit.example' + path, options);
const ai = (headers = {}) => request('/api/ai', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ text: 'Fixture seller' }),
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('single Cloudflare Worker', () => {
  it('uses only runtime bindings and never enables anonymous AI from process environment', async () => {
    vi.stubEnv('AI_API_KEY', 'local-secret'); vi.stubEnv('AI_ACCESS_TOKEN', token);
    const handle = createCloudflareApi();
    expect(await (await handle({ request: request('/api/config') })).json()).toEqual({ aiConfigured: false, aiRequiresToken: false });
    expect((await handle({ request: ai(), env: { AI_API_KEY: 'runtime-key' } })).status).toBe(503);
    const response = await handle({ request: request('/api/config'), env: bindings });
    expect(await response.json()).toEqual({ aiConfigured: true, aiRequiresToken: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });
  it('requires the runtime token before invoking a model and forwards only the upstream key', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"fields":{"seller":"Fixture"},"rows":[]}' } }] }));
    const handle = createCloudflareApi({ fetchImpl });
    for (const authorization of ['', 'Bearer wrong']) {
      expect((await handle({ request: ai({ Authorization: authorization }), env: bindings })).status).toBe(401);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    const response = await handle({ request: ai({ Authorization: `Bearer ${token}` }), env: bindings });
    expect(await response.json()).toEqual({ fields: { seller: 'Fixture' }, rows: [] });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-key');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  it.each(['/api', '/api/', '/api/missing', '/api/missing/nested'])('never serves assets or HTML for %s', async path => {
    const fetchAssets = vi.fn(async () => new Response('<html>Home</html>'));
    const response = await worker.fetch(request(path), { ASSETS: { fetch: fetchAssets } });
    expect(response.status).toBe(404); expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(fetchAssets).not.toHaveBeenCalled();
  });
  it('keeps methods and cross-origin defenses intact', async () => {
    const get = await worker.fetch(request('/api/ai'), bindings);
    expect(get.status).toBe(405); expect(get.headers.get('Allow')).toBe('POST');
    const cross = await worker.fetch(request('/api/config', { headers: { Origin: 'https://evil.example' } }), bindings);
    expect(cross.status).toBe(403); expect(cross.headers.get('Cache-Control')).toBe('no-store');
  });
  it('falls back to the same deployment asset binding and retains cache, redirect and conditional headers', async () => {
    const headers = { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache', ETag: 'fixture', Location: '/index.html' };
    const fetchAssets = vi.fn(async () => new Response(null, { status: 302, headers }));
    const incoming = request('/'); const response = await worker.fetch(incoming, { ASSETS: { fetch: fetchAssets } });
    expect(fetchAssets).toHaveBeenCalledWith(incoming); expect(response.status).toBe(302);
    for (const [key, value] of Object.entries(headers)) expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    const conditional = secureResponse(new Response(null, { status: 304, headers: { ETag: 'fixture' } }));
    expect(conditional.status).toBe(304); expect(conditional.body).toBeNull(); expect(conditional.headers.get('ETag')).toBe('fixture');
  });
  it('sanitizes unexpected failures without exposing credentials or internal details', async () => {
    const response = await worker.fetch(request('/missing'), { ASSETS: { fetch: () => { throw Error('secret-key-internal'); } } });
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: '服务请求失败，请稍后重试' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const bad = await createCloudflareApi()({ request: request('/api/config', { headers: { Origin: 'https://tradekit.example' } }), env: { ALLOWED_ORIGINS: {} } });
    expect(bad.status).toBe(500); expect(await bad.text()).not.toContain('split');
  });
  it('declares exactly one Worker with the built static folder and API-first routing, without external service bindings', async () => {
    const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    expect(config.main).toBe('./cloudflare/worker.js'); expect(config.assets.directory).toBe('./dist');
    expect(config.assets.binding).toBe('ASSETS'); expect(config.assets.run_worker_first).toEqual(['/api', '/api/*']);
    expect(config.assets.not_found_handling).toBe('none'); expect(config.compatibility_flags).toContain('nodejs_compat');
    expect(config.keep_vars).toBe(true);
    for (const key of ['services', 'pages_build_output_dir', 'site', 'kv_namespaces', 'd1_databases', 'durable_objects']) expect(config).not.toHaveProperty(key);
    expect(JSON.stringify(config)).not.toMatch(/AI_API_KEY|AI_ACCESS_TOKEN/);
  });
});
