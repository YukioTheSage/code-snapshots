import type { Snapshot } from './snapshotManager';

/** Sentinel for "the workspace does not correspond to any snapshot". */
export const ACTIVE_NONE = -1;

/** Direction of a previous/next snapshot navigation. */
export type NavigationDirection = 'previous' | 'next';

/**
 * Resolves the active snapshot's index from its id.
 *
 * The index is derived from identity rather than from position, because the
 * snapshot list is pruned and re-sorted: an index captured earlier can point
 * at a different snapshot later.
 */
export function resolveActiveIndex(
  snapshots: Snapshot[],
  activeSnapshotId: string | null,
): number {
  if (!activeSnapshotId) {
    return ACTIVE_NONE;
  }
  const index = snapshots.findIndex((s) => s.id === activeSnapshotId);
  return index === -1 ? ACTIVE_NONE : index;
}

/**
 * Resolves which snapshot a previous/next navigation should move to.
 *
 * Returns `ACTIVE_NONE` when there is nothing to navigate to, so every caller
 * has one condition to branch on instead of comparing indices itself. Defining
 * this once matters because both `SnapshotManager` and the two commands that
 * drive it need the identical answer: the previous behaviour compared
 * `currentIndex <= 0` in both places, which reported "No previous snapshots
 * available" whenever no snapshot was active, and resolved "next" to
 * `snapshots[0]` -- the *oldest* snapshot -- for the same reason.
 *
 * From the detached state both directions start at the newest snapshot: the
 * workspace is not at any snapshot, so the nearest one to move to is the most
 * recent, and the user can then step from there.
 */
export function resolveNavigationTarget(
  snapshots: Snapshot[],
  activeIndex: number,
  direction: NavigationDirection,
): number {
  if (snapshots.length === 0) {
    return ACTIVE_NONE;
  }

  const newest = snapshots.length - 1;
  if (activeIndex === ACTIVE_NONE) {
    return newest;
  }
  if (direction === 'previous') {
    return activeIndex - 1;
  }
  return activeIndex >= newest ? ACTIVE_NONE : activeIndex + 1;
}
