import express from "express";
import { fileURLToPath } from "node:url";
import { createApi } from "../cloud-functions/_lib/api.js";

export function createApp({ env = process.env, fetchImpl = fetch, production = false } = {}) {
  const app = express();
  app.disable("x-powered-by");
  const host = env.HOST || "127.0.0.1";
  const handle = createApi({
    env,
    fetchImpl,
    allowLocalAi: !production && env.NODE_ENV !== "production" && ["127.0.0.1", "localhost", "::1"].includes(host),
  });
  app.use("/api", express.raw({ type: () => true, limit: "1mb" }));
  app.use("/api", async (req, res, next) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request(new URL(req.originalUrl, `http://${req.headers.host || "localhost"}`), {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method) && req.body?.length ? { body: req.body } : {}),
      });
      const response = await handle({ request });
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  });

  if (production) {
    const dist = fileURLToPath(new URL("../dist/", import.meta.url));
    app.use(express.static(dist, {
      setHeaders(res, file) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    }));
    // The current app has no path-based frontend routing. Unknown paths stay 404.
  }
  app.use((_, res) => res.status(404).json({ error: "路径不存在" }));
  app.use((error, _req, res, _next) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(error.type === "entity.too.large" ? 413 : 500).json({
      error: error.type === "entity.too.large" ? "请求内容过大" : "服务请求失败，请稍后重试",
    });
  });
  return app;
}
