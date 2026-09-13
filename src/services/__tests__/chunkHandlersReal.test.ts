/* eslint-disable @typescript-eslint/no-explicit-any */
import { CliConnectorService } from '../cliConnectorService';

describe('chunk handlers return derived data', () => {
  function service() {
    const chunks = [
      {
        id: 'src/a.ts:1-10',
        filePath: 'src/a.ts',
        startLine: 0,
        endLine: 9,
        content: 'export function parse(input: string) { return input; }',
        qualityMetrics: {
          overallScore: 88,
          readabilityScore: 90,
          maintainabilityScore: 85,
          documentationRatio: 0.4,
          duplicationRisk: 10,
          performanceRisk: 10,
          securityRisk: 5,
          styleComplianceScore: 80,
          technicalDebt: {
            estimatedFixTime: 1,
            severity: 'low',
            categories: [],
            issues: [],
          },
        },
        enhancedMetadata: {
          dependencies: ['node:fs'],
          designPatterns: [],
          securityConcerns: [],
          semanticType: 'function',
          complexityScore: 15,
          maintainabilityIndex: 85,
          codeSmells: [],
        },
        relationships: [],
        contextInfo: {
          surroundingContext: '// surrounding',
          architecturalLayer: 'service',
          frameworkContext: [],
          fileContext: {
            totalLines: 10,
            fileSize: 100,
            lastModified: new Date(1),
            encoding: 'utf-8',
            siblingChunks: [],
          },
        },
      },
    ];
    const connector = Object.create(CliConnectorService.prototype) as any;
    connector.terminalApiService = {
      getSnapshotFileContent: jest
        .fn()
        .mockResolvedValue('export function parse() {}'),
    };
    connector.enhancedCodeChunker = {
      chunkFileEnhanced: jest.fn().mockResolvedValue(chunks),
    };
    return connector;
  }

  it('analyze chunk reports the chunk that was found', async () => {
    const result = await service().handleAnalyzeChunk({
      chunkId: 'src/a.ts:1-10',
      snapshotId: 'snapshot-1',
      filePath: 'src/a.ts',
    });

    expect(result.analysis.qualityMetrics.overallScore).toBe(88);
    expect(result.analysis.qualityMetrics.overallScore).not.toBe(75);
  });

  it('chunk metadata reports real dependencies, never the example pair', async () => {
    const result = await service().handleGetChunkMetadata({
      chunkId: 'src/a.ts:1-10',
      snapshotId: 'snapshot-1',
      filePath: 'src/a.ts',
    });

    expect(JSON.stringify(result)).not.toContain('lodash');
    expect(result.metadata.dependencies).toEqual(['node:fs']);
  });

  it('chunk list never invents chunk-1 or example.ts', async () => {
    const result = await service().handleListChunks({
      snapshotId: 'snapshot-1',
      filePath: 'src/a.ts',
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('chunk-1');
    expect(serialized).not.toContain('example.ts');
    expect(result.chunks[0].id).toBe('src/a.ts:1-10');
  });

  it('reports an unknown chunk as an error, not as a fabricated one', async () => {
    const result = await service().handleAnalyzeChunk({
      chunkId: 'does-not-exist',
      snapshotId: 'snapshot-1',
      filePath: 'src/a.ts',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});
