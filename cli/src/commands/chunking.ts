import { CodeLapseClient } from '../client';

export class ChunkingCommands {
  constructor(private client: CodeLapseClient) {}

  async file(filePath: string, options: any): Promise<void> {
    if (!options.snapshot) {
      console.log(JSON.stringify({
        success: false,
        error: 'Snapshot ID is required for file chunking',
        suggestions: ['Use --snapshot <id> to specify snapshot']
      }));
      return;
    }

    const chunkingOpts = {
      filePath,
      snapshotId: options.snapshot,
      strategy: options.strategy || 'semantic',
      options: {
        maxChunkSize: parseInt(options.maxSize) || 1000,
        minChunkSize: parseInt(options.minSize) || 50,
        overlap: parseInt(options.overlap) || 0,
        preserveStructure: options.preserveStructure !== false,
        includeContext: options.context !== false
      }
    };

    try {
      const result = await this.client.callApi('enhancedChunkFile', chunkingOpts);
      console.log(JSON.stringify({
        success: true,
        filePath,
        snapshotId: options.snapshot,
        strategy: options.strategy || 'semantic',
        chunks: result.chunks,
        summary: result.summary,
        metadata: result.metadata
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify file path exists', 'Check snapshot availability', 'Validate chunking strategy']
      }));
    }
  }

  async snapshot(snapshotId: string, options: any): Promise<void> {
    const chunkingOpts = {
      snapshotId,
      strategy: options.strategy || 'semantic',
      filePatterns: options.patterns ? options.patterns.split(',').map((p: string) => p.trim()) : undefined,
      options: {
        maxChunkSize: parseInt(options.maxSize) || 1000,
        minChunkSize: parseInt(options.minSize) || 50,
        overlap: parseInt(options.overlap) || 0,
        preserveStructure: options.preserveStructure !== false,
        includeContext: options.context !== false,
        excludeBinary: options.excludeBinary !== false,
        excludeTests: options.excludeTests === true
      }
    };

    try {
      const result = await this.client.callApi('chunkSnapshot', chunkingOpts);
      console.log(JSON.stringify({
        success: true,
        snapshotId,
        strategy: options.strategy || 'semantic',
        results: result.results,
        summary: result.summary,
        metadata: result.metadata
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify snapshot exists', 'Check file patterns', 'Validate chunking strategy']
      }));
    }
  }

  async list(snapshotId: string, options: any): Promise<void> {
    const listOpts = {
      snapshotId,
      filePath: options.file,
      filters: {
        semanticTypes: options.types ? options.types.split(',').map((t: string) => t.trim()) : undefined,
        qualityThreshold: parseFloat(options.qualityMin) || undefined,
        complexityRange: this.parseComplexityRange(options),
        hasPatterns: options.patterns ? options.patterns.split(',').map((p: string) => p.trim()) : undefined,
        excludeSmells: options.excludeSmells ? options.excludeSmells.split(',').map((s: string) => s.trim()) : undefined
      },
      pagination: {
        page: parseInt(options.page) || 1,
        limit: parseInt(options.limit) || 50
      },
      sortBy: options.sort || 'startLine',
      sortOrder: options.order || 'asc'
    };

    try {
      const result = await this.client.callApi('listChunks', listOpts);
      console.log(JSON.stringify({
        success: true,
        snapshotId,
        chunks: result.chunks,
        pagination: result.pagination,
        filters: listOpts.filters,
        metadata: result.metadata
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify snapshot exists', 'Check filter parameters', 'Validate pagination settings']
      }));
    }
  }

  async metadata(chunkId: string, options: any): Promise<void> {
    const metadataOpts = {
      chunkId,
      includeRelationships: options.relationships !== false,
      includeQuality: options.quality !== false,
      includeContext: options.context !== false,
      contextRadius: parseInt(options.contextRadius) || 5
    };

    try {
      const result = await this.client.callApi('getChunkMetadata', metadataOpts);
      console.log(JSON.stringify({
        success: true,
        chunkId,
        metadata: result.metadata,
        relationships: result.relationships,
        qualityMetrics: result.qualityMetrics,
        responseMetadata: result.responseMetadata
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check metadata options']
      }));
    }
  }

  async context(chunkId: string, options: any): Promise<void> {
    const contextOpts = {
      chunkId,
      contextRadius: parseInt(options.radius) || 5,
      includeFileContext: options.fileContext !== false,
      includeArchitecturalContext: options.architectural !== false,
      includeBusinessContext: options.business !== false
    };

    try {
      const result = await this.client.callApi('getChunkContext', contextOpts);
      console.log(JSON.stringify({
        success: true,
        chunkId,
        context: result.context,
        metadata: result.metadata
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check context radius parameter']
      }));
    }
  }

  async dependencies(chunkId: string, options: any): Promise<void> {
    const dependencyOpts = {
      chunkId,
      includeTransitive: options.transitive !== false,
      maxDepth: parseInt(options.depth) || 3,
      dependencyTypes: options.types ? options.types.split(',').map((t: string) => t.trim()) : undefined,
      includeStrength: options.strength !== false
    };

    try {
      const result = await this.client.callApi('getChunkDependencies', dependencyOpts);
      console.log(JSON.stringify({
        success: true,
        chunkId,
        dependencies: result.dependencies,
        dependents: result.dependents,
        metadata: result.metadata,
        summary: {
          directDependencies: result.dependencies?.direct?.length || 0,
          transitiveDependencies: result.dependencies?.transitive?.length || 0,
          totalDependents: result.dependents?.length || 0
        }
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check dependency parameters', 'Validate depth setting']
      }));
    }
  }

  private parseComplexityRange(options: any): [number, number] | undefined {
    if (options.complexityMin || options.complexityMax) {
      return [
        parseInt(options.complexityMin) || 0,
        parseInt(options.complexityMax) || 100
      ];
    }
    return undefined;
  }
}