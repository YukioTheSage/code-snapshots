import { CodeLapseClient } from '../client';

export class AnalysisCommands {
  constructor(private client: CodeLapseClient) {}

  async chunk(chunkId: string, options: any): Promise<void> {
    const analysisOpts = {
      chunkId,
      snapshotId: options.snapshot,
      analysisType: options.type || 'full',
      includeRelationships: options.relationships !== false,
      includeQuality: options.quality !== false,
      includeContext: options.context !== false
    };

    try {
      const result = await this.client.callApi('analyzeChunk', analysisOpts);
      console.log(JSON.stringify({
        success: true,
        chunkId,
        analysis: result,
        summary: {
          qualityScore: result.analysis?.qualityMetrics?.overallScore || 0,
          complexityScore: result.analysis?.qualityMetrics?.complexityScore || 0,
          relationshipCount: result.analysis?.relationships?.length || 0,
          securityConcerns: result.analysis?.securityConcerns?.length || 0
        }
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check snapshot availability', 'Validate analysis type']
      }));
    }
  }

  async file(filePath: string, options: any): Promise<void> {
    if (!options.snapshot) {
      console.log(JSON.stringify({
        success: false,
        error: 'Snapshot ID is required for file analysis',
        suggestions: ['Use --snapshot <id> to specify snapshot']
      }));
      return;
    }

    const analysisOpts = {
      filePath,
      snapshotId: options.snapshot,
      analysisType: options.type || 'full',
      includeChunks: options.chunks !== false,
      includeMetrics: options.metrics !== false,
      includeSuggestions: options.suggestions !== false
    };

    try {
      const result = await this.client.callApi('analyzeFile', analysisOpts);
      console.log(JSON.stringify({
        success: true,
        filePath,
        snapshotId: options.snapshot,
        analysis: result,
        summary: {
          totalChunks: result.fileMetrics?.totalChunks || 0,
          totalLines: result.fileMetrics?.totalLines || 0,
          averageQuality: result.fileMetrics?.averageQuality || 0,
          securityConcerns: result.fileMetrics?.securityConcerns?.length || 0,
          designPatterns: result.fileMetrics?.designPatterns?.length || 0
        }
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify file path exists', 'Check snapshot availability', 'Validate analysis options']
      }));
    }
  }

  async quality(target: string, options: any): Promise<void> {
    if (!options.snapshot) {
      console.log(JSON.stringify({
        success: false,
        error: 'Snapshot ID is required for quality analysis',
        suggestions: ['Use --snapshot <id> to specify snapshot']
      }));
      return;
    }

    const analysisOpts = {
      target,
      snapshotId: options.snapshot,
      metrics: options.metrics ? options.metrics.split(',').map((m: string) => m.trim()) : ['all'],
      includeRecommendations: options.recommendations !== false,
      includeTrends: options.trends !== false,
      threshold: parseFloat(options.threshold) || 0.7
    };

    try {
      const result = await this.client.callApi('analyzeQuality', analysisOpts);
      console.log(JSON.stringify({
        success: true,
        target,
        snapshotId: options.snapshot,
        qualityAnalysis: result.qualityAnalysis,
        summary: {
          overallScore: result.qualityAnalysis?.overallScore || 0,
          improvingMetrics: result.qualityAnalysis?.trends?.improving?.length || 0,
          decliningMetrics: result.qualityAnalysis?.trends?.declining?.length || 0,
          recommendations: result.qualityAnalysis?.recommendations?.length || 0
        }
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify target specification', 'Check snapshot availability', 'Validate quality metrics']
      }));
    }
  }

  async relationships(chunkId: string, options: any): Promise<void> {
    const analysisOpts = {
      chunkId,
      includeTransitive: options.transitive !== false,
      maxDepth: parseInt(options.depth) || 3,
      relationshipTypes: options.types ? options.types.split(',').map((t: string) => t.trim()) : undefined,
      includeStrength: options.strength !== false
    };

    try {
      const result = await this.client.callApi('getChunkDependencies', analysisOpts);
      console.log(JSON.stringify({
        success: true,
        chunkId,
        relationships: result,
        summary: {
          directDependencies: result.dependencies?.direct?.length || 0,
          transitiveDependencies: result.dependencies?.transitive?.length || 0,
          dependents: result.dependents?.length || 0,
          strongestRelationship: this.findStrongestRelationship(result)
        }
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check relationship parameters', 'Validate depth setting']
      }));
    }
  }

  async batch(inputFile: string, options: any): Promise<void> {
    try {
      const fs = await import('fs');
      const operations = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

      if (!Array.isArray(operations)) {
        throw new Error('Input file must contain an array of analysis operations');
      }

      const batchOpts = {
        operations: operations.map((op: any, index: number) => ({
          id: op.id || `op-${index}`,
          type: op.type,
          data: op.data
        })),
        parallel: options.parallel !== false,
        maxConcurrency: parseInt(options.concurrency) || 5
      };

      const results = await this.client.callApi('batchAnalyze', batchOpts);
      console.log(JSON.stringify({
        success: true,
        batchResults: results,
        summary: {
          totalOperations: results.totalOperations || 0,
          successfulOperations: results.successfulOperations || 0,
          failedOperations: results.failedOperations || 0,
          processingTime: results.metadata?.processingTime || 0
        }
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Check input file format', 'Verify file path', 'Validate operation objects']
      }));
    }
  }

  private findStrongestRelationship(result: any): any {
    const allRelationships = [
      ...(result.dependencies?.direct || []),
      ...(result.dependents || [])
    ];

    if (allRelationships.length === 0) {
      return null;
    }

    return allRelationships.reduce((strongest: any, current: any) => {
      return (current.strength || 0) > (strongest.strength || 0) ? current : strongest;
    });
  }
}