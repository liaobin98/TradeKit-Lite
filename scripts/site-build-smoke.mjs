import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] || 'dist');
const read = name => readFile(resolve(directory, name), 'utf8');
const home = await read('index.html');
const canonical = home.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
const indexing = home.includes('content="index,follow,max-image-preview:large"');
const origin = canonical ? new URL(canonical).origin : '';
for (const [file, path] of [['index.html', '/'], ['guide/index.html', '/guide/']]) {
  const html = await read(file);
  assert.doesNotMatch(html, /__SITE_URL__/, file);
  assert.equal([...html.matchAll(/<title>/g)].length, 1, file);
  assert.equal([...html.matchAll(/name="description"/g)].length, 1, file);
  assert.equal([...html.matchAll(/name="robots"/g)].length, 1, file);
  assert.equal(html.includes('content="index,follow,max-image-preview:large"'), indexing, file);
  const links = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, origin ? [origin + path] : [], file);
  if (origin) {
    assert.ok(html.includes(`property="og:url" content="${origin + path}"`), file);
    assert.ok(html.includes(`property="og:image" content="${origin}/social-cover.png"`), file);
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(path === '/' ? json['@graph'][0].url : json.url, origin + path, file);
  } else {
    assert.match(html, /noindex,nofollow/, file);
    assert.doesNotMatch(html, /property="og:(?:url|image)"|application\/ld\+json/, file);
  }
}
const sitemap = await read('sitemap.xml');
assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), indexing ? [origin + '/', origin + '/guide/'] : []);
const robots = await read('robots.txt');
if (indexing) { assert.ok(robots.includes('Sitemap: ' + origin + '/sitemap.xml')); assert.ok(robots.includes('Disallow: /api')); }
else assert.equal(robots, 'User-agent: *\nDisallow: /\n');
assert.equal(await read('llms-full.txt'), await read('guide.md'));
for (const file of ['llms.txt', 'llms-full.txt', 'guide.md']) {
  const text = await read(file);
  assert.doesNotMatch(text, /__SITE_URL__/, file);
  if (origin) assert.ok(text.includes(origin + '/'), file);
}
const image = await readFile(resolve(directory, 'social-cover.png'));
assert.equal(image.readUInt32BE(16), 1200); assert.equal(image.readUInt32BE(20), 630);
console.log(`Built SEO/GEO assets verified: ${origin || 'unconfigured preview'}, ${indexing ? 'indexable' : 'noindex'}; aligned metadata, sitemap, robots, guide, llms and social image.`);
