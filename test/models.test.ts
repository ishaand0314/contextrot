import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, MODEL_CONTEXT_WINDOWS } from '../src/models';

describe('MODEL_CONTEXT_WINDOWS', () => {
  it('includes the expected known models with their context windows', () => {
    expect(MODEL_CONTEXT_WINDOWS['claude-sonnet-5']).toBe(200000);
    expect(MODEL_CONTEXT_WINDOWS['claude-opus-4.8']).toBe(200000);
    expect(MODEL_CONTEXT_WINDOWS['claude-haiku-4.5']).toBe(200000);
    expect(MODEL_CONTEXT_WINDOWS['gpt-5']).toBe(400000);
    expect(MODEL_CONTEXT_WINDOWS['gemini-2.5-pro']).toBe(1000000);
  });

  it('does not have an entry for an unknown model', () => {
    expect(MODEL_CONTEXT_WINDOWS['not-a-real-model']).toBeUndefined();
  });

  it('has only positive integer context windows', () => {
    for (const window of Object.values(MODEL_CONTEXT_WINDOWS)) {
      expect(Number.isInteger(window)).toBe(true);
      expect(window).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_CONTEXT_WINDOW', () => {
  it('is a positive integer fallback', () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200000);
    expect(Number.isInteger(DEFAULT_CONTEXT_WINDOW)).toBe(true);
  });
});
