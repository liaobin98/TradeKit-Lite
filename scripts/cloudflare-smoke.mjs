import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// Local workerd only: one bundled app Worker plus its static asset binding.
// Fake bindings and intercepted upstreams; no Cloudflare account, real secrets,
// .env files, external AI/rate requests, or business browser data are used.
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
await access(resolve(config.assets.directory, 'index.html'));
const require = createRequire(import.meta.url), wranglerPath = require.resolve('wrangler/package.json');
const wranglerRequire = createRequire(wranglerPath);
const { stdout, stderr } = await promisify(execFile)(process.execPath, [
  resolve(dirname(wranglerPath), 'bin/wrangler.js'), 'deploy', '--dry-run', '--outdir', 'test-artifacts/cloudflare-smoke-worker',
], { cwd: process.cwd(), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 60000 });
if (stderr) process.stderr.write(stderr);
assert.match(stdout, /dry-run.*exiting/i);
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
const token = 'fixture-access-' + 'x'.repeat(40);
let rateCalls = 0, aiCalls = 0;
const options = {
  name: config.name, modules: true, scriptPath: resolve('test-artifacts/cloudflare-smoke-worker/worker.js'),
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  cf: false, port: 0, inspectorPort: 0,
  assets: { directory: resolve(config.assets.directory), binding: config.assets.binding, routerConfig: { has_user_worker: true },
    run_worker_first: config.assets.run_worker_first, assetConfig: { not_found_handling: config.assets.not_found_handling } },
  bindings: { AI_API_KEY: 'fixture-model-key', AI_ACCESS_TOKEN: token,
    AI_BASE_URL: 'https://fixture.invalid/v1', EXCHANGE_URL: 'https://fixture.invalid/rates', AI_RATE_LIMIT: '2' },
  outboundService: async request => {
    if (request.url === 'https://fixture.invalid/rates') {
      rateCalls++;
      return Response.json({ rates: { USD: 1, CNY: 7, EUR: 0.9, GBP: 0.75, AED: 3.67, JPY: 150 }, time_last_update_utc: 'Fixture date' });
    }
    if (request.url === 'https://fixture.invalid/v1/chat/completions') {
      aiCalls++;
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-model-key');
      const body = await request.json();
      assert.equal(body.messages[1].content, 'Fixture seller');
      return Response.json({ choices: [{ message: { content: JSON.stringify({ fields: { seller: 'Fixture seller' }, rows: [{ name: 'Fixture item', qty: '2', price: '10' }] }) } }] });
    }
    throw Error('Unexpected upstream blocked: ' + request.url);
  },
};
const runtime = new Miniflare(convertV4MiniflareOptions(options));
const fetchWorker = (path, init) => runtime.dispatchFetch('https://tradekit.example' + path, init);
const ai = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: 'Fixture seller' }) };
try {
  await runtime.ready;
  const home = await fetchWorker('/'); assert.equal(home.status, 200);
  assert.match(home.headers.get('Content-Type'), /text\/html/); assert.equal(home.headers.get('X-Frame-Options'), 'DENY');
  assert.match(home.headers.get('Cache-Control'), /no-cache/);
  const html = await home.text(), asset = html.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
  for (const path of ['/guide/', '/guide.md', '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt', '/social-cover.png']) {
    const response = await fetchWorker(path);
    assert.equal(response.status, 200, path);
    if (!path.endsWith('.png')) assert.doesNotMatch(await response.text(), /__SITE_URL__/, path);
  }
  assert.ok(asset, 'Built frontend entry exists');
  const js = await fetchWorker(asset); assert.equal(js.status, 200); assert.match(js.headers.get('Cache-Control'), /immutable/);
  assert.equal(js.headers.get('X-Content-Type-Options'), 'nosniff');
  for (const path of ['/.env', '/server.mjs', '/cloudflare/worker.js', '/cloud-functions/_lib/api.js', '/_headers', '/not-a-route']) {
    assert.equal((await fetchWorker(path)).status, 404, path + ' must not expose source or SPA fallback');
  }
  const configResponse = await fetchWorker('/api/config');
  assert.equal(configResponse.status, 200, await configResponse.clone().text());
  assert.equal(configResponse.headers.get('Cache-Control'), 'no-store'); assert.equal(configResponse.headers.get('X-Frame-Options'), 'DENY');
  assert.deepEqual(await configResponse.json(), { aiConfigured: true, aiRequiresToken: true });
  const rates = await Promise.all([fetchWorker('/api/rates'), fetchWorker('/api/rates')]);
  assert.equal((await rates[0].json()).rates.USD, 7); assert.equal((await rates[1].json()).rates.JPY, 7 / 150); assert.equal(rateCalls, 1);
  assert.equal((await fetchWorker('/api/ai', { ...ai, headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal(aiCalls, 0);
  const result = await fetchWorker('/api/ai', ai); assert.equal(result.status, 200);
  assert.equal((await result.json()).fields.seller, 'Fixture seller'); assert.equal(aiCalls, 1);
  assert.equal((await fetchWorker('/api/ai', { ...ai, body: JSON.stringify({ text: 'a', extra: 'x'.repeat(1024 * 1024) }) })).status, 413);
  assert.equal(aiCalls, 1);
  assert.equal((await fetchWorker('/api/ai', ai)).status, 200); assert.equal(aiCalls, 2);
  assert.equal((await fetchWorker('/api/ai', ai)).status, 429); assert.equal(aiCalls, 2);
  const wrongMethod = await fetchWorker('/api/ai'); assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get('Allow'), 'POST');
  assert.equal((await fetchWorker('/api/config', { headers: { Origin: 'https://evil.example' } })).status, 403);
  for (const path of ['/api', '/api/', '/api/missing', '/api/missing/nested']) {
    const missing = await fetchWorker(path); assert.equal(missing.status, 404);
    assert.match(missing.headers.get('Content-Type'), /application\/json/); assert.equal(missing.headers.get('Cache-Control'), 'no-store');
  }
  await runtime.setOptions(convertV4MiniflareOptions({ ...options, bindings: { AI_API_KEY: 'fixture-model-key' } }));
  assert.deepEqual(await (await fetchWorker('/api/config')).json(), { aiConfigured: false, aiRequiresToken: false });
  assert.equal((await fetchWorker('/api/ai', ai)).status, 503);
  console.log('Single Cloudflare Worker passed in local workerd: built frontend/assets, headers/cache, private-file/404 isolation, runtime bindings, token authentication, rates/cache, AI validation/limits and JSON API errors. No cloud deployment performed.');
} finally { await runtime.dispose(); }
