export interface ClientBudgetDisclosure {
  operation: string;
  scopeLabel: string;
  inputChars: number;
  maxInputChars: number;
  estimatedInputTokens: number;
  maxInputTokens: number;
  withinLimit: boolean;
  warning?: string;
}

const DEFAULT_LIMITS: Record<string, { maxInputChars: number; maxInputTokens: number }> = {
  diagnostics: { maxInputChars: 40_000, maxInputTokens: 14_000 },
  sync: { maxInputChars: 40_000, maxInputTokens: 14_000 },
  writing: { maxInputChars: 24_000, maxInputTokens: 9_000 },
  opportunities: { maxInputChars: 36_000, maxInputTokens: 12_000 },
  'import-enhance': { maxInputChars: 28_000, maxInputTokens: 10_000 },
  'narrative-import': { maxInputChars: 32_000, maxInputTokens: 12_000 },
};

export function buildClientBudgetDisclosure(
  operation: string,
  scopeLabel: string,
  payloadOrText: unknown,
  overrideLimits?: { maxInputChars?: number; maxInputTokens?: number }
): ClientBudgetDisclosure {
  const serialized = typeof payloadOrText === 'string' ? payloadOrText : JSON.stringify(payloadOrText);
  const inputChars = serialized.length;
  const estimatedInputTokens = Math.max(1, Math.ceil(inputChars / 4));
  const defaults = DEFAULT_LIMITS[operation] ?? { maxInputChars: 8_000, maxInputTokens: 4_000 };
  const maxInputChars = overrideLimits?.maxInputChars ?? defaults.maxInputChars;
  const maxInputTokens = overrideLimits?.maxInputTokens ?? defaults.maxInputTokens;
  const withinLimit = inputChars <= maxInputChars && estimatedInputTokens <= maxInputTokens;
  return {
    operation,
    scopeLabel,
    inputChars,
    maxInputChars,
    estimatedInputTokens,
    maxInputTokens,
    withinLimit,
    ...(!withinLimit
      ? {
          warning: `Selected scope (${inputChars.toLocaleString()} chars / ~${estimatedInputTokens.toLocaleString()} est. tokens) exceeds the safe app limit (${maxInputChars.toLocaleString()} chars / ${maxInputTokens.toLocaleString()} tokens). Narrow the scope before sending.`,
        }
      : {}),
  };
}
