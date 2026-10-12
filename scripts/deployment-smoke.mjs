import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createApp } from "../server/app.mjs";

// Isolated fixture: no .env, real credentials, or external upstream requests.
await access(new URL("../dist/index.html", import.meta.url));
const token = "fixture-only-" + "x".repeat(40);
const app = createApp({
  production: true,
  env: { AI_API_KEY: "fixture-not-a-real-key", AI_ACCESS_TOKEN: token },
  fetchImpl: async (url) => url.includes("/chat/completions")
    ? Response.json({ choices: [{ message: { content: JSON.stringify({ fields: { seller: "Fixture seller" }, rows: [{ name: "Widget", qty: "2", price: "3" }] }) } }] })
    : Response.json({ rates: { USD: 1, CNY: 7, EUR: 0.9, GBP: 0.75, AED: 3.67 }, time_last_update_utc: "fixture" }),
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  const html = await home.text();
  for (const path of ['/guide/', '/guide.md', '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt', '/social-cover.png']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    if (!path.endsWith('.png')) assert.doesNotMatch(await response.text(), /__SITE_URL__/, path);
  }
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, "Built entry asset must exist");
  const assetResponse = await fetch(base + asset);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get("cache-control"), /immutable/);
  assert.equal(await (await fetch(base + "/api/config")).text(), JSON.stringify({ aiConfigured: true, aiRequiresToken: true }));
  assert.equal((await (await fetch(base + "/api/rates")).json()).rates.USD, 7);
  const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Fixture seller" }) };
  assert.equal((await fetch(base + "/api/ai", options)).status, 401);
  const ai = await fetch(base + "/api/ai", { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  assert.equal(ai.status, 200);
  assert.equal((await ai.json()).fields.seller, "Fixture seller");
  for (const path of ["/.env", "/server.mjs", "/api/missing"])
    assert.equal((await fetch(base + path)).status, 404);
  console.log("Production deployment smoke passed: homepage, assets, headers, API, auth, private-file isolation.");
  if (process.argv.includes("--serve")) {
    console.log(`Fixture server for browser verification: ${base}`);
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
  } else {
    await new Promise((resolve) => server.close(resolve));
  }
} catch (error) {
  await new Promise((resolve) => server.close(resolve));
  throw error;
}
