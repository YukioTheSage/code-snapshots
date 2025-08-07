import {
  EnhancedCodeChunk,
  ChunkRelationship,
  QualityMetrics,
  ContextInfo,
} from '../types/enhancedChunking';
import { CodeChunk } from './codeChunker';
import { log, logVerbose } from '../logger';
import * as path from 'path';

/**
 * Relationship Analyzer - Analyzes relationships between code chunks
 */
export class RelationshipAnalyzer {
  async analyzeRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
    fullContent: string,
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];

    // Analyze different types of relationships
    const callRelationships = await this.analyzeCallRelationships(
      chunk,
      allChunks,
    );
    const importRelationships = await this.analyzeImportRelationships(
      chunk,
      allChunks,
    );
    const inheritanceRelationships = await this.analyzeInheritanceRelationships(
      chunk,
      allChunks,
    );
    const usageRelationships = await this.analyzeUsageRelationships(
      chunk,
      allChunks,
    );
    const testRelationships = await this.analyzeTestRelationships(
      chunk,
      allChunks,
    );

    relationships.push(
      ...callRelationships,
      ...importRelationships,
      ...inheritanceRelationships,
      ...usageRelationships,
      ...testRelationships,
    );

    return relationships;
  }

  private async analyzeCallRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];
    const chunkContent = chunk.content.toLowerCase();

    for (const otherChunk of allChunks) {
      if (otherChunk.id === chunk.id) continue;

      // Check if this chunk calls functions/methods from the other chunk
      const otherSymbols = otherChunk.metadata.symbols || [];

      for (const symbol of otherSymbols) {
        const symbolPattern = new RegExp(
          `\\b${this.escapeRegex(symbol)}\\s*\\(`,
          'gi',
        );
        if (symbolPattern.test(chunk.content)) {
          relationships.push({
            type: 'calls',
            targetChunkId: otherChunk.id,
            strength: this.calculateCallStrength(chunk.content, symbol),
            description: `Calls ${symbol} from ${otherChunk.filePath}`,
            direction: 'outgoing',
            metadata: {
              confidence: 0.8,
              source: 'static_analysis',
            },
          });
        }
      }
    }

    return relationships;
  }

  private async analyzeImportRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];
    const chunkImports = chunk.metadata.imports || [];

    for (const otherChunk of allChunks) {
      if (otherChunk.id === chunk.id) continue;

      // Check if this chunk imports from the other chunk's file
      const otherFilePath = otherChunk.filePath;
      const otherFileName = path.basename(
        otherFilePath,
        path.extname(otherFilePath),
      );

      for (const importPath of chunkImports) {
        if (
          importPath.includes(otherFileName) ||
          this.isRelatedImport(importPath, otherFilePath)
        ) {
          relationships.push({
            type: 'imports',
            targetChunkId: otherChunk.id,
            strength: 0.8,
            description: `Imports from ${otherFilePath}`,
            direction: 'outgoing',
            metadata: {
              confidence: 0.8,
              source: 'static_analysis',
            },
          });
        }
      }
    }

    return relationships;
  }

  private async analyzeInheritanceRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];

    // Look for extends/implements patterns
    const extendsPattern = /(?:extends|implements)\s+([a-zA-Z_$][\w$]*)/gi;
    let match;

    while ((match = extendsPattern.exec(chunk.content)) !== null) {
      const parentClass = match[1];

      // Find chunks that define this parent class
      for (const otherChunk of allChunks) {
        if (otherChunk.id === chunk.id) continue;

        const otherSymbols = otherChunk.metadata.symbols || [];
        if (otherSymbols.includes(parentClass)) {
          relationships.push({
            type: match[0].toLowerCase().includes('extends')
              ? 'extends'
              : 'implements',
            targetChunkId: otherChunk.id,
            strength: 0.9,
            description: `${match[0]} ${parentClass} from ${otherChunk.filePath}`,
            direction: 'outgoing',
            metadata: {
              confidence: 0.9,
              source: 'static_analysis',
            },
          });
        }
      }
    }

    return relationships;
  }

  private async analyzeUsageRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];

    // Look for variable/constant usage
    for (const otherChunk of allChunks) {
      if (otherChunk.id === chunk.id) continue;

      const otherSymbols = otherChunk.metadata.symbols || [];

      for (const symbol of otherSymbols) {
        // Look for usage patterns (not function calls)
        const usagePattern = new RegExp(
          `\\b${this.escapeRegex(symbol)}(?!\\s*\\()`,
          'gi',
        );
        const matches = chunk.content.match(usagePattern);

        if (matches && matches.length > 0) {
          relationships.push({
            type: 'uses',
            targetChunkId: otherChunk.id,
            strength: Math.min(0.8, matches.length * 0.1),
            description: `Uses ${symbol} from ${otherChunk.filePath} (${matches.length} times)`,
            direction: 'outgoing',
            metadata: {
              confidence: 0.7,
              source: 'static_analysis',
            },
          });
        }
      }
    }

    return relationships;
  }

  private async analyzeTestRelationships(
    chunk: EnhancedCodeChunk,
    allChunks: EnhancedCodeChunk[],
  ): Promise<ChunkRelationship[]> {
    const relationships: ChunkRelationship[] = [];

    // Check if this is a test chunk
    const isTestChunk = this.isTestChunk(chunk);

    if (isTestChunk) {
      // Find chunks that this test is testing
      for (const otherChunk of allChunks) {
        if (otherChunk.id === chunk.id || this.isTestChunk(otherChunk))
          continue;

        const otherSymbols = otherChunk.metadata.symbols || [];

        for (const symbol of otherSymbols) {
          if (chunk.content.includes(symbol)) {
            relationships.push({
              type: 'tests',
              targetChunkId: otherChunk.id,
              strength: 0.7,
              description: `Tests ${symbol} from ${otherChunk.filePath}`,
              direction: 'outgoing',
              metadata: {
                confidence: 0.7,
                source: 'heuristic',
              },
            });
          }
        }
      }
    } else {
      // Find test chunks that test this chunk
      for (const otherChunk of allChunks) {
        if (otherChunk.id === chunk.id || !this.isTestChunk(otherChunk))
          continue;

        const chunkSymbols = chunk.metadata.symbols || [];

        for (const symbol of chunkSymbols) {
          if (otherChunk.content.includes(symbol)) {
            relationships.push({
              type: 'tests',
              targetChunkId: otherChunk.id,
              strength: 0.7,
              description: `Tested by ${otherChunk.filePath}`,
              direction: 'incoming',
              metadata: {
                confidence: 0.7,
                source: 'heuristic',
              },
            });
          }
        }
      }
    }

    return relationships;
  }

  private calculateCallStrength(content: string, symbol: string): number {
    const pattern = new RegExp(`\\b${this.escapeRegex(symbol)}\\s*\\(`, 'gi');
    const matches = content.match(pattern);
    const callCount = matches ? matches.length : 0;

    // Normalize to 0-1 scale
    return Math.min(1.0, callCount * 0.2);
  }

  private isRelatedImport(importPath: string, filePath: string): boolean {
    const importParts = importPath.split('/');
    const fileParts = filePath.split('/');

    // Check if they share common path segments
    const commonParts = importParts.filter((part) => fileParts.includes(part));
    return commonParts.length > 0;
  }

  private isTestChunk(chunk: EnhancedCodeChunk): boolean {
    const filePath = chunk.filePath.toLowerCase();
    const content = chunk.content.toLowerCase();

    return (
      filePath.includes('test') ||
      filePath.includes('spec') ||
      content.includes('describe(') ||
      content.includes('it(') ||
      content.includes('test(') ||
      content.includes('expect(')
    );
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Quality Analyzer - Calculates quality metrics for code chunks
 */
export class QualityAnalyzer {
  async calculateQualityMetrics(
    chunk: CodeChunk | EnhancedCodeChunk,
    fullContent: string,
  ): Promise<QualityMetrics> {
    const readabilityScore = this.calculateReadabilityScore(chunk.content);
    const documentationRatio = this.calculateDocumentationRatio(chunk.content);
    const duplicationRisk = await this.calculateDuplicationRisk(
      chunk,
      fullContent,
    );
    const performanceRisk = this.calculatePerformanceRisk(
      chunk.content,
      chunk.metadata.language,
    );
    const testCoverage = await this.estimateTestCoverage(chunk);

    return {
      overallScore: Math.round(
        (readabilityScore + (100 - duplicationRisk) + (100 - performanceRisk)) /
          3,
      ),
      readabilityScore,
      testCoverage,
      documentationRatio,
      duplicationRisk,
      performanceRisk,
      securityRisk: 0, // Will be calculated separately
      maintainabilityScore: Math.round(
        (readabilityScore + documentationRatio * 100) / 2,
      ),
      technicalDebt: {
        estimatedFixTime: 0,
        severity: 'low',
        categories: [],
        issues: [],
      },
    };
  }

  private calculateReadabilityScore(content: string): number {
    let score = 100;
    const lines = content.split('\n');

    // Penalize long lines
    const longLines = lines.filter((line) => line.length > 120).length;
    score -= longLines * 5;

    // Penalize very long methods/functions
    if (lines.length > 50) {
      score -= (lines.length - 50) * 0.5;
    }

    // Reward good naming (camelCase, descriptive names)
    const goodNamingPattern = /[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*/g;
    const goodNames = content.match(goodNamingPattern);
    if (goodNames) {
      score += Math.min(10, goodNames.length * 0.5);
    }

    // Penalize excessive nesting
    const maxIndentation = Math.max(
      ...lines.map((line) => line.length - line.trimStart().length),
    );
    if (maxIndentation > 16) {
      score -= (maxIndentation - 16) * 2;
    }

    // Penalize magic numbers
    const magicNumbers = content.match(/\b\d{2,}\b/g);
    if (magicNumbers) {
      score -= magicNumbers.length * 2;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private calculateDocumentationRatio(content: string): number {
    const lines = content.split('\n');
    const totalLines = lines.filter((line) => line.trim().length > 0).length;

    if (totalLines === 0) return 0;

    const documentationLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/**') ||
        trimmed.startsWith('"""') ||
        trimmed.startsWith("'''")
      );
    }).length;

    return documentationLines / totalLines;
  }

  private async calculateDuplicationRisk(
    chunk: CodeChunk | EnhancedCodeChunk,
    fullContent: string,
  ): Promise<number> {
    const chunkLines = chunk.content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 10); // Only consider substantial lines

    if (chunkLines.length === 0) return 0;

    let duplicateCount = 0;
    const otherContent = fullContent.replace(chunk.content, ''); // Remove current chunk

    for (const line of chunkLines) {
      if (line.length > 20) {
        // Only check substantial lines
        const occurrences = (
          otherContent.match(new RegExp(this.escapeRegex(line), 'g')) || []
        ).length;
        if (occurrences > 0) {
          duplicateCount++;
        }
      }
    }

    return duplicateCount / chunkLines.length;
  }

  private calculatePerformanceRisk(content: string, language: string): number {
    let risk = 0;
    const lowerContent = content.toLowerCase();

    // Language-specific performance anti-patterns
    switch (language) {
      case 'javascript':
      case 'typescript':
        // Synchronous operations that could block
        if (
          lowerContent.includes('fs.readfilesync') ||
          lowerContent.includes('fs.writefilesync')
        ) {
          risk += 0.3;
        }

        // Inefficient DOM operations
        if (
          lowerContent.includes('getelementbyid') &&
          content.split('getElementById').length > 3
        ) {
          risk += 0.2;
        }

        // Memory leaks
        if (
          lowerContent.includes('setinterval') &&
          !lowerContent.includes('clearinterval')
        ) {
          risk += 0.4;
        }
        break;

      case 'python':
        // Inefficient list operations
        if (
          lowerContent.includes('for') &&
          lowerContent.includes('append') &&
          lowerContent.includes('range')
        ) {
          risk += 0.2;
        }

        // Global variable usage
        if (lowerContent.includes('global ')) {
          risk += 0.3;
        }
        break;

      case 'java':
        // String concatenation in loops
        if (
          lowerContent.includes('for') &&
          lowerContent.includes('+') &&
          lowerContent.includes('string')
        ) {
          risk += 0.3;
        }

        // Inefficient collections usage
        if (
          lowerContent.includes('vector') ||
          lowerContent.includes('hashtable')
        ) {
          risk += 0.2;
        }
        break;
    }

    // General performance risks

    // Nested loops
    const nestedLoopPattern = /for\s*\([^}]*for\s*\(/gi;
    const nestedLoops = content.match(nestedLoopPattern);
    if (nestedLoops) {
      risk += nestedLoops.length * 0.3;
    }

    // Database queries in loops
    if (
      (lowerContent.includes('for') || lowerContent.includes('while')) &&
      (lowerContent.includes('query') ||
        lowerContent.includes('select') ||
        lowerContent.includes('insert') ||
        lowerContent.includes('update'))
    ) {
      risk += 0.5;
    }

    // Large data structures
    if (lowerContent.includes('array') && content.match(/\d{4,}/)) {
      risk += 0.2;
    }

    return Math.min(1.0, risk);
  }

  private async estimateTestCoverage(
    chunk: CodeChunk | EnhancedCodeChunk,
  ): Promise<number | undefined> {
    // This is a simplified estimation - in practice, you'd integrate with coverage tools
    const symbols = chunk.metadata.symbols || [];

    if (symbols.length === 0) return undefined;

    // Check if chunk appears to be a test file
    const isTestFile =
      chunk.filePath.toLowerCase().includes('test') ||
      chunk.filePath.toLowerCase().includes('spec') ||
      chunk.content.toLowerCase().includes('describe(') ||
      chunk.content.toLowerCase().includes('it(');

    if (isTestFile) {
      return 1.0; // Test files have 100% "coverage" by definition
    }

    // Estimate based on presence of test-like patterns
    const testPatterns = [
      'test(',
      'it(',
      'describe(',
      'expect(',
      'assert',
      'should',
    ];

    let testIndicators = 0;
    for (const pattern of testPatterns) {
      if (chunk.content.toLowerCase().includes(pattern)) {
        testIndicators++;
      }
    }

    // Very rough estimation
    return testIndicators > 0 ? Math.min(1.0, testIndicators * 0.2) : 0;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Context Analyzer - Extracts contextual information about code chunks
 */
export class ContextAnalyzer {
  async extractContextInfo(
    chunk: CodeChunk | EnhancedCodeChunk,
    fullContent: string,
    filePath: string,
  ): Promise<ContextInfo> {
    const surroundingContext = this.extractSurroundingContext(
      chunk,
      fullContent,
    );
    const architecturalLayer = this.determineArchitecturalLayer(
      chunk,
      filePath,
    );
    const frameworkContext = this.detectFrameworkContext(chunk.content);
    const businessContext = this.inferBusinessContext(chunk.content, filePath);

    return {
      surroundingContext,
      architecturalLayer,
      frameworkContext,
      businessContext,
      fileContext: {
        totalLines: chunk.content.split('\n').length,
        fileSize: chunk.content.length,
        lastModified: new Date(),
        siblingChunks: [],
      },
    };
  }

  private extractSurroundingContext(
    chunk: CodeChunk | EnhancedCodeChunk,
    fullContent: string,
  ): string {
    const lines = fullContent.split('\n');
    const contextRadius = 5;

    const beforeStart = Math.max(0, chunk.startLine - contextRadius);
    const afterEnd = Math.min(lines.length - 1, chunk.endLine + contextRadius);

    const beforeContext = lines.slice(beforeStart, chunk.startLine);
    const afterContext = lines.slice(chunk.endLine + 1, afterEnd + 1);

    const contextParts: string[] = [];

    if (beforeContext.length > 0) {
      contextParts.push('Before:', ...beforeContext.slice(-3)); // Last 3 lines before
    }

    if (afterContext.length > 0) {
      contextParts.push('After:', ...afterContext.slice(0, 3)); // First 3 lines after
    }

    return contextParts.join('\n');
  }

  private determineArchitecturalLayer(
    chunk: CodeChunk | EnhancedCodeChunk,
    filePath: string,
  ): import('../types/enhancedChunking').ArchitecturalLayer {
    const lowerPath = filePath.toLowerCase();
    const lowerContent = chunk.content.toLowerCase();

    // Check file path patterns
    if (
      lowerPath.includes('controller') ||
      lowerPath.includes('handler') ||
      lowerPath.includes('route') ||
      lowerPath.includes('api')
    ) {
      return 'presentation';
    }

    if (
      lowerPath.includes('service') ||
      lowerPath.includes('business') ||
      lowerPath.includes('logic') ||
      lowerPath.includes('manager')
    ) {
      return 'business';
    }

    if (
      lowerPath.includes('repository') ||
      lowerPath.includes('dao') ||
      lowerPath.includes('model') ||
      lowerPath.includes('entity') ||
      lowerPath.includes('database') ||
      lowerPath.includes('persistence')
    ) {
      return 'data';
    }

    if (
      lowerPath.includes('util') ||
      lowerPath.includes('helper') ||
      lowerPath.includes('common') ||
      lowerPath.includes('shared')
    ) {
      return 'infrastructure';
    }

    if (lowerPath.includes('config') || lowerPath.includes('setting')) {
      return 'configuration';
    }

    // Check content patterns
    if (
      lowerContent.includes('http') ||
      lowerContent.includes('request') ||
      lowerContent.includes('response') ||
      lowerContent.includes('router')
    ) {
      return 'presentation';
    }

    if (
      lowerContent.includes('database') ||
      lowerContent.includes('query') ||
      lowerContent.includes('select') ||
      lowerContent.includes('insert') ||
      lowerContent.includes('update') ||
      lowerContent.includes('delete')
    ) {
      return 'data';
    }

    // Default to business layer
    return 'business';
  }

  private detectFrameworkContext(content: string): string[] {
    const frameworks: string[] = [];
    const lowerContent = content.toLowerCase();

    // JavaScript/TypeScript frameworks
    if (
      content.includes('React') ||
      content.includes('jsx') ||
      content.includes('useState') ||
      content.includes('useEffect')
    ) {
      frameworks.push('React');
    }

    if (
      content.includes('Vue') ||
      content.includes('v-') ||
      lowerContent.includes('vue')
    ) {
      frameworks.push('Vue.js');
    }

    if (
      content.includes('Angular') ||
      content.includes('@Component') ||
      content.includes('@Injectable')
    ) {
      frameworks.push('Angular');
    }

    if (
      content.includes('express') ||
      content.includes('app.get') ||
      content.includes('app.post')
    ) {
      frameworks.push('Express.js');
    }

    if (content.includes('fastify') || content.includes('fastify.register')) {
      frameworks.push('Fastify');
    }

    // Python frameworks
    if (
      lowerContent.includes('django') ||
      content.includes('models.Model') ||
      content.includes('HttpResponse')
    ) {
      frameworks.push('Django');
    }

    if (
      lowerContent.includes('flask') ||
      content.includes('@app.route') ||
      content.includes('Flask(')
    ) {
      frameworks.push('Flask');
    }

    if (
      lowerContent.includes('fastapi') ||
      content.includes('@app.get') ||
      content.includes('FastAPI(')
    ) {
      frameworks.push('FastAPI');
    }

    // Java frameworks
    if (
      content.includes('@SpringBootApplication') ||
      content.includes('@RestController') ||
      content.includes('@Service') ||
      content.includes('@Repository')
    ) {
      frameworks.push('Spring Boot');
    }

    if (
      content.includes('@Entity') ||
      content.includes('@Table') ||
      content.includes('JpaRepository')
    ) {
      frameworks.push('JPA/Hibernate');
    }

    // Database frameworks
    if (lowerContent.includes('mongoose') || content.includes('Schema(')) {
      frameworks.push('Mongoose');
    }

    if (lowerContent.includes('sequelize') || content.includes('Sequelize')) {
      frameworks.push('Sequelize');
    }

    if (lowerContent.includes('prisma') || content.includes('@prisma')) {
      frameworks.push('Prisma');
    }

    // Testing frameworks
    if (
      lowerContent.includes('jest') ||
      content.includes('describe(') ||
      content.includes('it(') ||
      content.includes('expect(')
    ) {
      frameworks.push('Jest');
    }

    if (lowerContent.includes('mocha') || lowerContent.includes('chai')) {
      frameworks.push('Mocha/Chai');
    }

    if (lowerContent.includes('pytest') || content.includes('@pytest')) {
      frameworks.push('PyTest');
    }

    return frameworks;
  }

  private inferBusinessContext(
    content: string,
    filePath: string,
  ): string | undefined {
    const lowerContent = content.toLowerCase();
    const lowerPath = filePath.toLowerCase();

    // E-commerce contexts
    if (
      this.containsAny(lowerContent, [
        'order',
        'cart',
        'checkout',
        'payment',
        'product',
        'inventory',
      ]) ||
      this.containsAny(lowerPath, [
        'order',
        'cart',
        'checkout',
        'payment',
        'product',
        'inventory',
      ])
    ) {
      return 'E-commerce';
    }

    // User management contexts
    if (
      this.containsAny(lowerContent, [
        'user',
        'auth',
        'login',
        'register',
        'profile',
        'account',
      ]) ||
      this.containsAny(lowerPath, [
        'user',
        'auth',
        'login',
        'register',
        'profile',
        'account',
      ])
    ) {
      return 'User Management';
    }

    // Financial contexts
    if (
      this.containsAny(lowerContent, [
        'transaction',
        'billing',
        'invoice',
        'payment',
        'finance',
        'accounting',
      ]) ||
      this.containsAny(lowerPath, [
        'transaction',
        'billing',
        'invoice',
        'payment',
        'finance',
        'accounting',
      ])
    ) {
      return 'Financial Services';
    }

    // Content management contexts
    if (
      this.containsAny(lowerContent, [
        'content',
        'article',
        'blog',
        'post',
        'media',
        'upload',
      ]) ||
      this.containsAny(lowerPath, [
        'content',
        'article',
        'blog',
        'post',
        'media',
        'upload',
      ])
    ) {
      return 'Content Management';
    }

    // Analytics contexts
    if (
      this.containsAny(lowerContent, [
        'analytics',
        'report',
        'dashboard',
        'metric',
        'tracking',
        'statistics',
      ]) ||
      this.containsAny(lowerPath, [
        'analytics',
        'report',
        'dashboard',
        'metric',
        'tracking',
        'statistics',
      ])
    ) {
      return 'Analytics & Reporting';
    }

    // Communication contexts
    if (
      this.containsAny(lowerContent, [
        'message',
        'chat',
        'notification',
        'email',
        'sms',
        'communication',
      ]) ||
      this.containsAny(lowerPath, [
        'message',
        'chat',
        'notification',
        'email',
        'sms',
        'communication',
      ])
    ) {
      return 'Communication';
    }

    return undefined;
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
  }
}
