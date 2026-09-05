/**
 * Resolves quantity-only lines for policy evaluation from a quote/basket context.
 *
 * Authority boundary (Phase 2 / deferred basket-quote domain):
 * - `quote_version` is a client-supplied **lookup token** only — never a source of
 *   price, discount, gross, final payable, stock, or category.
 * - Adapters must resolve authoritative quote state for (user, basket_id, quote_version)
 *   and return sku_id + quantity (+ optional claimed incentive ids) only.
 * - Financial/catalog facts are loaded later by PolicyService from mandate/catalog/
 *   incentive ports — never from the HTTP body or from inventing quote rows.
 * - Real basket/quote persistence is Phase 5+ — do not invent tables or stubs here.
 */
export interface ResolvedQuoteLines {
  lines: Array<{ sku_id: string; quantity: number }>;
  claimed_incentive_ids: string[];
}

export interface QuoteResolutionPort {
  /**
   * Look up authoritative quantity lines for the given basket/quote version.
   * Return null when no trusted quote state exists (API fails closed).
   */
  resolve(input: {
    user_id: string;
    basket_id: string;
    quote_version: string;
  }): Promise<ResolvedQuoteLines | null>;
}

/**
 * Default adapter until basket/quote domain exists.
 * Ignores quote_version as a financial authority signal and always returns null
 * → controller fails closed with AMOUNT_CALCULATION_FAILED (no invented lines).
 */
export class UnavailableQuoteAdapter implements QuoteResolutionPort {
  async resolve(_input: {
    user_id: string;
    basket_id: string;
    quote_version: string;
  }): Promise<ResolvedQuoteLines | null> {
    return null;
  }
}
