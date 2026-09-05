export interface ParsedRequirement {
  index: number;
  name: string;
  skuId: string;
  quantity: number;
}

/**
 * Parse optimization combination_key when present.
 * Example: req:0:eggs=>33333333-3333-4333-8333-333333333301:3
 */
export function parseCombinationKey(combinationKey: string | null): ParsedRequirement[] {
  if (!combinationKey) {
    return [];
  }

  const requirements: ParsedRequirement[] = [];
  const segments = combinationKey.split(",").map((segment) => segment.trim());

  for (const segment of segments) {
    const match = /^req:(\d+):([^=]+)=>([^:]+):(\d+)$/.exec(segment);
    if (!match) {
      continue;
    }
    requirements.push({
      index: Number(match[1]),
      name: match[2].replace(/_/g, " "),
      skuId: match[3],
      quantity: Number(match[4]),
    });
  }

  return requirements.sort((a, b) => a.index - b.index);
}
