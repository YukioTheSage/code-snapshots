export interface BatchApiCommand {
  method: string;
  data?: Record<string, unknown>;
}

export const ALLOWED_API_METHODS: ReadonlySet<string> = new Set([
  'addAutoSnapshotRule',
  'analyzeChunk',
  'analyzeFile',
  'analyzeQuality',
  'autoSnapshotBeforeGitOperation',
  'batchAnalyze',
  'batchSearch',
  'chunkSnapshot',
  'clearLogs',
  'compareSnapshotFile',
  'compareSnapshots',
  'compareSnapshotWithGitCommit',
  'createBranch',
  'createGitCommitFromSnapshot',
  'deleteBranch',
  'deleteSnapshot',
  'editSnapshotNotes',
  'editSnapshotTags',
  'editTaskReference',
  'enhancedChunkFile',
  'enhancedSearch',
  'exportConfig',
  'exportSnapshot',
  'exportSnapshotFile',
  'filterSnapshots',
  'getAutoSnapshotRules',
  'getChunkContext',
  'getChunkDependencies',
  'getChunkMetadata',
  'getConfig',
  'getConfigSchema',
  'getCurrentState',
  'getFileHistory',
  'getGitBranchInfo',
  'getLogs',
  'getPerformanceMetrics',
  'getSnapshot',
  'getSnapshotChanges',
  'getSnapshotFile',
  'getSnapshotFileContent',
  'getSnapshots',
  'getStatus',
  'getSystemInfo',
  'getWorkspaceInfo',
  'healthCheck',
  'importConfig',
  'indexSnapshots',
  'listBranches',
  'listChunks',
  'listSnapshotFiles',
  'navigateSnapshot',
  'removeAutoSnapshotRule',
  'resetConfig',
  'restoreSnapshot',
  'restoreSnapshotFile',
  'runDiagnostics',
  'searchSnapshots',
  'setConfig',
  'streamLogs',
  'switchBranch',
  'takeSnapshot',
  'testAutoSnapshotRule',
  'toggleAutoSnapshotRule',
  'toggleFavoriteStatus',
  'updateAutoSnapshotRule',
  'updateSnapshotMetadata',
  'validateConfig',
  'validateSnapshot',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertAllowedApiMethod(method: string): void {
  if (!method || typeof method !== 'string') {
    throw new Error('API method must be a non-empty string');
  }
  if (!ALLOWED_API_METHODS.has(method)) {
    throw new Error(
      `API method "${method}" is not allowed. Use "codelapse config list" or documentation to find supported API methods.`,
    );
  }
}

export function parseAndValidateBatchCommands(
  payload: unknown,
): BatchApiCommand[] {
  if (!Array.isArray(payload)) {
    throw new Error(
      'Batch file must contain an array of command objects: [{ "method": "name", "data": { ... } }]',
    );
  }

  return payload.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Batch command at index ${index} must be an object`);
    }

    const method = item.method;
    if (typeof method !== 'string' || method.trim() === '') {
      throw new Error(
        `Batch command at index ${index} must include a non-empty "method" string`,
      );
    }
    assertAllowedApiMethod(method);

    const data = item.data;
    if (data === undefined) {
      return { method };
    }
    if (!isRecord(data)) {
      throw new Error(
        `Batch command at index ${index} has invalid "data": expected an object`,
      );
    }

    return { method, data };
  });
}
