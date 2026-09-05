import { z } from "zod";
import { parseOrThrow } from "../../shared/validation/index.js";
import { SessionsRepository } from "./repository.js";
import {
  createShoppingSessionDataSchema,
  shoppingSessionSchema,
  userIdSchema,
} from "./schema.js";

/**
 * Shopping session service — Phase 10 demo/session start.
 * Creates ACTIVE sessions for authenticated principals only.
 */
export class SessionsService {
  constructor(private readonly repository = new SessionsRepository()) {}

  async createSession(
    userId: string,
  ): Promise<z.infer<typeof createShoppingSessionDataSchema>> {
    parseOrThrow(userIdSchema, userId);
    const row = await this.repository.insert({
      user_id: userId,
      status: "ACTIVE",
    });
    const session = parseOrThrow(shoppingSessionSchema, row);
    return parseOrThrow(createShoppingSessionDataSchema, {
      session_id: session.session_id,
      status: "ACTIVE",
    });
  }
}
