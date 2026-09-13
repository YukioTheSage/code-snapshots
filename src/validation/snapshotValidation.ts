import { Snapshot } from '../snapshotManager';
import { validateSnapshotId } from '../pathSecurity';
import {
  assertBoolean,
  assertNumber,
  assertString,
  assertStringArray,
  isObjectRecord,
} from './common';

export interface SnapshotIndex {
  snapshots: Array<{ id: string; timestamp: number; description: string }>;
  currentIndex: number;
  activeSnapshotId?: string | null;
}

function validateSnapshotFileEntry(value: unknown, fieldName: string): void {
  if (!isObjectRecord(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  if (
    'content' in value &&
    value.content !== undefined &&
    value.content !== null &&
    typeof value.content !== 'string'
  ) {
    throw new Error(`${fieldName}.content must be a string or null`);
  }
  if (
    'diff' in value &&
    value.diff !== undefined &&
    typeof value.diff !== 'string'
  ) {
    throw new Error(`${fieldName}.diff must be a string`);
  }
  if ('baseSnapshotId' in value && value.baseSnapshotId !== undefined) {
    assertString(value.baseSnapshotId, `${fieldName}.baseSnapshotId`);
    validateSnapshotId(value.baseSnapshotId);
  }
  if ('deleted' in value && value.deleted !== undefined) {
    assertBoolean(value.deleted, `${fieldName}.deleted`);
  }
  if ('isBinary' in value && value.isBinary !== undefined) {
    assertBoolean(value.isBinary, `${fieldName}.isBinary`);
  }
}

export function validateSnapshot(value: unknown): asserts value is Snapshot {
  if (!isObjectRecord(value)) {
    throw new Error('Snapshot must be an object');
  }

  assertString(value.id, 'snapshot.id');
  validateSnapshotId(value.id);
  assertNumber(value.timestamp, 'snapshot.timestamp');
  assertString(value.description, 'snapshot.description', { allowEmpty: true });

  if ('gitBranch' in value && value.gitBranch !== undefined) {
    assertString(value.gitBranch, 'snapshot.gitBranch', { allowEmpty: true });
  }
  if ('gitCommitHash' in value && value.gitCommitHash !== undefined) {
    assertString(value.gitCommitHash, 'snapshot.gitCommitHash', {
      allowEmpty: true,
    });
  }
  if ('tags' in value && value.tags !== undefined) {
    assertStringArray(value.tags, 'snapshot.tags');
  }
  if ('notes' in value && value.notes !== undefined) {
    assertString(value.notes, 'snapshot.notes', { allowEmpty: true });
  }
  if ('taskReference' in value && value.taskReference !== undefined) {
    assertString(value.taskReference, 'snapshot.taskReference', {
      allowEmpty: true,
    });
  }
  if ('isFavorite' in value && value.isFavorite !== undefined) {
    assertBoolean(value.isFavorite, 'snapshot.isFavorite');
  }
  if ('isSelective' in value && value.isSelective !== undefined) {
    assertBoolean(value.isSelective, 'snapshot.isSelective');
  }
  if ('selectedFiles' in value && value.selectedFiles !== undefined) {
    assertStringArray(value.selectedFiles, 'snapshot.selectedFiles');
  }

  if (!isObjectRecord(value.files)) {
    throw new Error('snapshot.files must be an object');
  }

  for (const [filePath, fileValue] of Object.entries(value.files)) {
    validateSnapshotFileEntry(fileValue, `snapshot.files["${filePath}"]`);
  }
}

export function validateSnapshotIndex(
  value: unknown,
): asserts value is SnapshotIndex {
  if (!isObjectRecord(value)) {
    throw new Error('Snapshot index must be an object');
  }

  if (!Array.isArray(value.snapshots)) {
    throw new Error('snapshotIndex.snapshots must be an array');
  }

  value.snapshots.forEach((item, index) => {
    if (!isObjectRecord(item)) {
      throw new Error(`snapshotIndex.snapshots[${index}] must be an object`);
    }
    assertString(item.id, `snapshotIndex.snapshots[${index}].id`);
    validateSnapshotId(item.id);
    assertNumber(item.timestamp, `snapshotIndex.snapshots[${index}].timestamp`);
    assertString(
      item.description,
      `snapshotIndex.snapshots[${index}].description`,
      {
        allowEmpty: true,
      },
    );
  });

  assertNumber(value.currentIndex, 'snapshotIndex.currentIndex');
  if (!Number.isInteger(value.currentIndex) || value.currentIndex < -1) {
    throw new Error('snapshotIndex.currentIndex must be an integer >= -1');
  }

  // `activeSnapshotId` is deliberately not asserted. A wrong-typed value here
  // is not worth quarantining the whole index -- and with it the entire
  // snapshot list -- for: `SnapshotManager.loadSnapshots` only trusts a string
  // and treats anything else as "detached", which is the safe reading.
}
