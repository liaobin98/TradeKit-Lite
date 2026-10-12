import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { siteSeo } from "./scripts/site-seo";

export function devCacheDir(port = 5173) {
  return fileURLToPath(new URL(`./node_modules/.vite/tradekit-lite-${port}/`, import.meta.url));
}

export default defineConfig({
  plugins: [
    siteSeo(),
    {
      name: "tradekit-isolated-dev-cache",
      config(config, { command }) {
        // Concurrent local previews must not replace the main server's prebundled React.
        if (command === "serve") return { cacheDir: devCacheDir(config.server?.port) };
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Pin nested dependencies too, including mixed npm/pnpm installation layouts.
      react: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./node_modules/react-dom", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  server: { strictPort: true, proxy: { "/api": "http://127.0.0.1:3001" } },
});
