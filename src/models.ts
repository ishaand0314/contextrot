/**
 * Known model context-window sizes, in tokens.
 *
 * Used to project turns-until-compaction for a given model. Unknown model
 * names should fall back to `DEFAULT_CONTEXT_WINDOW`.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-5': 200000,
  'claude-opus-4.8': 200000,
  'claude-haiku-4.5': 200000,
  'gpt-5': 400000,
  'gemini-2.5-pro': 1000000,
};

/** Fallback context window (in tokens) for models not present in `MODEL_CONTEXT_WINDOWS`. */
export const DEFAULT_CONTEXT_WINDOW = 200000;
