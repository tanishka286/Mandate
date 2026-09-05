import type {
  QuoteResolutionPort,
  ResolvedQuoteLines,
} from "../policy/quote-adapter.js";
import { BasketService } from "../basket/service.js";

/**
 * Resolves persisted authoritative quote lines for policy evaluation.
 * quote_version is a lookup token only — never a source of money authority.
 * Stale quotes throw QUOTE_STALE (via BasketService).
 */
export class PersistedQuoteAdapter implements QuoteResolutionPort {
  constructor(private readonly baskets = new BasketService()) {}

  async resolve(input: {
    user_id: string;
    basket_id: string;
    quote_version: string;
  }): Promise<ResolvedQuoteLines | null> {
    return this.baskets.resolveQuoteForPolicy(input);
  }
}
