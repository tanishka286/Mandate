import express from "express";
import cors from "cors";
import helmet from "helmet";
import { API_PREFIX } from "@mandate/config";
import { getEnv, loadEnv } from "./config/env.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { authMiddleware } from "./middleware/auth.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { v1Router } from "./routes/index.js";

/**
 * Mandate API application factory.
 * Modular monolith - domain modules mount under /api/v1 in later phases.
 */
export function createApp() {
  loadEnv();
  const env = getEnv();
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      exposedHeaders: ["X-Request-ID"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(requestIdMiddleware);
  app.use(idempotencyMiddleware);
  app.use(authMiddleware);

  app.use(API_PREFIX, v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
