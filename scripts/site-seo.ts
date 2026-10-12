import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";

const projectRoot = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, projectRoot), "utf8");

export type SiteSettings = { url: string; indexable: boolean };

export function siteSettings(url = "", indexing = "", development = false): SiteSettings {
  let origin = "";
  if (url.trim()) {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("SITE_URL 必须是完整 HTTPS 站点来源，例如 https://tools.example.com，不含路径、查询参数或凭据。");
    }
    origin = parsed.origin;
  }
  if (indexing && !["true", "false"].includes(indexing)) throw new Error("SITE_INDEXABLE 只能为 true 或 false。");
  return { url: origin, indexable: !!origin && indexing !== "false" && !development };
}

export function renderSiteHtml(template: string, settings: SiteSettings): string {
  let html = template.replaceAll("__SITE_URL__", settings.url)
    .replace('content="index,follow,max-image-preview:large"', `content="${settings.indexable ? "index,follow,max-image-preview:large" : "noindex,nofollow"}"`);
  // A local build must never claim somebody else's production origin.
  if (!settings.url) {
    html = html.replace(/^.*<link rel="canonical"[^>]*>\r?\n/gm, "")
      .replace(/^.*<meta (?:property="og:(?:url|image[^\"]*)"|name="twitter:image[^\"]*")[^>]*>\r?\n/gm, "")
      .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")
      .replace('content="summary_large_image"', 'content="summary"');
  }
  return html;
}

export function siteAssets(settings: SiteSettings): Record<string, string> {
  const guide = read("site/guide.md").replaceAll("__SITE_URL__", settings.url);
  return {
    "guide/index.html": renderSiteHtml(read("site/guide/index.html"), settings),
    "guide/guide.css": read("site/guide/guide.css"),
    "guide.md": guide,
    "llms-full.txt": guide,
    "llms.txt": read("site/llms.txt").replaceAll("__SITE_URL__", settings.url),
    "robots.txt": settings.indexable ? `User-agent: *\nAllow: /\nDisallow: /api\n\nSitemap: ${settings.url}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n",
    "sitemap.xml": '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      (settings.indexable ? ["/", "/guide/"].map(path => `  <url><loc>${settings.url}${path}</loc></url>\n`).join("") : "") + "</urlset>\n",
  };
}

export function siteSeo(): Plugin {
  let settings = siteSettings();
  return {
    name: "tradekit-site-seo",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, "SITE_");
      settings = siteSettings(process.env.SITE_URL ?? env.SITE_URL, process.env.SITE_INDEXABLE ?? env.SITE_INDEXABLE, config.command === "serve");
    },
    transformIndexHtml(html) { return renderSiteHtml(html, settings); },
    generateBundle() {
      for (const [fileName, source] of Object.entries(siteAssets(settings))) this.emitFile({ type: "asset", fileName, source });
    },
    configureServer(server) {
      server.watcher.add(fileURLToPath(new URL("site/", projectRoot)));
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url || "/", "http://localhost").pathname;
        if (path === "/guide") { response.writeHead(308, { Location: "/guide/" }); response.end(); return; }
        const name = path === "/guide/" ? "guide/index.html" : path.slice(1);
        const source = siteAssets(settings)[name];
        if (source === undefined || !["GET", "HEAD"].includes(request.method || "GET")) { next(); return; }
        const type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : name.endsWith(".xml") ? "application/xml" : "text/plain";
        response.setHeader("Content-Type", type + "; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("X-Robots-Tag", "noindex");
        response.end(request.method === "HEAD" ? undefined : source);
      });
    },
  };
}
