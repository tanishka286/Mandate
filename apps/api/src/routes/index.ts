import { Router } from "express";
import {
  catalogRouter,
  productsRouter,
} from "../modules/catalog/index.js";
import { cartRouter } from "../modules/cart/index.js";
import { policyRouter } from "../modules/policy/index.js";
import { sessionsRouter } from "../modules/sessions/index.js";
import { intentRequirementsRouter } from "../modules/requirements/routes.js";
import { basketRouter } from "../modules/basket/index.js";
import { checkoutRouter } from "../modules/checkout/index.js";
import { paymentsRouter } from "../modules/payments/index.js";
import { healthHandler } from "./health.js";

export const v1Router = Router();

v1Router.get("/health", healthHandler);
v1Router.use("/catalog", catalogRouter);
v1Router.use("/products", productsRouter);
v1Router.use("/cart", cartRouter);
v1Router.use("/policy", policyRouter);
v1Router.use("/sessions", sessionsRouter);
v1Router.use("/intents", intentRequirementsRouter);
v1Router.use("/baskets", basketRouter);
v1Router.use("/checkout", checkoutRouter);
v1Router.use("/payments", paymentsRouter);
