/**
 * Regression guard for `snapshot list` filters in standalone mode (BUG-6).
 *
 * The commands send CLI-shaped filters -- `{ tags: [...] }`, `{ isFavorite }`,
 * `{ limit }`, `{ dateRange: { start, end } }` -- while codelapse-core's
 * `SnapshotFilter` reads `tag`, `favorite`, `startDate`, `endDate` and has no
 * notion of a limit. Every option was therefore dropped on the floor:
 * `snapshot list --tags a` returned untagged snapshots, `--favorites` returned
 * non-favorites, `--limit 1` returned everything, and all of it exited 0.
 */

import { StandaloneHandler, normalizeListFilter } from '../standaloneHandler';

interface FakeSnapshot {
  id: string;
  tags: string[];
  isFavorite: boolean;
  timestamp: number;
}

const SNAPSHOTS: FakeSnapshot[] = [
  { id: 's1', tags: ['a'], isFavorite: false, timestamp: 100 },
  { id: 's2', tags: ['a', 'b'], isFavorite: true, timestamp: 200 },
  { id: 's3', tags: [], isFavorite: false, timestamp: 300 },
];

/**
 * Handler whose manager mimics core's filter semantics, so the assertions
 * cover both the key translation and the local (limit / multi-tag) pass.
 */
function handlerWithFakeManager(): {
  handler: StandaloneHandler;
  seenFilters: Record<string, unknown>[];
} {
  const seenFilters: Record<string, unknown>[] = [];
  const handler = new StandaloneHandler();

  (handler as unknown as { snapshotManager: unknown }).snapshotManager = {
    getSnapshots: async (filter: Record<string, unknown> = {}) => {
      seenFilters.push(filter);
      let out = [...SNAPSHOTS];

      if (typeof filter.tag === 'string') {
        out = out.filter((s) => s.tags.includes(filter.tag as string));
      }
      if (typeof filter.favorite === 'boolean') {
        out = out.filter((s) => s.isFavorite === filter.favorite);
      }
      if (typeof filter.startDate === 'number') {
        out = out.filter((s) => s.timestamp >= (filter.startDate as number));
      }
      if (typeof filter.endDate === 'number') {
        out = out.filter((s) => s.timestamp <= (filter.endDate as number));
      }
      return out;
    },
  };

  return { handler, seenFilters };
}

describe('normalizeListFilter', () => {
  it('maps the CLI filter shape onto the core filter shape', () => {
    const out = normalizeListFilter({
      tags: ['a'],
      isFavorite: true,
      dateRange: { start: 123, end: 456 },
      limit: 2,
    });

    expect(out.tag).toBe('a');
    expect(out.favorite).toBe(true);
    expect(out.startDate).toBe(123);
    expect(out.endDate).toBe(456);
    expect(out.limit).toBe(2);
  });

  it('keeps extra tags for local matching and accepts from/to spellings', () => {
    const out = normalizeListFilter({
      tags: ['a', 'b'],
      dateRange: { from: 1, to: 9 },
    });

    expect(out.tag).toBe('a');
    expect(out.pendingTags).toEqual(['a', 'b']);
    expect(out.startDate).toBe(1);
    expect(out.endDate).toBe(9);
  });

  it('passes core-native fields through untouched', () => {
    const out = normalizeListFilter({ tag: 'x', favorite: true, search: 'q' });

    expect(out).toMatchObject({ tag: 'x', favorite: true, search: 'q' });
    expect(out.pendingTags).toBeUndefined();
  });

  it('returns an empty filter for undefined input', () => {
    expect(normalizeListFilter(undefined)).toEqual({ kind: 'core' });
  });
});

describe('standaloneHandler.getSnapshots filter wiring (BUG-6)', () => {
  it('honors --tags for a single tag', async () => {
    const { handler, seenFilters } = handlerWithFakeManager();

    const result = await handler.getSnapshots({ tags: ['a'] } as never);

    expect(seenFilters[0].tag).toBe('a');
    expect(result.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('requires every tag when several are given', async () => {
    const { handler } = handlerWithFakeManager();

    const result = await handler.getSnapshots({ tags: ['a', 'b'] } as never);

    expect(result.map((s) => s.id)).toEqual(['s2']);
  });

  it('honors --favorites', async () => {
    const { handler, seenFilters } = handlerWithFakeManager();

    const result = await handler.getSnapshots({ isFavorite: true } as never);

    expect(seenFilters[0].favorite).toBe(true);
    expect(result.map((s) => s.id)).toEqual(['s2']);
  });

  it('honors --limit', async () => {
    const { handler } = handlerWithFakeManager();

    const result = await handler.getSnapshots({ limit: 2 } as never);

    expect(result.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('honors --since via dateRange', async () => {
    const { handler, seenFilters } = handlerWithFakeManager();

    const result = await handler.getSnapshots({
      dateRange: { start: 150, end: 250 },
    } as never);

    expect(seenFilters[0]).toMatchObject({ startDate: 150, endDate: 250 });
    expect(result.map((s) => s.id)).toEqual(['s2']);
  });
});
