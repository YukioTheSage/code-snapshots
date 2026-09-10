import { shouldFireRule } from '../services/ruleSchedule';
import { RuleScheduleStore } from '../services/ruleSchedule';

describe('shouldFireRule', () => {
  const now = 1_000_000_000_000;

  it('fires when the rule has never run', () => {
    expect(shouldFireRule(0, 5, now)).toBe(true);
  });

  it('does not fire before the interval has elapsed', () => {
    const fourMinutesAgo = now - 4 * 60 * 1000;
    expect(shouldFireRule(fourMinutesAgo, 5, now)).toBe(false);
  });

  it('fires once the interval has elapsed', () => {
    const sixMinutesAgo = now - 6 * 60 * 1000;
    expect(shouldFireRule(sixMinutesAgo, 5, now)).toBe(true);
  });

  it('fires exactly on the boundary', () => {
    const exactlyFive = now - 5 * 60 * 1000;
    expect(shouldFireRule(exactlyFive, 5, now)).toBe(true);
  });

  it('does not fire for a non-positive interval', () => {
    expect(shouldFireRule(0, 0, now)).toBe(false);
  });
});

describe('RuleScheduleStore', () => {
  function store(initial: Record<string, unknown> = {}) {
    const state = new Map(Object.entries(initial));
    const context = {
      workspaceState: {
        get: (key: string, fallback?: unknown) =>
          state.has(key) ? state.get(key) : fallback,
        update: async (key: string, value: unknown) => {
          state.set(key, value);
        },
      },
    } as any;
    return { store: new RuleScheduleStore(context), state };
  }

  it('returns zero for an unknown pattern', () => {
    const { store: s } = store();
    expect(s.get('src/**')).toBe(0);
  });

  it('persists a timestamp', async () => {
    const { store: s, state } = store();
    await s.set('src/**', 12345);
    expect(s.get('src/**')).toBe(12345);
    expect(state.get('codeSnapshots.ruleSchedule')).toEqual({
      'src/**': 12345,
    });
  });

  it('reloads persisted timestamps for a new instance', async () => {
    const { store: first, state } = store();
    await first.set('src/**', 999);

    const context = {
      workspaceState: {
        get: (key: string) => state.get(key),
        update: async () => undefined,
      },
    } as any;
    const second = new RuleScheduleStore(context);

    // The bug: this was 0 on every activation, so every rule fired at once.
    expect(second.get('src/**')).toBe(999);
  });

  it('ignores a corrupt persisted value', () => {
    const { store: s } = store({
      'codeSnapshots.ruleSchedule': 'not an object',
    });
    expect(s.get('src/**')).toBe(0);
  });

  it('clears a single pattern without disturbing the others', async () => {
    const { store: s, state } = store();
    await s.set('src/**', 1);
    await s.set('docs/**', 2);

    await s.clear('src/**');

    expect(s.get('src/**')).toBe(0);
    expect(s.get('docs/**')).toBe(2);
    expect(state.get('codeSnapshots.ruleSchedule')).toEqual({ 'docs/**': 2 });
  });

  it('ignores a persisted timestamp that is not a number', () => {
    const { store: s } = store({
      'codeSnapshots.ruleSchedule': { 'src/**': 'yesterday' },
    });
    expect(s.get('src/**')).toBe(0);
  });

  it('drops schedules for rules that no longer exist', async () => {
    const { store: s, state } = store();
    await s.set('src/**', 1);
    await s.set('renamed/**', 2);

    await s.pruneTo(['src/**']);

    expect(s.get('src/**')).toBe(1);
    expect(s.get('renamed/**')).toBe(0);
    expect(state.get('codeSnapshots.ruleSchedule')).toEqual({ 'src/**': 1 });
  });

  it('leaves the schedule untouched when every rule still exists', async () => {
    const { store: s, state } = store();
    await s.set('src/**', 1);

    await s.pruneTo(['src/**', 'docs/**']);

    expect(state.get('codeSnapshots.ruleSchedule')).toEqual({ 'src/**': 1 });
  });
});
