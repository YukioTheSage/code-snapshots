/**
 * Relationship Analyzer
 *
 * Implements comprehensive relationship analysis system for code chunks,
 * including dependency tracking, call graph analysis, usage pattern detection,
 * and semantic similarity analysis.
 */

import * as path from 'path';
import {
  ChunkRelationship,
  RelationshipType,
  RelationshipDirection,
  RelationshipMetadata,
  EnhancedCodeChunk,
  SemanticType,
} from '../types/enhancedChunking';
import { CodeChunk } from './codeChunker';

/**
 * Configuration for relationship analysis
 */
export interface RelationshipAnalysisConfig {
  /** Minimum confidence threshold for relationships (0-1) */
  minConfidenceThreshold: number;

  /** Maximum distance for similarity analysis */
  maxSimilarityDistance: number;

  /** Enable different types of analysis */
  enabledAnalysis: {
    imports: boolean;
    calls: boolean;
    inheritance: boolean;
    similarity: boolean;
    usage: boolean;
  };

  /** Language-specific configurations */
  languageConfig: Record<string, LanguageRelationshipConfig>;
}

/**
 * Language-specific relationship configuration
 */
export interface LanguageRelationshipConfig {
  /** Import/require patterns */
  importPatterns: RegExp[];

  /** Function call patterns */
  callPatterns: RegExp[];

  /** Class inheritance patterns */
  inheritancePatterns: RegExp[];

  /** Interface implementation patterns */
  implementationPatterns: RegExp[];

  /** Variable usage patterns */
  usagePatterns: RegExp[];

  /** Method override patterns */
  overridePatterns: RegExp[];
}

/**
 * Analysis result for a single chunk
 */
export interface ChunkAnalysisResult {
  /** The analyzed chunk */
  chunk: EnhancedCodeChunk;

  /** Discovered relationships */
  relationships: ChunkRelationship[];

  /** Analysis metadata */
  analysisMetadata: {
    analysisTime: number;
    confidenceScore: number;
    analysisTypes: string[];
    warnings: string[];
  };
}

/**
 * Batch analysis result
 */
export interface BatchAnalysisResult {
  /** Individual chunk results */
  chunkResults: ChunkAnalysisResult[];

  /** Global relationship graph */
  relationshipGraph: RelationshipGraph;

  /** Analysis summary */
  summary: {
    totalChunks: number;
    totalRelationships: number;
    averageConfidence: number;
    analysisTime: number;
    relationshipTypes: Record<RelationshipType, number>;
  };
}

/**
 * Relationship graph representation
 */
export interface RelationshipGraph {
  /** Nodes (chunks) in the graph */
  nodes: Map<string, EnhancedCodeChunk>;

  /** Edges (relationships) in the graph */
  edges: Map<string, ChunkRelationship[]>;

  /** Adjacency list for efficient traversal */
  adjacencyList: Map<string, string[]>;

  /** Reverse adjacency list for dependency analysis */
  reverseAdjacencyList: Map<string, string[]>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RelationshipAnalysisConfig = {
  minConfidenceThreshold: 0.3,
  maxSimilarityDistance: 0.7,
  enabledAnalysis: {
    imports: true,
    calls: true,
    inheritance: true,
    similarity: true,
    usage: true,
  },
  languageConfig: {
    javascript: {
      importPatterns: [
        /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      ],
      callPatterns: [/(\w+)\s*\(/g, /(\w+)\.(\w+)\s*\(/g, /new\s+(\w+)\s*\(/g],
      inheritancePatterns: [
        /class\s+\w+\s+extends\s+(\w+)/g,
        /(\w+)\.prototype\s*=/g,
      ],
      implementationPatterns: [/class\s+\w+\s+implements\s+(\w+)/g],
      usagePatterns: [/\b(\w+)\./g, /\b(\w+)\[/g, /typeof\s+(\w+)/g],
      overridePatterns: [/override\s+(\w+)/g, /super\.(\w+)/g],
    },
    typescript: {
      importPatterns: [
        /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
        /import\s+type\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
        /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      ],
      callPatterns: [/(\w+)\s*\(/g, /(\w+)\.(\w+)\s*\(/g, /new\s+(\w+)\s*\(/g],
      inheritancePatterns: [
        /class\s+\w+\s+extends\s+(\w+)/g,
        /interface\s+\w+\s+extends\s+(\w+)/g,
      ],
      implementationPatterns: [/class\s+\w+\s+implements\s+(\w+)/g],
      usagePatterns: [
        /\b(\w+)\./g,
        /\b(\w+)\[/g,
        /typeof\s+(\w+)/g,
        /(\w+)\s*as\s+\w+/g,
      ],
      overridePatterns: [/override\s+(\w+)/g, /super\.(\w+)/g],
    },
    python: {
      importPatterns: [
        /from\s+([^\s]+)\s+import/g,
        /import\s+([^\s,]+)/g,
        /import\s+([^\s]+)\s+as\s+\w+/g,
      ],
      callPatterns: [/(\w+)\s*\(/g, /(\w+)\.(\w+)\s*\(/g, /(\w+)\(\)/g],
      inheritancePatterns: [
        /class\s+\w+\s*\(\s*(\w+)\s*\)/g,
        /class\s+\w+\s*\(\s*(\w+)\s*,/g,
      ],
      implementationPatterns: [
        // Python doesn't have explicit interface implementation
      ],
      usagePatterns: [
        /\b(\w+)\./g,
        /\b(\w+)\[/g,
        /isinstance\s*\(\s*\w+\s*,\s*(\w+)\s*\)/g,
      ],
      overridePatterns: [/super\(\)\.(\w+)/g, /super\(\w+,\s*self\)\.(\w+)/g],
    },
    java: {
      importPatterns: [/import\s+([^;]+);/g, /import\s+static\s+([^;]+);/g],
      callPatterns: [/(\w+)\s*\(/g, /(\w+)\.(\w+)\s*\(/g, /new\s+(\w+)\s*\(/g],
      inheritancePatterns: [/class\s+\w+\s+extends\s+(\w+)/g],
      implementationPatterns: [
        /class\s+\w+\s+implements\s+(\w+)/g,
        /class\s+\w+\s+implements\s+\w+,\s*(\w+)/g,
      ],
      usagePatterns: [/\b(\w+)\./g, /\b(\w+)\[/g, /instanceof\s+(\w+)/g],
      overridePatterns: [/@Override\s*\w+\s+(\w+)/g, /super\.(\w+)/g],
    },
  },
};

/**
 * Relationship analyzer class
 */
export class RelationshipAnalyzer {
  private config: RelationshipAnalysisConfig;
  private chunkCache: Map<string, EnhancedCodeChunk> = new Map();

  constructor(config: Partial<RelationshipAnalysisConfig> = {}) {
    this.config = this.mergeConfig(DEFAULT_CONFIG, config);
  }

  /**
   * Analyze relationships for a single chunk
   */
  async analyzeChunkRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkAnalysisResult> {
    const startTime = Date.now();
    const relationships: ChunkRelationship[] = [];
    const warnings: string[] = [];
    const analysisTypes: string[] = [];

    // Update chunk cache
    this.updateChunkCache(allChunks);

    try {
      // Import/dependency analysis
      if (this.config.enabledAnalysis.imports) {
        const importRelationships = await this.analyzeImportRelationships(
          chunk,
          allChunks,
        );
        relationships.push(...importRelationships);
        analysisTypes.push('imports');
      }

      // Function call analysis
      if (this.config.enabledAnalysis.calls) {
        const callRelationships = await this.analyzeCallRelationships(
          chunk,
          allChunks,
        );
        relationships.push(...callRelationships);
        analysisTypes.push('calls');
      }

      // Inheritance analysis
      if (this.config.enabledAnalysis.inheritance) {
        const inheritanceRelationships =
          await this.analyzeInheritanceRelationships(chunk, allChunks);
        relationships.push(...inheritanceRelationships);
        analysisTypes.push('inheritance');
      }

      // Usage pattern analysis
      if (this.config.enabledAnalysis.usage) {
        const usageRelationships = await this.analyzeUsageRelationships(
          chunk,
          allChunks,
        );
        relationships.push(...usageRelationships);
        analysisTypes.push('usage');
      }

      // Semantic similarity analysis
      if (this.config.enabledAnalysis.similarity) {
        const similarityRelationships = await this.analyzeSemanticSimilarity(
          chunk,
          allChunks,
        );
        relationships.push(...similarityRelationships);
        analysisTypes.push('similarity');
      }

      // Filter relationships by confidence threshold
      const filteredRelationships = relationships.filter(
        (rel) =>
          (rel.metadata?.confidence || 0) >= this.config.minConfidenceThreshold,
      );

      const analysisTime = Date.now() - startTime;
      const confidenceScore = this.calculateAverageConfidence(
        filteredRelationships,
      );

      return {
        chunk,
        relationships: filteredRelationships,
        analysisMetadata: {
          analysisTime,
          confidenceScore,
          analysisTypes,
          warnings,
        },
      };
    } catch (error) {
      warnings.push(`Analysis error: ${error}`);
      return {
        chunk,
        relationships: [],
        analysisMetadata: {
          analysisTime: Date.now() - startTime,
          confidenceScore: 0,
          analysisTypes,
          warnings,
        },
      };
    }
  }

  /**
   * Analyze relationships for multiple chunks in batch
   */
  async analyzeBatchRelationships(
    chunks: EnhancedCodeChunk[],
  ): Promise<BatchAnalysisResult> {
    const startTime = Date.now();
    const chunkResults: ChunkAnalysisResult[] = [];

    // Update chunk cache
    this.updateChunkCache(chunks);

    // Analyze each chunk
    for (const chunk of chunks) {
      const result = await this.analyzeChunkRelationships(chunk, chunks);
      chunkResults.push(result);
    }

    // Build relationship graph
    const relationshipGraph = this.buildRelationshipGraph(chunkResults);

    // Calculate summary statistics
    const summary = this.calculateBatchSummary(
      chunkResults,
      Date.now() - startTime,
    );

    return {
      chunkResults,
      relationshipGraph,
      summary,
    };
  }

  /**
   * Analyze import/dependency relationships
   */
  private async analyzeImportRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];
    const language = chunk.metadata.language;
    const langConfig = this.config.languageConfig[language];

    if (!langConfig) return relationships;

    // Extract import statements
    const imports = this.extractImports(chunk.content, langConfig);

    // Find matching chunks for each import
    for (const importPath of imports) {
      const targetChunks = this.findChunksByImportPath(
        importPath,
        allChunks,
        chunk.filePath,
      );

      for (const targetChunk of targetChunks) {
        relationships.push({
          type: 'imports',
          targetChunkId: targetChunk.id,
          strength: 0.8,
          description: `Imports from ${importPath}`,
          direction: 'outgoing',
          metadata: {
            confidence: 0.9,
            source: 'static_analysis',
            context: `Import statement: ${importPath}`,
          },
        });
      }
    }

    return relationships;
  }

  /**
   * Analyze function call relationships
   */
  private async analyzeCallRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];
    const language = chunk.metadata.language;
    const langConfig = this.config.languageConfig[language];

    if (!langConfig) return relationships;

    // Extract function calls
    const calls = this.extractFunctionCalls(chunk.content, langConfig);

    // Find matching chunks for each call
    for (const call of calls) {
      const targetChunks = this.findChunksByFunctionName(call, allChunks);

      for (const targetChunk of targetChunks) {
        if (targetChunk.id !== chunk.id) {
          relationships.push({
            type: 'calls',
            targetChunkId: targetChunk.id,
            strength: 0.7,
            description: `Calls function ${call}`,
            direction: 'outgoing',
            metadata: {
              confidence: 0.7,
              source: 'static_analysis',
              context: `Function call: ${call}`,
            },
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Analyze inheritance relationships
   */
  private async analyzeInheritanceRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];
    const language = chunk.metadata.language;
    const langConfig = this.config.languageConfig[language];

    if (!langConfig) return relationships;

    // Extract inheritance relationships
    const parentClasses = this.extractInheritance(chunk.content, langConfig);
    const implementations = this.extractImplementations(
      chunk.content,
      langConfig,
    );

    // Process inheritance
    for (const parentClass of parentClasses) {
      const targetChunks = this.findChunksByClassName(parentClass, allChunks);

      for (const targetChunk of targetChunks) {
        relationships.push({
          type: 'extends',
          targetChunkId: targetChunk.id,
          strength: 0.9,
          description: `Extends ${parentClass}`,
          direction: 'outgoing',
          metadata: {
            confidence: 0.85,
            source: 'static_analysis',
            context: `Inheritance: extends ${parentClass}`,
          },
        });
      }
    }

    // Process interface implementations
    for (const interfaceName of implementations) {
      const targetChunks = this.findChunksByInterfaceName(
        interfaceName,
        allChunks,
      );

      for (const targetChunk of targetChunks) {
        relationships.push({
          type: 'implements',
          targetChunkId: targetChunk.id,
          strength: 0.8,
          description: `Implements ${interfaceName}`,
          direction: 'outgoing',
          metadata: {
            confidence: 0.8,
            source: 'static_analysis',
            context: `Implementation: implements ${interfaceName}`,
          },
        });
      }
    }

    return relationships;
  }

  /**
   * Analyze usage pattern relationships
   */
  private async analyzeUsageRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];
    const language = chunk.metadata.language;
    const langConfig = this.config.languageConfig[language];

    if (!langConfig) return relationships;

    // Extract usage patterns
    const usages = this.extractUsagePatterns(chunk.content, langConfig);

    // Find matching chunks for each usage
    for (const usage of usages) {
      const targetChunks = this.findChunksBySymbolName(usage, allChunks);

      for (const targetChunk of targetChunks) {
        if (targetChunk.id !== chunk.id) {
          relationships.push({
            type: 'uses',
            targetChunkId: targetChunk.id,
            strength: 0.5,
            description: `Uses ${usage}`,
            direction: 'outgoing',
            metadata: {
              confidence: 0.6,
              source: 'heuristic',
              context: `Usage pattern: ${usage}`,
            },
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Analyze semantic similarity relationships
   */
  private async analyzeSemanticSimilarity(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];

    // Calculate similarity with other chunks
    for (const otherChunk of allChunks) {
      if (otherChunk.id === chunk.id) continue;

      const similarity = this.calculateSemanticSimilarity(chunk, otherChunk);

      if (similarity > this.config.maxSimilarityDistance) {
        relationships.push({
          type: 'similar_to',
          targetChunkId: otherChunk.id,
          strength: similarity,
          description: `Semantically similar (${(similarity * 100).toFixed(
            1,
          )}% similarity)`,
          direction: 'bidirectional',
          metadata: {
            confidence: similarity,
            source: 'semantic',
            context: `Semantic similarity score: ${similarity.toFixed(3)}`,
          },
        });
      }
    }

    return relationships;
  }

  /**
   * Extract import statements from code
   */
  private extractImports(
    content: string,
    langConfig: LanguageRelationshipConfig,
  ): string[] {
    const imports: string[] = [];

    langConfig.importPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        imports.push(match[1]);
      }
    });

    return [...new Set(imports)]; // Remove duplicates
  }

  /**
   * Extract function calls from code
   */
  private extractFunctionCalls(
    content: string,
    langConfig: LanguageRelationshipConfig,
  ): string[] {
    const calls: string[] = [];

    langConfig.callPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[2]) {
          calls.push(`${match[1]}.${match[2]}`); // Method call
        } else {
          calls.push(match[1]); // Function call
        }
      }
    });

    return [...new Set(calls)];
  }

  /**
   * Extract inheritance relationships from code
   */
  private extractInheritance(
    content: string,
    langConfig: LanguageRelationshipConfig,
  ): string[] {
    const parents: string[] = [];

    langConfig.inheritancePatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        parents.push(match[1]);
      }
    });

    return [...new Set(parents)];
  }

  /**
   * Extract interface implementations from code
   */
  private extractImplementations(
    content: string,
    langConfig: LanguageRelationshipConfig,
  ): string[] {
    const implementations: string[] = [];

    langConfig.implementationPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        implementations.push(match[1]);
      }
    });

    return [...new Set(implementations)];
  }

  /**
   * Extract usage patterns from code
   */
  private extractUsagePatterns(
    content: string,
    langConfig: LanguageRelationshipConfig,
  ): string[] {
    const usages: string[] = [];

    langConfig.usagePatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        usages.push(match[1]);
      }
    });

    return [...new Set(usages)];
  }

  /**
   * Find chunks by import path
   */
  private findChunksByImportPath(
    importPath: string,
    allChunks: EnhancedCodeChunk[],
    currentFilePath: string,
  ): EnhancedCodeChunk[] {
    const resolvedPath = this.resolveImportPath(importPath, currentFilePath);

    return allChunks.filter((chunk) => {
      const chunkPath = path.normalize(chunk.filePath);
      const targetPath = path.normalize(resolvedPath);

      return (
        chunkPath === targetPath ||
        chunkPath.endsWith(targetPath) ||
        targetPath.endsWith(chunkPath)
      );
    });
  }

  /**
   * Find chunks by function name
   */
  private findChunksByFunctionName(
    functionName: string,
    allChunks: EnhancedCodeChunk[],
  ): EnhancedCodeChunk[] {
    return allChunks.filter((chunk) => {
      return (
        chunk.enhancedMetadata.symbols?.includes(functionName) ||
        chunk.content.includes(`function ${functionName}`) ||
        chunk.content.includes(`def ${functionName}`) ||
        chunk.content.includes(`${functionName}(`)
      );
    });
  }

  /**
   * Find chunks by class name
   */
  private findChunksByClassName(
    className: string,
    allChunks: EnhancedCodeChunk[],
  ): EnhancedCodeChunk[] {
    return allChunks.filter((chunk) => {
      return (
        chunk.enhancedMetadata.semanticType === 'class' &&
        (chunk.enhancedMetadata.symbols?.includes(className) ||
          chunk.content.includes(`class ${className}`))
      );
    });
  }

  /**
   * Find chunks by interface name
   */
  private findChunksByInterfaceName(
    interfaceName: string,
    allChunks: EnhancedCodeChunk[],
  ): EnhancedCodeChunk[] {
    return allChunks.filter((chunk) => {
      return (
        chunk.enhancedMetadata.semanticType === 'interface' &&
        (chunk.enhancedMetadata.symbols?.includes(interfaceName) ||
          chunk.content.includes(`interface ${interfaceName}`))
      );
    });
  }

  /**
   * Find chunks by symbol name
   */
  private findChunksBySymbolName(
    symbolName: string,
    allChunks: EnhancedCodeChunk[],
  ): EnhancedCodeChunk[] {
    return allChunks.filter((chunk) => {
      return (
        chunk.enhancedMetadata.symbols?.includes(symbolName) ||
        chunk.content.includes(symbolName)
      );
    });
  }

  /**
   * Calculate semantic similarity between two chunks
   */
  private calculateSemanticSimilarity(
    chunk1: EnhancedCodeChunk,
    chunk2: EnhancedCodeChunk,
  ): number {
    // Simple similarity calculation based on multiple factors
    let similarity = 0;
    let factors = 0;

    // Semantic type similarity
    if (
      chunk1.enhancedMetadata.semanticType ===
      chunk2.enhancedMetadata.semanticType
    ) {
      similarity += 0.3;
    }
    factors++;

    // Language similarity
    if (chunk1.metadata.language === chunk2.metadata.language) {
      similarity += 0.2;
    }
    factors++;

    // Symbol overlap
    const symbols1 = new Set(chunk1.enhancedMetadata.symbols || []);
    const symbols2 = new Set(chunk2.enhancedMetadata.symbols || []);
    const symbolIntersection = new Set(
      [...symbols1].filter((x) => symbols2.has(x)),
    );
    const symbolUnion = new Set([...symbols1, ...symbols2]);

    if (symbolUnion.size > 0) {
      similarity += (symbolIntersection.size / symbolUnion.size) * 0.3;
    }
    factors++;

    // Content similarity (simple word overlap)
    const words1 = new Set(
      chunk1.content.toLowerCase().match(/\b\w+\b/g) || [],
    );
    const words2 = new Set(
      chunk2.content.toLowerCase().match(/\b\w+\b/g) || [],
    );
    const wordIntersection = new Set([...words1].filter((x) => words2.has(x)));
    const wordUnion = new Set([...words1, ...words2]);

    if (wordUnion.size > 0) {
      similarity += (wordIntersection.size / wordUnion.size) * 0.2;
    }
    factors++;

    return similarity / factors;
  }

  /**
   * Resolve import path relative to current file
   */
  private resolveImportPath(
    importPath: string,
    currentFilePath: string,
  ): string {
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      return path.resolve(path.dirname(currentFilePath), importPath);
    }

    // For absolute imports, return as-is
    return importPath;
  }

  /**
   * Build relationship graph from analysis results
   */
  private buildRelationshipGraph(
    results: ChunkAnalysisResult[],
  ): RelationshipGraph {
    const nodes = new Map<string, EnhancedCodeChunk>();
    const edges = new Map<string, ChunkRelationship[]>();
    const adjacencyList = new Map<string, string[]>();
    const reverseAdjacencyList = new Map<string, string[]>();

    // Build nodes and edges
    results.forEach((result) => {
      const chunkId = result.chunk.id;
      nodes.set(chunkId, result.chunk);
      edges.set(chunkId, result.relationships);

      // Build adjacency lists
      const outgoing: string[] = [];
      const incoming: string[] = [];

      result.relationships.forEach((rel) => {
        if (rel.direction === 'outgoing' || rel.direction === 'bidirectional') {
          outgoing.push(rel.targetChunkId);
        }
        if (rel.direction === 'incoming' || rel.direction === 'bidirectional') {
          incoming.push(rel.targetChunkId);
        }
      });

      adjacencyList.set(chunkId, outgoing);
      reverseAdjacencyList.set(chunkId, incoming);
    });

    return {
      nodes,
      edges,
      adjacencyList,
      reverseAdjacencyList,
    };
  }

  /**
   * Calculate batch analysis summary
   */
  private calculateBatchSummary(
    results: ChunkAnalysisResult[],
    totalTime: number,
  ) {
    const totalChunks = results.length;
    const totalRelationships = results.reduce(
      (sum, r) => sum + r.relationships.length,
      0,
    );
    const averageConfidence =
      results.reduce((sum, r) => sum + r.analysisMetadata.confidenceScore, 0) /
      totalChunks;

    const relationshipTypes: Record<RelationshipType, number> = {} as any;
    results.forEach((result) => {
      result.relationships.forEach((rel) => {
        relationshipTypes[rel.type] = (relationshipTypes[rel.type] || 0) + 1;
      });
    });

    return {
      totalChunks,
      totalRelationships,
      averageConfidence,
      analysisTime: totalTime,
      relationshipTypes,
    };
  }

  /**
   * Calculate average confidence for relationships
   */
  private calculateAverageConfidence(
    relationships: ChunkRelationship[],
  ): number {
    if (relationships.length === 0) return 0;

    const totalConfidence = relationships.reduce((sum, rel) => {
      return sum + (rel.metadata?.confidence || 0);
    }, 0);

    return totalConfidence / relationships.length;
  }

  /**
   * Update chunk cache for efficient lookups
   */
  private updateChunkCache(chunks: EnhancedCodeChunk[]): void {
    this.chunkCache.clear();
    chunks.forEach((chunk) => {
      this.chunkCache.set(chunk.id, chunk);
    });
  }

  /**
   * Merge configuration with defaults
   */
  private mergeConfig(
    defaultConfig: RelationshipAnalysisConfig,
    userConfig: Partial<RelationshipAnalysisConfig>,
  ): RelationshipAnalysisConfig {
    return {
      minConfidenceThreshold:
        userConfig.minConfidenceThreshold ??
        defaultConfig.minConfidenceThreshold,
      maxSimilarityDistance:
        userConfig.maxSimilarityDistance ?? defaultConfig.maxSimilarityDistance,
      enabledAnalysis: {
        ...defaultConfig.enabledAnalysis,
        ...userConfig.enabledAnalysis,
      },
      languageConfig: {
        ...defaultConfig.languageConfig,
        ...userConfig.languageConfig,
      },
    };
  }

  /**
   * Get relationship graph statistics
   */
  getGraphStatistics(graph: RelationshipGraph): {
    nodeCount: number;
    edgeCount: number;
    averageDegree: number;
    stronglyConnectedComponents: number;
    maxDepth: number;
  } {
    const nodeCount = graph.nodes.size;
    const edgeCount = Array.from(graph.edges.values()).reduce(
      (sum, edges) => sum + edges.length,
      0,
    );
    const averageDegree = nodeCount > 0 ? edgeCount / nodeCount : 0;

    // Simplified statistics - in practice, you'd implement proper graph algorithms
    return {
      nodeCount,
      edgeCount,
      averageDegree,
      stronglyConnectedComponents: 0, // Would need proper SCC algorithm
      maxDepth: 0, // Would need proper depth calculation
    };
  }
}
