import type { AuthUser, SessionContext } from "./auth.js";

declare global {
  // Express Request augmentation - intentional namespace merge
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      idempotencyKey?: string;
      user?: AuthUser;
      sessionContext?: SessionContext;
    }
  }
}

export {};
