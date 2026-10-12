import "dotenv/config";
import { createApp } from "./server/app.mjs";

const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT) || 3001;
const server = createApp({ production }).listen(port, host, () => {
  console.log(`TradeKit ${production ? "production" : "local API"} service on ${host}:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
