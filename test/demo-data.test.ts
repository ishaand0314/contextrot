import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { classify } from '../src/classify';
import { DEMO_TRANSCRIPT } from '../src/demo-data';
import type { RotCategory } from '../src/types';

const ALL_ROT_CATEGORIES: RotCategory[] = [
  'duplicate-read',
  'superseded-read',
  'repeated-tool-call',
  'dead-system-reminder',
  'unreferenced-large-output',
  'stale-todo-snapshot',
];

describe('DEMO_TRANSCRIPT', () => {
  it('has a realistic entry count (~40-60 entries)', () => {
    expect(DEMO_TRANSCRIPT.length).toBeGreaterThanOrEqual(40);
    expect(DEMO_TRANSCRIPT.length).toBeLessThanOrEqual(60);
  });

  it('produces at least one hit in every RotCategory via classify()', () => {
    const classified = classify(DEMO_TRANSCRIPT);

    for (const category of ALL_ROT_CATEGORIES) {
      const hits = classified.filter((entry) => entry.rot === category);
      expect(hits.length, `expected at least one "${category}" hit`).toBeGreaterThanOrEqual(1);
    }
  });

  it('produces at least one hit in every RotCategory via analyze()', () => {
    const report = analyze(DEMO_TRANSCRIPT);

    for (const category of ALL_ROT_CATEGORIES) {
      expect(
        report.byCategory[category].count,
        `expected byCategory["${category}"].count >= 1`
      ).toBeGreaterThanOrEqual(1);
      // Token totals are non-negative for every category; not all categories
      // are guaranteed a positive token count here since duplicate-read hits
      // land on `tool_use` entries (e.g. a bare Read call), which carry no
      // `content` of their own in a realistic transcript.
      expect(
        report.byCategory[category].tokens,
        `expected byCategory["${category}"].tokens >= 0`
      ).toBeGreaterThanOrEqual(0);
    }

    expect(report.rotTokens).toBeGreaterThan(0);
    expect(report.totalTokens).toBeGreaterThan(report.rotTokens);
    expect(report.topOffenders.length).toBeGreaterThan(0);
  });

  it('includes at least one unreferenced large output over the 800-token threshold', () => {
    const classified = classify(DEMO_TRANSCRIPT);
    const bigOffenders = classified.filter(
      (entry) => entry.rot === 'unreferenced-large-output' && entry.tokens > 800
    );
    expect(bigOffenders.length).toBeGreaterThanOrEqual(1);
  });

  it('only the last of each repeated system-reminder kind is left live', () => {
    const classified = classify(DEMO_TRANSCRIPT);
    const systemReminders = classified.filter((entry) => entry.type === 'system_reminder');

    // Environment-info reminders: 4 total, only the last should be live (rot: null).
    const envReminders = systemReminders.filter((entry) => entry.content?.startsWith('Environment info'));
    expect(envReminders.length).toBe(4);
    expect(envReminders.slice(0, -1).every((entry) => entry.rot !== null)).toBe(true);
    expect(envReminders[envReminders.length - 1].rot).toBeNull();

    // Todo-list snapshots: 3 total, only the last should be live (rot: null).
    const todoReminders = systemReminders.filter((entry) => entry.content?.trim().startsWith('[{"content"'));
    expect(todoReminders.length).toBe(3);
    expect(todoReminders.slice(0, -1).every((entry) => entry.rot === 'stale-todo-snapshot')).toBe(true);
    expect(todoReminders[todoReminders.length - 1].rot).toBeNull();
  });
});
