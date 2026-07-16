import { describe, expect, it } from 'vitest';
import { countTokens, countTokensForEntries } from '../src/tokenizer';

describe('countTokens', () => {
  it('counts tokens in a simple string', () => {
    const count = countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('returns 0 for an empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('returns a larger count for longer text', () => {
    const short = countTokens('Hello');
    const long = countTokens('Hello '.repeat(50));
    expect(long).toBeGreaterThan(short);
  });
});

describe('countTokensForEntries', () => {
  it('returns 0 for an empty array', () => {
    expect(countTokensForEntries([])).toBe(0);
  });

  it('sums token counts across multiple string entries', () => {
    const a = countTokens('foo');
    const b = countTokens('bar baz');
    expect(countTokensForEntries(['foo', 'bar baz'])).toBe(a + b);
  });

  it('JSON-stringifies non-string entries before counting', () => {
    const entry = { role: 'user', content: 'hello there' };
    const expected = countTokens(JSON.stringify(entry));
    expect(countTokensForEntries([entry])).toBe(expected);
  });

  it('handles a mix of string and non-string entries', () => {
    const entries: unknown[] = ['plain text', { toolName: 'Read', filePath: 'a.ts' }, 42, null];
    const expected = entries.reduce<number>((total, entry) => {
      const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
      return total + countTokens(text);
    }, 0);
    expect(countTokensForEntries(entries)).toBe(expected);
  });
});
