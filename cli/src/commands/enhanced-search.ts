/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnifiedClient } from '../unifiedClient';
import { printResult } from './output';

export class EnhancedSearchCommands {
  constructor(private client: UnifiedClient) {}

  async enhanced(query: string, options: any): Promise<void> {
    const searchOpts = {
      query,
      limit: parseInt(options.limit) || 20,
      scoreThreshold: parseFloat(options.threshold) || 0.65,
      snapshotIds: options.snapshots
        ? options.snapshots.split(',').map((s: string) => s.trim())
        : undefined,
      languages: options.languages
        ? options.languages.split(',').map((l: string) => l.trim())
        : undefined,
      searchMode: options.mode || 'semantic',
      includeExplanations: options.explanations !== false,
      includeRelationships: options.relationships !== false,
      includeQualityMetrics: options.quality !== false,
      contextRadius: parseInt(options.context) || 5,
      rankingStrategy: options.ranking || 'relevance',
      filterCriteria: this.parseFilterCriteria(options),
      maxResultsPerFile: parseInt(options.maxPerFile) || undefined,
      enableDiversification: options.diversify !== false,
    };

    try {
      const results = await this.client.callApi('enhancedSearch', searchOpts);
      printResult(
        {
          success: true,
          query,
          results,
          metadata: results.metadata || {},
          suggestions: results.suggestions || [],
          relatedQueries: results.relatedQueries || [],
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: [
            'Check semantic search service availability',
            'Verify query parameters',
          ],
        },
        options,
      );
    }
  }

  async behavioral(description: string, options: any): Promise<void> {
    const searchOpts = {
      query: description,
      searchMode: 'behavioral',
      limit: parseInt(options.limit) || 20,
      scoreThreshold: parseFloat(options.threshold) || 0.6,
      snapshotIds: options.snapshots
        ? options.snapshots.split(',').map((s: string) => s.trim())
        : undefined,
      languages: options.languages
        ? options.languages.split(',').map((l: string) => l.trim())
        : undefined,
      includeExplanations: true,
      includeRelationships: options.relationships !== false,
      contextRadius: parseInt(options.context) || 5,
    };

    try {
      const results = await this.client.callApi('enhancedSearch', searchOpts);
      printResult(
        {
          success: true,
          description,
          searchMode: 'behavioral',
          results,
          metadata: results.metadata || {},
          behaviorAnalysis: {
            matchedBehaviors:
              results.results?.map(
                (r: any) => r.explanation?.matchedConcepts,
              ) || [],
            confidenceScores:
              results.results?.map(
                (r: any) => r.explanation?.confidenceFactors,
              ) || [],
          },
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: [
            'Refine behavior description',
            'Check available snapshots',
          ],
        },
        options,
      );
    }
  }

  async pattern(patternType: string, options: any): Promise<void> {
    const searchOpts = {
      query: `Find ${patternType} pattern implementations`,
      searchMode: 'pattern',
      patternType,
      limit: parseInt(options.limit) || 15,
      scoreThreshold: parseFloat(options.threshold) || 0.7,
      snapshotIds: options.snapshots
        ? options.snapshots.split(',').map((s: string) => s.trim())
        : undefined,
      languages: options.languages
        ? options.languages.split(',').map((l: string) => l.trim())
        : undefined,
      includeExplanations: true,
      includeRelationships: true,
      contextRadius: parseInt(options.context) || 8,
    };

    try {
      const results = await this.client.callApi('enhancedSearch', searchOpts);
      printResult(
        {
          success: true,
          patternType,
          searchMode: 'pattern',
          results,
          metadata: results.metadata || {},
          patternAnalysis: {
            foundPatterns:
              results.results?.map(
                (r: any) => r.enhancedMetadata?.designPatterns,
              ) || [],
            implementations: results.results?.length || 0,
            qualityScores:
              results.results?.map(
                (r: any) => r.qualityMetrics?.overallScore,
              ) || [],
          },
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: [
            'Check pattern type spelling',
            'Try common patterns like Factory, Observer, Strategy',
          ],
        },
        options,
      );
    }
  }

  async batch(queriesFile: string, options: any): Promise<void> {
    try {
      const fs = await import('fs');
      const queries = JSON.parse(fs.readFileSync(queriesFile, 'utf8'));

      if (!Array.isArray(queries)) {
        throw new Error('Queries file must contain an array of query objects');
      }

      const batchOpts = {
        queries: queries.map((q: any, index: number) => ({
          id: q.id || `query-${index}`,
          query: q.query,
          searchMode: q.searchMode || 'semantic',
          limit: q.limit || 20,
          scoreThreshold: q.scoreThreshold || 0.65,
          snapshotIds: q.snapshotIds,
          languages: q.languages,
          includeExplanations: q.includeExplanations !== false,
          includeRelationships: q.includeRelationships !== false,
          contextRadius: q.contextRadius || 5,
        })),
        parallel: options.parallel !== false,
        maxConcurrency: parseInt(options.concurrency) || 3,
      };

      const results = await this.client.callApi('batchSearch', batchOpts);

      // `handleBatchSearch` rejects an invalid batch by RETURNING a failed
      // payload rather than throwing: it catches its own validation errors and
      // answers `{success: false, error: {message, ...}}`, which the client
      // resolves like any other result. Reporting that as `success: true`
      // printed a rejected batch as a successful run of zero queries and exited 0.
      if (results?.success === false) {
        printResult(
          {
            success: false,
            batchResults: results,
            error: results.error?.message ?? 'Batch search failed',
          },
          options,
        );
        return;
      }

      printResult(
        {
          success: true,
          batchResults: results,
          summary: {
            totalQueries: results.totalQueries || 0,
            successfulQueries: results.successfulQueries || 0,
            failedQueries: results.failedQueries || 0,
          },
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: [
            'Check queries file format',
            'Verify file path',
            'Validate query objects',
          ],
        },
        options,
      );
    }
  }

  private parseFilterCriteria(options: any): any {
    const criteria: any = {};

    if (options.complexityMin || options.complexityMax) {
      criteria.complexityRange = [
        parseInt(options.complexityMin) || 0,
        parseInt(options.complexityMax) || 100,
      ];
    }

    if (options.qualityMin) {
      criteria.qualityThreshold = parseFloat(options.qualityMin);
    }

    if (options.semanticTypes) {
      criteria.semanticTypes = options.semanticTypes
        .split(',')
        .map((t: string) => t.trim());
    }

    if (options.patterns) {
      criteria.designPatterns = options.patterns
        .split(',')
        .map((p: string) => p.trim());
    }

    if (options.excludeSmells) {
      criteria.excludeCodeSmells = options.excludeSmells
        .split(',')
        .map((s: string) => s.trim());
    }

    if (options.domains) {
      criteria.businessDomains = options.domains
        .split(',')
        .map((d: string) => d.trim());
    }

    return criteria;
  }
}
