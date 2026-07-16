import { countTokens as countTokensGpt } from 'gpt-tokenizer';

/**
 * Thin wrapper around the `gpt-tokenizer` package.
 *
 * Centralizing tokenization here means the rest of the codebase never
 * imports `gpt-tokenizer` directly, so the underlying tokenizer/model
 * can be swapped in one place.
 */

/**
 * Counts the number of tokens in a string using the gpt-tokenizer
 * (o200k_base) encoding.
 */
export function countTokens(text: string): number {
  return countTokensGpt(text);
}

/**
 * Counts the total number of tokens across a list of transcript entries
 * (or any arbitrary values). String entries are counted as-is; non-string
 * entries are JSON-stringified first so structured data (tool results,
 * message objects, etc.) can be counted consistently.
 */
export function countTokensForEntries(entries: unknown[]): number {
  return entries.reduce<number>((total, entry) => {
    const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
    return total + countTokens(text);
  }, 0);
}
