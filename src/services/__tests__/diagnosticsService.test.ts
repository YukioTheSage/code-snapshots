import { DiagnosticsService } from '../diagnosticsService';

function build(overrides: Record<string, unknown> = {}) {
  const snapshotManager = {
    getSnapshots: () => [{ id: 'snapshot-1', timestamp: 1, files: {} }],
    getIntegrityReport: () => ({
      unrecoverableFileCount: 42,
      brokenSnapshotIds: ['snapshot-1'],
      missingBaseSnapshotIds: ['snapshot-base'],
      perSnapshot: { 'snapshot-1': ['src/app.ts'] },
    }),
    getWorkspaceRoot: () => '/tmp/ws',
    ...overrides,
  };
  return new DiagnosticsService(snapshotManager as never, '/tmp/ws');
}

describe('DiagnosticsService', () => {
  it('is unhealthy when files cannot be reconstructed', async () => {
    const report = await build().runDiagnostics();

    expect(report.healthy).toBe(false);
    expect(report.integrity.unrecoverableFileCount).toBe(42);
    const check = report.checks.find((c) => c.name === 'snapshot-integrity');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('42');
  });

  it('is healthy when every check passes', async () => {
    const report = await build({
      getIntegrityReport: () => ({
        unrecoverableFileCount: 0,
        brokenSnapshotIds: [],
        missingBaseSnapshotIds: [],
        perSnapshot: {},
      }),
    }).runDiagnostics();

    expect(report.healthy).toBe(true);
  });

  it('reports the store size and snapshot count', async () => {
    const report = await build().runDiagnostics();

    expect(report.store.snapshotCount).toBe(1);
    expect(typeof report.store.totalBytes).toBe('number');
  });
});