import { createApp } from "../app.js";
import { getEnv, loadEnv } from "../config/env.js";
import { logger } from "../shared/logger/index.js";

loadEnv();
const env = getEnv();
const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info("Mandate API listening", {
    port: env.PORT,
    env: env.NODE_ENV,
    frontend_url: env.FRONTEND_URL,
    ollama_model: env.OLLAMA_MODEL,
  });
});

function shutdown(signal: string): void {
  logger.info("Shutting down", { signal });
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
