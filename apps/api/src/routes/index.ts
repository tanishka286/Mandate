import { Router } from "express";
import { healthHandler } from "./health.js";

export const v1Router = Router();

v1Router.get("/health", healthHandler);
