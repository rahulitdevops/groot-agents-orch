// Pricing per 1M tokens (approximate)
const MODEL_PRICING: Record<string, { input: number; output: number; cache?: number }> = {
  'opus': { input: 15.0, output: 75.0, cache: 1.5 },
  'claude-opus-4-6': { input: 15.0, output: 75.0, cache: 1.5 },
  'sonnet': { input: 3.0, output: 15.0, cache: 0.3 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cache: 0.3 },
  'haiku': { input: 0.25, output: 1.25, cache: 0.03 },
  'claude-haiku-3': { input: 0.25, output: 1.25, cache: 0.03 },
  'gpt-5.2': { input: 2.0, output: 8.0 },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number, cacheTokens: number = 0): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['sonnet'];
  return (inputTokens * pricing.input + outputTokens * pricing.output + cacheTokens * (pricing.cache || 0)) / 1_000_000;
}
