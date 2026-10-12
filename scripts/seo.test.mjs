import { readFileSync } from 'node:fs';
import { renderSiteHtml, siteAssets, siteSettings } from './site-seo.ts';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const origin = 'https://tools.example.test';
const settings = siteSettings(origin);
const assets = siteAssets(settings);
const read = path => path === 'index.html' ? renderSiteHtml(readFileSync(new URL(path, root), 'utf8'), settings) : assets[path.replace(/^public\//, '')] ?? readFileSync(new URL(path, root), 'utf8');
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
function metadata(html) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  const tags = [...head.matchAll(/<(?:meta|link)\b[^>]*>/g)].map(match => attributes(match[0]));
  const meta = key => tags.filter(tag => tag.name === key || tag.property === key);
  const links = rel => tags.filter(tag => tag.rel === rel);
  return { head, meta, links, title: head.match(/<title>([^<]+)<\/title>/)?.[1] };
}
const pages = [['index.html', '/'], ['public/guide/index.html', '/guide/']];

describe('configurable SEO and GEO', () => {
  it('normalizes a public origin and rejects addresses that cannot match root-based routes', () => {
    expect(siteSettings(origin + '/')).toEqual(settings);
    for (const value of ['http://tools.example.test', origin + '/app', origin + '?secret=x', origin + '#home', 'https://user:password@tools.example.test']) {
      expect(() => siteSettings(value)).toThrow('SITE_URL');
    }
    expect(() => siteSettings(origin, 'yes')).toThrow('SITE_INDEXABLE');
  });

  it('does not publish somebody else\'s canonical or index local and preview builds', () => {
    const raw = readFileSync(new URL('index.html', root), 'utf8');
    for (const preview of [siteSettings(), siteSettings(origin, 'false'), siteSettings(origin, 'true', true)]) {
      const html = renderSiteHtml(raw, preview), generated = siteAssets(preview);
      expect(html).toContain('content="noindex,nofollow"');
      expect(generated['robots.txt']).toBe('User-agent: *\nDisallow: /\n');
      expect(generated['sitemap.xml']).not.toContain('<loc>');
      expect(html).not.toContain('__SITE_URL__');
    }
    const unconfigured = renderSiteHtml(raw, siteSettings());
    expect(unconfigured).not.toContain('rel="canonical"');
    expect(unconfigured).not.toContain('property="og:url"');
    expect(unconfigured).not.toContain('property="og:image"');
    expect(unconfigured).not.toContain('type="application/ld+json"');
  });

  it('can render the same source for another deployment without retaining the original domain', () => {
    const alternate = siteSettings('https://other.example.test');
    const outputs = siteAssets(alternate);
    for (const [path, text] of Object.entries(outputs)) {
      expect(text, path).not.toMatch(/tradekit\.utilcove\.com|__SITE_URL__|tools\.example\.test/);
    }
    expect(outputs['sitemap.xml']).toContain('https://other.example.test/guide/');
    expect(outputs['llms-full.txt']).toBe(outputs['guide.md']);
  });

  it.each(pages)('has unique, aligned metadata on %s', (file, path) => {
    const html = read(file), { head, title, meta, links } = metadata(html);
    expect(html).toContain('lang="zh-CN"'); expect(title).toContain('TradeKit Lite');
    expect(head.match(/<title>/g)).toHaveLength(1);
    expect(links('canonical')).toEqual([{ rel: 'canonical', href: origin + path }]);
    for (const key of ['description', 'robots', 'og:title', 'og:description', 'og:url', 'og:image', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) expect(meta(key)).toHaveLength(1);
    expect(meta('robots')[0].content).toBe('index,follow,max-image-preview:large');
    expect(meta('og:url')[0].content).toBe(origin + path);
    expect(meta('og:title')[0].content).toBe(title); expect(meta('twitter:title')[0].content).toBe(title);
    expect(meta('og:image')[0].content).toBe(origin + '/social-cover.png');
    expect(meta('twitter:image')[0].content).toBe(origin + '/social-cover.png');
    expect(meta('twitter:card')[0].content).toBe('summary_large_image');
    expect(links('alternate')[0].href).toBe(origin + '/guide.md');
    expect(html.match(/<h1>/g)).toHaveLength(1);
  });

  it('defines verifiable app entities without ratings, user counts, pricing or invented publisher claims', () => {
    const parse = file => JSON.parse(read(file).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const data = parse('index.html'); expect(data['@context']).toBe('https://schema.org');
    expect(data['@graph'].map(item => item['@type'])).toEqual(['WebSite', 'WebApplication']);
    const app = data['@graph'][1];
    expect(app.url).toBe(origin + '/'); expect(app.softwareHelp).toBe(origin + '/guide/');
    expect(app.sameAs).toBe('https://github.com/liaobin98/tradekit-lite');
    for (const code of ['QT', 'PI', 'SC', 'CI', 'PL', 'CD']) expect(app.featureList.some(item => item.startsWith(code))).toBe(true);
    expect(app.browserRequirements).toContain('IndexedDB');
    const page = parse('public/guide/index.html'); expect(page['@type']).toBe('WebPage');
    expect(page.url).toBe(origin + '/guide/'); expect(page.about['@id']).toBe(app['@id']);
    for (const text of [JSON.stringify(data), JSON.stringify(page)]) expect(text).not.toMatch(/aggregateRating|reviewCount|ratingValue|offers|publisher|SearchAction/);
  });

  it('makes actual product information available without JavaScript, and links the guide in the interactive homepage', () => {
    const home = read('index.html'), guide = read('public/guide/index.html');
    expect(home).toContain('<noscript>'); expect(home).toContain('href="/guide/"');
    expect(home).toContain('报价单'); expect(home).toContain('保存在当前浏览器');
    // 脚本尚未执行时只显示加载状态，产品介绍保留给禁用脚本的浏览器。
    const fallback = home.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
    expect(fallback).toContain('TradeKit Lite 产品介绍');
    expect(fallback).toContain('href="/guide/"');
    const scriptedHome = home.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
    expect(scriptedHome).not.toContain('TradeKit Lite 产品介绍');
    expect(scriptedHome).toContain('class="startup-loading" role="status"');
    expect(guide).toContain('<main id="content">'); expect(guide).not.toMatch(/<script(?! type="application\/ld\+json")/);
    for (const id of ['documents', 'workflow', 'output', 'privacy', 'faq']) {
      expect(guide).toContain(`id="${id}"`); expect(guide).toContain(`href="#${id}"`);
    }
    expect(read('src/app/HomeDashboard.tsx')).toContain('className="site-guide-link" href="/guide/" target="_blank" rel="noopener noreferrer"');
  });

  it('indexes only public pages, excluding API routes and private document hashes', () => {
    const sitemap = read('public/sitemap.xml');
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    expect(locations).toEqual([origin + '/', origin + '/guide/']);
    for (const location of locations) expect(location).not.toMatch(/\/api|#|\?|\/documents/);
    const robots = read('public/robots.txt');
    expect(robots).toContain('User-agent: *'); expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /api'); expect(robots).toContain('Sitemap: ' + origin + '/sitemap.xml');
  });

  it('links real machine-readable assets and keeps the full text identical to its fact source', () => {
    const index = read('public/llms.txt'); expect(index.startsWith('# TradeKit Lite')).toBe(true);
    expect(index).toContain('\n> '); expect(index).toContain('## Optional');
    const links = [...index.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => new URL(match[1]));
    expect(links.length).toBeGreaterThanOrEqual(7);
    for (const url of links) if (url.origin === origin) {
      const path = url.pathname === '/' ? 'index.html' : url.pathname.endsWith('/') ? `public${url.pathname}index.html` : `public${url.pathname}`;
      expect(read(path).length, url.href).toBeGreaterThan(0);
    }
    expect(read('public/llms-full.txt')).toBe(read('public/guide.md'));
    expect(read('vite.config.ts')).toContain('siteSeo()');
  });

  it('states local-data, online-AI, PDF and customs limitations consistently', () => {
    for (const file of ['public/guide.md', 'public/llms-full.txt', 'public/guide/index.html']) {
      const content = read(file);
      for (const term of ['IndexedDB', 'JSON', 'SKU', '模型服务', '多页 A4', '文字不可搜索', '不提供', '海关申报系统']) {
        // HTML uses visible directory prose without the implementation-specific SKU detail.
        if (term === 'SKU' && file.endsWith('.html')) continue;
        expect(content).toContain(term);
      }
      expect(content).not.toMatch(/永久保存|完全离线运行|已通过.*认证|sk-[A-Za-z0-9_-]{20,}/);
    }
  });

  it('provides the expected large social image with editable original artwork', () => {
    const image = readFileSync(new URL('public/social-cover.png', root));
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(1200); expect(image.readUInt32BE(20)).toBe(630);
    const svg = read('public/social-cover.svg'); expect(svg).not.toContain('utilcove.com');
    expect(svg).toContain('TradeKit Lite'); expect(svg).not.toMatch(/<image|<script|href=/);
  });
});
