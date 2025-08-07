import * as vscode from 'vscode';
import * as path from 'path';
import { CodeChunker, CodeChunk, ChunkMetadata } from './codeChunker';
import { log, logVerbose } from '../logger';
import {
  SemanticChunkingStrategy,
  HierarchicalChunkingStrategy,
  ContextAwareChunkingStrategy,
} from './chunkingStrategies';
import {
  RelationshipAnalyzer,
  QualityAnalyzer,
  ContextAnalyzer,
} from './analyzers';
import {
  EnhancedCodeChunk,
  EnhancedChunkMetadata,
  ChunkRelationship,
  QualityMetrics,
  ContextInfo,
  ChunkingStrategy,
  ChunkingStrategyOptions,
} from '../types/enhancedChunking';

// All interfaces are now imported from ../types/enhancedChunking

// Enhanced CodeChunker class
export class EnhancedCodeChunker extends CodeChunker {
  private chunkingStrategies: Map<string, ChunkingStrategy> = new Map();
  private relationshipAnalyzer: RelationshipAnalyzer;
  private qualityAnalyzer: QualityAnalyzer;
  private contextAnalyzer: ContextAnalyzer;

  constructor() {
    super();
    this.relationshipAnalyzer = new RelationshipAnalyzer();
    this.qualityAnalyzer = new QualityAnalyzer();
    this.contextAnalyzer = new ContextAnalyzer();

    // Initialize chunking strategies
    this.initializeChunkingStrategies();

    // Only log in non-test environment
    if (process.env.NODE_ENV !== 'test') {
      log(
        'EnhancedCodeChunker initialized with intelligent chunking strategies',
      );
    }
  }

  private initializeChunkingStrategies(): void {
    // Register different chunking strategies
    this.chunkingStrategies.set('semantic', new SemanticChunkingStrategy());
    this.chunkingStrategies.set(
      'hierarchical',
      new HierarchicalChunkingStrategy(),
    );
    this.chunkingStrategies.set(
      'contextAware',
      new ContextAwareChunkingStrategy(),
    );
  }

  /**
   * Enhanced chunking method that uses intelligent strategies
   */
  async chunkFileEnhanced(
    filePath: string,
    content: string,
    snapshotId: string,
    strategyName?: string,
  ): Promise<EnhancedCodeChunk[]> {
    const language = await this.detectLanguageEnhanced(filePath, content);
    logVerbose(`Enhanced chunking file ${filePath} with language ${language}`);

    // Select appropriate chunking strategy
    const strategy = this.selectChunkingStrategy(
      language,
      content,
      strategyName,
    );
    logVerbose(`Selected strategy: ${strategy.name} for ${filePath}`);

    try {
      // Use the selected strategy to create chunks
      const chunks = await strategy.chunk(content, filePath, snapshotId);
      logVerbose(`Strategy created ${chunks.length} chunks`);

      // Enhance chunks with metadata, relationships, and quality metrics
      const enhancedChunks = await this.enhanceChunks(
        chunks,
        content,
        filePath,
        snapshotId,
      );

      logVerbose(
        `Created ${enhancedChunks.length} enhanced chunks for ${filePath}`,
      );
      return enhancedChunks;
    } catch (error) {
      log(
        `Error during enhanced chunking for ${filePath}: ${error}. Falling back to basic chunking.`,
      );

      // Fallback to basic chunking and then enhance
      const basicChunks = await super.chunkFile(filePath, content, snapshotId);
      return this.convertToEnhancedChunks(
        basicChunks,
        content,
        filePath,
        snapshotId,
      );
    }
  }

  private selectChunkingStrategy(
    language: string,
    content: string,
    preferredStrategy?: string,
  ): ChunkingStrategy {
    // If a specific strategy is requested, try to use it
    if (preferredStrategy && this.chunkingStrategies.has(preferredStrategy)) {
      const strategy = this.chunkingStrategies.get(preferredStrategy)!;
      if (strategy.isApplicable(language, content)) {
        return strategy;
      }
    }

    // Find the best applicable strategy
    for (const [name, strategy] of this.chunkingStrategies) {
      if (strategy.isApplicable(language, content)) {
        logVerbose(`Selected ${name} chunking strategy for ${language}`);
        return strategy;
      }
    }

    // Default to semantic strategy
    return this.chunkingStrategies.get('semantic')!;
  }

  private async enhanceChunks(
    chunks: EnhancedCodeChunk[],
    content: string,
    filePath: string,
    snapshotId: string,
  ): Promise<EnhancedCodeChunk[]> {
    const enhancedChunks: EnhancedCodeChunk[] = [];

    // Extract file-level dependencies once
    const fileLevelDependencies = this.extractDependencies(
      content,
      chunks[0]?.enhancedMetadata.language || 'text',
    );

    for (const chunk of chunks) {
      // Combine chunk-level and file-level dependencies
      const chunkDependencies = this.extractDependencies(
        chunk.content,
        chunk.enhancedMetadata.language,
      );
      const allDependencies = [
        ...new Set([...chunkDependencies, ...fileLevelDependencies]),
      ];

      // Enhance the metadata with detection methods
      const enhancedMetadata = {
        ...chunk.enhancedMetadata,
        dependencies: allDependencies,
        securityConcerns: this.detectSecurityConcerns(
          chunk.content,
          chunk.enhancedMetadata.language,
        ),
        codeSmells: this.detectCodeSmells(
          chunk.content,
          chunk.enhancedMetadata.language,
        ),
        designPatterns: this.detectDesignPatterns(
          chunk.content,
          chunk.enhancedMetadata.language,
        ),
      };

      // Analyze relationships between chunks and preserve existing ones
      const analyzedRelationships =
        await this.relationshipAnalyzer.analyzeRelationships(
          chunk,
          chunks,
          content,
        );

      // Merge existing relationships (from chunking strategy) with analyzed relationships
      const relationships = [...chunk.relationships, ...analyzedRelationships];

      // Calculate quality metrics
      const qualityMetrics = await this.qualityAnalyzer.calculateQualityMetrics(
        chunk,
        content,
      );

      // Extract context information
      const contextInfo = await this.contextAnalyzer.extractContextInfo(
        chunk,
        content,
        filePath,
      );

      // Create enhanced chunk
      const enhancedChunk: EnhancedCodeChunk = {
        ...chunk,
        enhancedMetadata,
        relationships,
        qualityMetrics,
        contextInfo,
      };

      enhancedChunks.push(enhancedChunk);
    }

    return enhancedChunks;
  }

  private async convertToEnhancedChunks(
    basicChunks: CodeChunk[],
    content: string,
    filePath: string,
    snapshotId: string,
  ): Promise<EnhancedCodeChunk[]> {
    const enhancedChunks: EnhancedCodeChunk[] = [];

    for (const basicChunk of basicChunks) {
      const enhancedMetadata = await this.createEnhancedMetadata(
        basicChunk,
        content,
      );

      const enhancedChunk: EnhancedCodeChunk = {
        ...basicChunk,
        enhancedMetadata,
        relationships: [],
        qualityMetrics: await this.qualityAnalyzer.calculateQualityMetrics(
          basicChunk,
          content,
        ),
        contextInfo: await this.contextAnalyzer.extractContextInfo(
          basicChunk,
          content,
          filePath,
        ),
      };

      enhancedChunks.push(enhancedChunk);
    }

    // Analyze relationships after all chunks are created
    for (let i = 0; i < enhancedChunks.length; i++) {
      enhancedChunks[i].relationships =
        await this.relationshipAnalyzer.analyzeRelationships(
          enhancedChunks[i],
          enhancedChunks,
          content,
        );
    }

    return enhancedChunks;
  }

  private async createEnhancedMetadata(
    chunk: CodeChunk,
    content: string,
  ): Promise<EnhancedChunkMetadata> {
    const semanticType = this.determineSemanticType(
      chunk.content,
      chunk.metadata.language,
    );
    const complexityScore = this.calculateComplexityScore(
      chunk.content,
      chunk.metadata.language,
    );
    const maintainabilityIndex = this.calculateMaintainabilityIndex(
      chunk.content,
    );
    const dependencies = this.extractDependencies(
      chunk.content,
      chunk.metadata.language,
    );
    const designPatterns = this.detectDesignPatterns(
      chunk.content,
      chunk.metadata.language,
    );
    const codeSmells = this.detectCodeSmells(
      chunk.content,
      chunk.metadata.language,
    );
    const securityConcerns = this.detectSecurityConcerns(
      chunk.content,
      chunk.metadata.language,
    );

    return {
      ...chunk.metadata,
      semanticType,
      complexityScore,
      maintainabilityIndex,
      dependencies,
      dependents: [], // Will be populated during relationship analysis
      designPatterns,
      codeSmells,
      securityConcerns,
      linesOfCode: this.calculateLinesOfCode(chunk.content),
    };
  }

  private determineSemanticType(
    content: string,
    language: string,
  ):
    | 'function'
    | 'class'
    | 'interface'
    | 'module'
    | 'config'
    | 'test'
    | 'documentation' {
    const lowerContent = content.toLowerCase();

    // Check for test patterns
    if (
      lowerContent.includes('test') ||
      lowerContent.includes('spec') ||
      lowerContent.includes('describe') ||
      lowerContent.includes('it(')
    ) {
      return 'test';
    }

    // Check for documentation patterns
    if (
      lowerContent.includes('readme') ||
      lowerContent.includes('documentation') ||
      content.match(/^\s*\/\*\*[\s\S]*\*\//m) ||
      content.match(/^\s*#\s+/m)
    ) {
      return 'documentation';
    }

    // Check for configuration patterns
    if (
      lowerContent.includes('config') ||
      lowerContent.includes('settings') ||
      language === 'json' ||
      language === 'yaml'
    ) {
      return 'config';
    }

    // Language-specific semantic type detection
    switch (language) {
      case 'javascript':
      case 'typescript':
        if (content.includes('class ')) return 'class';
        if (content.includes('interface ')) return 'interface';
        if (content.includes('function ') || content.includes('=>'))
          return 'function';
        break;
      case 'python':
        if (content.includes('class ')) return 'class';
        if (content.includes('def ')) return 'function';
        break;
      case 'java':
        if (content.includes('class ')) return 'class';
        if (content.includes('interface ')) return 'interface';
        if (content.includes('public ') || content.includes('private '))
          return 'function';
        break;
    }

    return 'module';
  }

  private calculateComplexityScore(content: string, language: string): number {
    // Enhanced complexity calculation beyond basic cyclomatic complexity
    let complexity = 0;

    // Base cyclomatic complexity
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(
      content,
      language,
    );
    complexity += cyclomaticComplexity;

    // Nesting depth penalty
    const nestingDepth = this.calculateNestingDepth(content, language);
    complexity += nestingDepth * 0.5;

    // Length penalty
    const lines = content.split('\n').length;
    if (lines > 50) complexity += (lines - 50) * 0.1;

    return Math.round(complexity * 10) / 10;
  }

  private calculateCyclomaticComplexity(
    content: string,
    language: string,
  ): number {
    let complexityRegex: RegExp;

    switch (language) {
      case 'javascript':
      case 'typescript':
      case 'java':
      case 'c':
      case 'cpp':
      case 'csharp':
        complexityRegex = /\b(if|for|while|case|catch|&&|\|\||switch)\b/g;
        break;
      case 'python':
        complexityRegex = /\b(if|elif|for|while|except|and|or|try)\b/g;
        break;
      default:
        return 1;
    }

    const matches = content.match(complexityRegex);
    return matches ? matches.length + 1 : 1;
  }

  private calculateNestingDepth(content: string, language: string): number {
    const lines = content.split('\n');
    let maxDepth = 0;
    let currentDepth = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;

      // Count opening braces/blocks
      const openBraces = (trimmed.match(/[{(]/g) || []).length;
      const closeBraces = (trimmed.match(/[})]/g) || []).length;

      currentDepth += openBraces - closeBraces;
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    return maxDepth;
  }

  private calculateMaintainabilityIndex(content: string): number {
    // Simplified maintainability index calculation
    const lines = content.split('\n').length;
    const commentLines = content
      .split('\n')
      .filter(
        (line) =>
          line.trim().startsWith('//') ||
          line.trim().startsWith('#') ||
          line.trim().startsWith('*'),
      ).length;

    const commentRatio = lines > 0 ? commentLines / lines : 0;
    const lengthPenalty = Math.max(0, (lines - 100) * 0.01);

    // Base score of 100, reduced by complexity and length, increased by comments
    const maintainabilityIndex = 100 - lengthPenalty + commentRatio * 20;

    return Math.max(0, Math.min(100, Math.round(maintainabilityIndex)));
  }

  private extractDependencies(content: string, language: string): string[] {
    const dependencies = new Set<string>();

    switch (language) {
      case 'javascript':
      case 'typescript': {
        // Extract import statements
        const importMatches = content.match(
          /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
        );
        if (importMatches) {
          importMatches.forEach((match) => {
            const moduleMatch = match.match(/from\s+['"]([^'"]+)['"]/);
            if (moduleMatch) dependencies.add(moduleMatch[1]);
          });
        }

        // Extract require statements
        const requireMatches = content.match(
          /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        );
        if (requireMatches) {
          requireMatches.forEach((match) => {
            const moduleMatch = match.match(/['"]([^'"]+)['"]/);
            if (moduleMatch) dependencies.add(moduleMatch[1]);
          });
        }
        break;
      }

      case 'python': {
        // Extract import statements
        const pythonImports = content.match(
          /(?:from\s+(\S+)\s+import|import\s+(\S+))/g,
        );
        if (pythonImports) {
          pythonImports.forEach((match) => {
            const fromMatch = match.match(/from\s+(\S+)\s+import/);
            const importMatch = match.match(/import\s+(\S+)/);
            if (fromMatch) {
              // Handle dotted imports like datetime.datetime
              const module = fromMatch[1].split('.')[0];
              dependencies.add(module);
            }
            if (importMatch && !fromMatch) {
              // Handle direct imports like import os
              const module = importMatch[1].split('.')[0];
              dependencies.add(module);
            }
          });
        }
        break;
      }

      case 'java': {
        // Extract import statements
        const javaImports = content.match(/import\s+(?:static\s+)?([^;]+);/g);
        if (javaImports) {
          javaImports.forEach((match) => {
            const importMatch = match.match(/import\s+(?:static\s+)?([^;]+);/);
            if (importMatch) dependencies.add(importMatch[1]);
          });
        }
        break;
      }
    }

    return Array.from(dependencies);
  }

  private detectDesignPatterns(content: string, language: string): string[] {
    const patterns: string[] = [];
    const lowerContent = content.toLowerCase();

    // Common design patterns detection
    if (
      lowerContent.includes('singleton') ||
      (lowerContent.includes('instance') && lowerContent.includes('static'))
    ) {
      patterns.push('Singleton');
    }

    if (lowerContent.includes('factory') || lowerContent.includes('create')) {
      patterns.push('Factory');
    }

    if (lowerContent.includes('observer') || lowerContent.includes('notify')) {
      patterns.push('Observer');
    }

    if (
      lowerContent.includes('strategy') ||
      lowerContent.includes('algorithm')
    ) {
      patterns.push('Strategy');
    }

    if (
      lowerContent.includes('decorator') ||
      lowerContent.includes('wrapper')
    ) {
      patterns.push('Decorator');
    }

    if (lowerContent.includes('adapter') || lowerContent.includes('convert')) {
      patterns.push('Adapter');
    }

    if (lowerContent.includes('builder') || lowerContent.includes('build')) {
      patterns.push('Builder');
    }

    return patterns;
  }

  private detectCodeSmells(content: string, language: string): string[] {
    const smells: string[] = [];
    const lines = content.split('\n');

    // Long method/function
    if (lines.length > 50) {
      smells.push('Long Method');
    }

    // Too many parameters (simplified detection)
    const parameterMatches = content.match(/\([^)]{50,}\)/g);
    if (parameterMatches && parameterMatches.length > 0) {
      smells.push('Long Parameter List');
    }

    // Duplicate code (simplified detection)
    const lineGroups = new Map<string, number>();
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.length > 10) {
        lineGroups.set(trimmed, (lineGroups.get(trimmed) || 0) + 1);
      }
    });

    const duplicateLines = Array.from(lineGroups.values()).filter(
      (count) => count > 2,
    );
    if (duplicateLines.length > 0) {
      smells.push('Duplicate Code');
    }

    // Large class (for class-like structures)
    if (content.includes('class ') && lines.length > 200) {
      smells.push('Large Class');
    }

    // Dead code (simplified detection)
    if (
      content.includes('TODO') ||
      content.includes('FIXME') ||
      content.includes('HACK') ||
      content.includes('XXX')
    ) {
      smells.push('Dead Code');
    }

    return smells;
  }

  private detectSecurityConcerns(content: string, language: string): string[] {
    const concerns: string[] = [];
    const lowerContent = content.toLowerCase();

    // SQL injection risks - check for string concatenation with SQL
    const hasSqlKeywords =
      lowerContent.includes('select') ||
      lowerContent.includes('insert') ||
      lowerContent.includes('update') ||
      lowerContent.includes('delete');
    const hasConcatenation =
      content.includes('" + ') ||
      content.includes("' + ") ||
      content.includes('` + ') ||
      content.includes('+ "') ||
      content.includes("+ '") ||
      content.includes('+ `');

    if (hasSqlKeywords && hasConcatenation) {
      concerns.push('SQL Injection Risk');
    }

    // XSS risks
    if (lowerContent.includes('innerhtml') || lowerContent.includes('eval')) {
      concerns.push('XSS Risk');
    }

    // Hardcoded credentials - look for actual hardcoded values
    if (
      content.match(
        /(?:const|let|var)\s+(?:password|secret|token|key)\s*=\s*["'][^"']+["']/i,
      ) ||
      content.match(/(?:password|secret|token|key)\s*[:=]\s*["'][^"']+["']/i)
    ) {
      concerns.push('Hardcoded Credentials');
    }

    // Insecure random
    if (
      lowerContent.includes('math.random') ||
      lowerContent.includes('random.random')
    ) {
      concerns.push('Weak Random Number Generation');
    }

    // Path traversal
    if (lowerContent.includes('../') || lowerContent.includes('..\\')) {
      concerns.push('Path Traversal Risk');
    }

    return concerns;
  }

  // Enhanced language detection for strategies
  public async detectLanguageEnhanced(
    filePath: string,
    content: string,
  ): Promise<string> {
    // Enhanced language detection that considers file extension and content patterns
    const ext = path.extname(filePath).toLowerCase();
    const extensionMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.c': 'c',
      '.h': 'c',
      '.cpp': 'cpp',
      '.hpp': 'cpp',
      '.cxx': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rb': 'ruby',
      '.php': 'php',
      '.rs': 'rust',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.kts': 'kotlin',
      '.html': 'html',
      '.htm': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.json': 'json',
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.sh': 'shell',
    };

    const detectedLanguage = extensionMap[ext] || 'text';

    // For ambiguous extensions (like .h which could be C or C++),
    // perform content-based analysis
    if (ext === '.h') {
      // Check for C++ specific patterns
      if (
        content.includes('namespace') ||
        content.includes('class ') ||
        content.includes('template<') ||
        content.includes('::')
      ) {
        return 'cpp';
      }
    }

    return detectedLanguage;
  }

  private calculateLinesOfCode(
    content: string,
  ): import('../types/enhancedChunking').LinesOfCodeMetrics {
    const lines = content.split('\n');
    let code = 0;
    let comments = 0;
    let blank = 0;
    let mixed = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        blank++;
      } else if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        comments++;
      } else if (trimmed.includes('//') || trimmed.includes('#')) {
        mixed++;
      } else {
        code++;
      }
    }

    return {
      total: lines.length,
      code,
      comments,
      blank,
      mixed,
      logical: code + mixed,
    };
  }
}
