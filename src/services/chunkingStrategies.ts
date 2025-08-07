import {
  ChunkingStrategy,
  EnhancedCodeChunk,
  EnhancedChunkMetadata,
  ChunkRelationship,
} from '../types/enhancedChunking';
import { log, logVerbose } from '../logger';
import * as path from 'path';

/**
 * Semantic Chunking Strategy - Respects language-specific semantic boundaries
 *
 * This strategy creates chunks that preserve complete semantic units like functions,
 * classes, and logical code blocks. It adapts chunk sizing based on code complexity
 * and maintains semantic coherence across different programming languages.
 */
export class SemanticChunkingStrategy implements ChunkingStrategy {
  name = 'semantic';
  description =
    'Chunks code based on semantic boundaries like functions, classes, and modules with context-aware sizing';

  private readonly maxChunkSize = 200; // Maximum lines per chunk
  private readonly minChunkSize = 10; // Minimum lines per chunk
  private readonly complexityThreshold = 15; // Complexity threshold for chunk splitting

  isApplicable(language: string, content: string): boolean {
    // Applicable to most programming languages with clear semantic structures
    const supportedLanguages = [
      'javascript',
      'typescript',
      'python',
      'java',
      'c',
      'cpp',
      'csharp',
      'go',
      'rust',
      'php',
      'ruby',
      'swift',
      'kotlin',
      'scala',
    ];

    // Check if content has semantic structures worth preserving
    const hasSemanticStructures = this.hasSemanticStructures(content, language);

    return supportedLanguages.includes(language) && hasSemanticStructures;
  }

  async chunk(
    content: string,
    filePath: string,
    snapshotId: string,
  ): Promise<EnhancedCodeChunk[]> {
    const language = this.detectLanguage(filePath);
    logVerbose(`Starting semantic chunking for ${filePath} (${language})`);

    const semanticNodes = await this.parseSemanticNodes(content, language);

    if (semanticNodes.length === 0) {
      log(
        `No semantic nodes found in ${filePath}, falling back to simple chunking`,
      );
      return this.createFallbackChunks(content, filePath, snapshotId, language);
    }

    // Apply context-aware chunk sizing
    const optimizedNodes = this.optimizeChunkSizing(
      semanticNodes,
      content,
      language,
    );

    return this.createSemanticChunks(
      content,
      filePath,
      snapshotId,
      language,
      optimizedNodes,
    );
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const extensionMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.rb': 'ruby',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
    };
    return extensionMap[ext] || 'text';
  }

  /**
   * Check if content has semantic structures worth preserving
   */
  private hasSemanticStructures(content: string, language: string): boolean {
    const lines = content.split('\n');

    // Check for common semantic patterns based on language
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.hasJavaScriptSemanticStructures(lines);
      case 'python':
        return this.hasPythonSemanticStructures(lines);
      case 'java':
      case 'csharp':
        return this.hasJavaSemanticStructures(lines);
      default:
        return this.hasGenericSemanticStructures(lines);
    }
  }

  private hasJavaScriptSemanticStructures(lines: string[]): boolean {
    const semanticPatterns = [
      /(?:export\s+)?(?:async\s+)?function\s+[a-zA-Z_$][\w$]*/,
      /(?:const|let|var)\s+[a-zA-Z_$][\w$]*\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
      /(?:export\s+)?class\s+[a-zA-Z_$][\w$]*/,
      /(?:export\s+)?interface\s+[a-zA-Z_$][\w$]*/,
      /(?:export\s+)?type\s+[a-zA-Z_$][\w$]*/,
      /(?:export\s+)?enum\s+[a-zA-Z_$][\w$]*/,
    ];

    return lines.some((line) =>
      semanticPatterns.some((pattern) => pattern.test(line)),
    );
  }

  private hasPythonSemanticStructures(lines: string[]): boolean {
    const semanticPatterns = [
      /^\s*(?:async\s+)?def\s+[a-zA-Z_]\w*/,
      /^\s*class\s+[a-zA-Z_]\w*/,
      /^\s*@\w+/, // Decorators
    ];

    return lines.some((line) =>
      semanticPatterns.some((pattern) => pattern.test(line)),
    );
  }

  private hasJavaSemanticStructures(lines: string[]): boolean {
    const semanticPatterns = [
      /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+[a-zA-Z_]\w*/,
      /(?:public|private|protected)?\s*interface\s+[a-zA-Z_]\w*/,
      /(?:public|private|protected)?\s*(?:static)?\s*(?:\w+\s+)?[a-zA-Z_]\w*\s*\([^)]*\)/,
      /@\w+/, // Annotations
    ];

    return lines.some((line) =>
      semanticPatterns.some((pattern) => pattern.test(line)),
    );
  }

  private hasGenericSemanticStructures(lines: string[]): boolean {
    // Generic check for any structured code
    const structureIndicators = [
      /\{.*\}/, // Braces
      /^\s*\/\*\*/, // Documentation comments
      /^\s*#.*/, // Comments or directives
      /^\s*import\s+/, // Import statements
      /^\s*from\s+.*import/, // From imports
    ];

    const structuredLines = lines.filter((line) =>
      structureIndicators.some((pattern) => pattern.test(line)),
    ).length;

    return structuredLines > lines.length * 0.1; // At least 10% structured content
  }

  private optimizeChunkSizing(
    nodes: SemanticNode[],
    content: string,
    language: string,
  ): SemanticNode[] {
    const optimizedNodes: SemanticNode[] = [];

    for (const node of nodes) {
      const nodeSize = node.endLine - node.startLine + 1;
      const complexity = this.calculateNodeComplexity(node.content);

      // If node is too large or too complex, try to split it
      if (
        nodeSize > this.maxChunkSize ||
        complexity > this.complexityThreshold
      ) {
        const splitNodes = this.splitLargeNode(node, content, language);
        optimizedNodes.push(...splitNodes);
      }
      // If node is too small, keep as-is for now
      else {
        optimizedNodes.push(node);
      }
    }

    return optimizedNodes;
  }

  private splitLargeNode(
    node: SemanticNode,
    content: string,
    language: string,
  ): SemanticNode[] {
    const lines = content.split('\n');
    const nodeLines = lines.slice(node.startLine, node.endLine + 1);

    // Try to find natural split points within the node
    const splitPoints = this.findSplitPoints(
      nodeLines,
      language,
      node.startLine,
    );

    if (splitPoints.length === 0) {
      return [node];
    }

    const splitNodes: SemanticNode[] = [];
    let currentStart = node.startLine;

    for (const splitPoint of splitPoints) {
      if (splitPoint > currentStart) {
        const splitNode: SemanticNode = {
          type: node.type,
          name: `${node.name}_part_${splitNodes.length + 1}`,
          startLine: currentStart,
          endLine: splitPoint - 1,
          content: lines.slice(currentStart, splitPoint).join('\n'),
        };
        splitNodes.push(splitNode);
        currentStart = splitPoint;
      }
    }

    // Add the final part
    if (currentStart <= node.endLine) {
      const finalNode: SemanticNode = {
        type: node.type,
        name: `${node.name}_part_${splitNodes.length + 1}`,
        startLine: currentStart,
        endLine: node.endLine,
        content: lines.slice(currentStart, node.endLine + 1).join('\n'),
      };
      splitNodes.push(finalNode);
    }

    return splitNodes.length > 1 ? splitNodes : [node];
  }

  private findSplitPoints(
    nodeLines: string[],
    language: string,
    startLineOffset: number,
  ): number[] {
    const splitPoints: number[] = [];

    for (let i = 0; i < nodeLines.length; i++) {
      const line = nodeLines[i].trim();

      // Look for natural boundaries
      if (this.isNaturalBoundary(line, language)) {
        const absoluteLineNumber = startLineOffset + i;
        splitPoints.push(absoluteLineNumber);
      }
    }

    // Filter split points to ensure reasonable chunk sizes
    return splitPoints.filter((point, index) => {
      const prevPoint = index === 0 ? startLineOffset : splitPoints[index - 1];
      const distance = point - prevPoint;
      return distance >= this.minChunkSize && distance <= this.maxChunkSize;
    });
  }

  private isNaturalBoundary(line: string, language: string): boolean {
    // Empty lines or comments can be good split points
    if (
      !line ||
      line.startsWith('//') ||
      line.startsWith('#') ||
      line.startsWith('/*')
    ) {
      return true;
    }

    // Language-specific boundaries
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.isJavaScriptBoundary(line);
      case 'python':
        return this.isPythonBoundary(line);
      case 'java':
      case 'csharp':
        return this.isJavaBoundary(line);
      default:
        return false;
    }
  }

  private isJavaScriptBoundary(line: string): boolean {
    return (
      line.includes('// ---') || // Comment separators
      line.includes('/* ---') ||
      line.match(/^\s*\/\*\*/) !== null || // JSDoc comments
      line.match(/^\s*export\s+/) !== null || // Export statements
      line.match(/^\s*import\s+/) !== null // Import statements
    );
  }

  private isPythonBoundary(line: string): boolean {
    return (
      line.includes('# ---') || // Comment separators
      line.includes('"""') || // Docstrings
      line.includes("'''") ||
      line.match(/^\s*from\s+/) !== null || // Import statements
      line.match(/^\s*import\s+/) !== null
    );
  }

  private isJavaBoundary(line: string): boolean {
    return (
      line.includes('// ---') || // Comment separators
      line.includes('/* ---') ||
      line.match(/^\s*\/\*\*/) !== null || // Javadoc comments
      line.match(/^\s*import\s+/) !== null || // Import statements
      line.match(/^\s*package\s+/) !== null // Package statements
    );
  }

  private async parseSemanticNodes(
    content: string,
    language: string,
  ): Promise<SemanticNode[]> {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.parseJavaScriptNodes(
          content.split('\n'),
          language === 'typescript',
        );
      case 'python':
        return this.parsePythonNodes(content.split('\n'));
      case 'java':
        return this.parseJavaNodes(content.split('\n'));
      default:
        return this.parseGenericNodes(content.split('\n'));
    }
  }

  private parseJavaScriptNodes(
    lines: string[],
    isTypeScript: boolean,
  ): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    let currentFunction: SemanticNode | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      // Track brace depth
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      // Function declarations
      const functionMatch = line.match(
        /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/,
      );
      if (functionMatch) {
        if (currentFunction) {
          currentFunction.endLine = i - 1;
          currentFunction.content = lines
            .slice(currentFunction.startLine, i)
            .join('\n');
          nodes.push(currentFunction);
        }
        currentFunction = {
          type: 'function',
          name: functionMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      // Arrow functions
      const arrowMatch = line.match(
        /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
      );
      if (arrowMatch) {
        if (currentFunction) {
          currentFunction.endLine = i - 1;
          currentFunction.content = lines
            .slice(currentFunction.startLine, i)
            .join('\n');
          nodes.push(currentFunction);
        }
        currentFunction = {
          type: 'function',
          name: arrowMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      // Class declarations
      const classMatch = line.match(/(?:export\s+)?class\s+([a-zA-Z_$][\w$]*)/);
      if (classMatch) {
        if (currentFunction) {
          currentFunction.endLine = i - 1;
          currentFunction.content = lines
            .slice(currentFunction.startLine, i)
            .join('\n');
          nodes.push(currentFunction);
        }
        currentFunction = {
          type: 'class',
          name: classMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      // TypeScript specific
      if (isTypeScript) {
        const interfaceMatch = line.match(
          /(?:export\s+)?interface\s+([a-zA-Z_$][\w$]*)/,
        );
        if (interfaceMatch) {
          if (currentFunction) {
            currentFunction.endLine = i - 1;
            currentFunction.content = lines
              .slice(currentFunction.startLine, i)
              .join('\n');
            nodes.push(currentFunction);
          }
          currentFunction = {
            type: 'interface',
            name: interfaceMatch[1],
            startLine: i,
            endLine: i,
            content: '',
          };
        }
      }

      // End of function/class when braces balance
      if (currentFunction && braceDepth === 0 && line.includes('}')) {
        currentFunction.endLine = i;
        currentFunction.content = lines
          .slice(currentFunction.startLine, i + 1)
          .join('\n');
        nodes.push(currentFunction);
        currentFunction = null;
      }
    }

    // Handle any remaining function
    if (currentFunction) {
      currentFunction.endLine = lines.length - 1;
      currentFunction.content = lines
        .slice(currentFunction.startLine)
        .join('\n');
      nodes.push(currentFunction);
    }

    return nodes;
  }

  private parsePythonNodes(lines: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    let currentNode: SemanticNode | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.length - line.trimStart().length;

      // Function definition
      const funcMatch = line.match(/^(\s*)(?:async\s+)?def\s+([a-zA-Z_]\w*)/);
      if (funcMatch) {
        if (currentNode) {
          currentNode.endLine = i - 1;
          currentNode.content = lines
            .slice(currentNode.startLine, i)
            .join('\n');
          nodes.push(currentNode);
        }
        currentNode = {
          type: 'function',
          name: funcMatch[2],
          startLine: i,
          endLine: i,
          content: '',
          indent: funcMatch[1].length,
        };
      }

      // Class definition
      const classMatch = line.match(/^(\s*)class\s+([a-zA-Z_]\w*)/);
      if (classMatch) {
        if (currentNode) {
          currentNode.endLine = i - 1;
          currentNode.content = lines
            .slice(currentNode.startLine, i)
            .join('\n');
          nodes.push(currentNode);
        }
        currentNode = {
          type: 'class',
          name: classMatch[2],
          startLine: i,
          endLine: i,
          content: '',
          indent: classMatch[1].length,
        };
      }

      // Check if we've moved to a different indentation level (end of current block)
      if (
        currentNode &&
        indent <= (currentNode.indent || 0) &&
        trimmed &&
        !line.match(/^(\s*)(?:def|class)/)
      ) {
        currentNode.endLine = i - 1;
        currentNode.content = lines.slice(currentNode.startLine, i).join('\n');
        nodes.push(currentNode);
        currentNode = null;
      }
    }

    // Handle any remaining node
    if (currentNode) {
      currentNode.endLine = lines.length - 1;
      currentNode.content = lines.slice(currentNode.startLine).join('\n');
      nodes.push(currentNode);
    }

    return nodes;
  }

  private parseJavaNodes(lines: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    let currentNode: SemanticNode | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      // Track brace depth
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      // Class declaration
      const classMatch = line.match(
        /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+([a-zA-Z_]\w*)/,
      );
      if (classMatch) {
        if (currentNode) {
          currentNode.endLine = i - 1;
          currentNode.content = lines
            .slice(currentNode.startLine, i)
            .join('\n');
          nodes.push(currentNode);
        }
        currentNode = {
          type: 'class',
          name: classMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      // End of class
      if (currentNode && braceDepth === 0 && line.includes('}')) {
        currentNode.endLine = i;
        currentNode.content = lines
          .slice(currentNode.startLine, i + 1)
          .join('\n');
        nodes.push(currentNode);
        currentNode = null;
      }
    }

    return nodes;
  }

  private parseGenericNodes(lines: string[]): SemanticNode[] {
    // Generic parsing for unsupported languages
    const nodes: SemanticNode[] = [];
    const chunkSize = 50; // Default chunk size for generic parsing

    for (let i = 0; i < lines.length; i += chunkSize) {
      const endLine = Math.min(i + chunkSize - 1, lines.length - 1);
      const content = lines.slice(i, endLine + 1).join('\n');

      nodes.push({
        type: 'block',
        name: `block_${i}`,
        startLine: i,
        endLine: endLine,
        content: content,
      });
    }

    return nodes;
  }

  private createSemanticChunks(
    content: string,
    filePath: string,
    snapshotId: string,
    language: string,
    nodes: SemanticNode[],
  ): EnhancedCodeChunk[] {
    const chunks: EnhancedCodeChunk[] = [];
    const lines = content.split('\n');

    for (const node of nodes) {
      const chunkContent =
        node.content ||
        lines.slice(node.startLine, node.endLine + 1).join('\n');

      const enhancedMetadata: EnhancedChunkMetadata = {
        language,
        symbols: [node.name],
        semanticType: this.mapNodeTypeToSemanticType(node.type),
        complexityScore: this.calculateNodeComplexity(chunkContent),
        maintainabilityIndex: this.calculateMaintainability(chunkContent),
        dependencies: this.extractNodeDependencies(chunkContent, language),
        dependents: [],
        designPatterns: [],
        codeSmells: [],
        securityConcerns: [],
        linesOfCode: this.calculateLinesOfCode(chunkContent),
      };

      const chunk: EnhancedCodeChunk = {
        id: `${snapshotId}_${path.basename(filePath)}_${node.startLine}-${
          node.endLine
        }`.replace(/[^a-zA-Z0-9_.-]/g, '_'),
        content: chunkContent,
        filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        snapshotId,
        metadata: {
          language,
          symbols: [node.name],
        },
        enhancedMetadata,
        relationships: [],
        qualityMetrics: {
          overallScore: 75,
          readabilityScore: this.calculateReadability(chunkContent),
          documentationRatio: this.calculateDocumentationRatio(chunkContent),
          duplicationRisk: 0,
          performanceRisk: 0,
          securityRisk: 0,
          maintainabilityScore: this.calculateMaintainability(chunkContent),
          technicalDebt: {
            estimatedFixTime: 0,
            severity: 'low',
            categories: [],
            issues: [],
          },
        },
        contextInfo: {
          surroundingContext: this.extractSurroundingContext(
            lines,
            node.startLine,
            node.endLine,
          ),
          architecturalLayer: 'business', // Default, will be refined later
          frameworkContext: [],
          businessContext: undefined,
          fileContext: {
            totalLines: lines.length,
            fileSize: content.length,
            lastModified: new Date(),
            siblingChunks: [],
          },
        },
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  private createFallbackChunks(
    content: string,
    filePath: string,
    snapshotId: string,
    language: string,
  ): EnhancedCodeChunk[] {
    const lines = content.split('\n');
    const chunks: EnhancedCodeChunk[] = [];
    const chunkSize = 50;

    for (let i = 0; i < lines.length; i += chunkSize) {
      const startLine = i;
      const endLine = Math.min(i + chunkSize - 1, lines.length - 1);
      const chunkContent = lines.slice(startLine, endLine + 1).join('\n');

      const enhancedMetadata: EnhancedChunkMetadata = {
        language,
        semanticType: 'module',
        complexityScore: 1,
        maintainabilityIndex: 50,
        dependencies: [],
        dependents: [],
        designPatterns: [],
        codeSmells: [],
        securityConcerns: [],
        linesOfCode: this.calculateLinesOfCode(chunkContent),
      };

      const chunk: EnhancedCodeChunk = {
        id: `${snapshotId}_${path.basename(
          filePath,
        )}_${startLine}-${endLine}`.replace(/[^a-zA-Z0-9_.-]/g, '_'),
        content: chunkContent,
        filePath,
        startLine,
        endLine,
        snapshotId,
        metadata: { language },
        enhancedMetadata,
        relationships: [],
        qualityMetrics: {
          overallScore: 50,
          readabilityScore: 50,
          documentationRatio: 0,
          duplicationRisk: 0,
          performanceRisk: 0,
          securityRisk: 0,
          maintainabilityScore: 50,
          technicalDebt: {
            estimatedFixTime: 0,
            severity: 'low',
            categories: [],
            issues: [],
          },
        },
        contextInfo: {
          surroundingContext: '',
          architecturalLayer: 'business',
          frameworkContext: [],
          businessContext: undefined,
          fileContext: {
            totalLines: lines.length,
            fileSize: content.length,
            lastModified: new Date(),
            siblingChunks: [],
          },
        },
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  private mapNodeTypeToSemanticType(
    nodeType: string,
  ):
    | 'function'
    | 'class'
    | 'interface'
    | 'module'
    | 'config'
    | 'test'
    | 'documentation' {
    switch (nodeType) {
      case 'function':
      case 'method':
        return 'function';
      case 'class':
        return 'class';
      case 'interface':
        return 'interface';
      default:
        return 'module';
    }
  }

  private calculateNodeComplexity(content: string): number {
    const complexityPatterns = /\b(if|for|while|switch|case|catch|&&|\|\|)\b/g;
    const matches = content.match(complexityPatterns);
    return matches ? matches.length + 1 : 1;
  }

  private calculateMaintainability(content: string): number {
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
    return Math.max(0, Math.min(100, 100 - lines * 0.1 + commentRatio * 20));
  }

  private calculateReadability(content: string): number {
    const lines = content.split('\n');
    const avgLineLength =
      lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
    const longLines = lines.filter((line) => line.length > 120).length;

    let score = 100;
    score -= avgLineLength > 80 ? (avgLineLength - 80) * 0.5 : 0;
    score -= longLines * 5;

    return Math.max(0, Math.min(100, score));
  }

  private calculateDocumentationRatio(content: string): number {
    const lines = content.split('\n');
    const docLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/**')
      );
    }).length;

    return lines.length > 0 ? docLines / lines.length : 0;
  }

  private extractNodeDependencies(content: string, language: string): string[] {
    const dependencies: string[] = [];

    // Simple dependency extraction based on common patterns
    const importMatches = content.match(
      /(?:import|from|require)\s+['"']([^'"]+)['"']/g,
    );
    if (importMatches) {
      importMatches.forEach((match) => {
        const depMatch = match.match(/['"']([^'"]+)['"']/);
        if (depMatch) dependencies.push(depMatch[1]);
      });
    }

    return dependencies;
  }

  private extractSurroundingContext(
    lines: string[],
    startLine: number,
    endLine: number,
  ): string {
    const contextRadius = 3;
    const contextStart = Math.max(0, startLine - contextRadius);
    const contextEnd = Math.min(lines.length - 1, endLine + contextRadius);

    const beforeContext = lines.slice(contextStart, startLine).join('\n');
    const afterContext = lines.slice(endLine + 1, contextEnd + 1).join('\n');

    return `${beforeContext}\n...\n${afterContext}`;
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

interface SemanticNode {
  type: string;
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  indent?: number;
}

/**
 * Context-Aware Chunking Strategy - Considers surrounding code context and dependencies
 *
 * This strategy creates chunks that are aware of their surrounding context and dependencies.
 * It implements intelligent overlap calculation based on code relationships and includes
 * business domain detection for better categorization.
 */
export class ContextAwareChunkingStrategy implements ChunkingStrategy {
  name = 'context-aware';
  description =
    'Creates chunks with intelligent context awareness, dependency-based overlap, and business domain detection';

  private readonly maxChunkSize = 150; // Maximum lines per chunk
  private readonly minChunkSize = 15; // Minimum lines per chunk
  private readonly contextRadius = 8; // Lines of context to consider
  private readonly overlapThreshold = 0.3; // Minimum dependency strength for overlap

  isApplicable(language: string, content: string): boolean {
    // Applicable to most programming languages where context matters
    const supportedLanguages = [
      'javascript',
      'typescript',
      'python',
      'java',
      'c',
      'cpp',
      'csharp',
      'go',
      'rust',
      'php',
      'ruby',
      'swift',
      'kotlin',
      'scala',
    ];

    // Check if content has contextual relationships worth preserving
    const hasContextualStructures = this.hasContextualStructures(
      content,
      language,
    );

    return supportedLanguages.includes(language) && hasContextualStructures;
  }

  async chunk(
    content: string,
    filePath: string,
    snapshotId: string,
  ): Promise<EnhancedCodeChunk[]> {
    const language = this.detectLanguage(filePath);
    logVerbose(`Starting context-aware chunking for ${filePath} (${language})`);

    // Parse semantic nodes with context information
    const contextualNodes = await this.parseContextualNodes(content, language);

    if (contextualNodes.length === 0) {
      log(
        `No contextual nodes found in ${filePath}, falling back to simple chunking`,
      );
      return this.createFallbackChunks(content, filePath, snapshotId, language);
    }

    // Analyze dependencies between nodes
    const dependencyGraph = this.buildDependencyGraph(
      contextualNodes,
      content,
      language,
    );

    // Create chunks with intelligent overlap based on dependencies
    const contextualChunks = await this.createContextualChunks(
      content,
      filePath,
      snapshotId,
      language,
      contextualNodes,
      dependencyGraph,
    );

    // Enhance chunks with business domain detection
    return this.enhanceWithBusinessDomains(contextualChunks, content, filePath);
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const extensionMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.rb': 'ruby',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
    };
    return extensionMap[ext] || 'text';
  }

  private hasContextualStructures(content: string, language: string): boolean {
    const lines = content.split('\n');

    // Check for imports/dependencies
    const hasImports = this.hasImportStatements(lines, language);

    // Check for function calls and references (but not simple variable assignments)
    const hasFunctionCalls = this.hasFunctionCalls(lines, language);

    // Check for variable references across different scopes
    const hasVariableReferences = this.hasVariableReferences(lines, language);

    // Check for class/module relationships
    const hasClassRelationships = this.hasClassRelationships(lines, language);

    // Need at least 2 different types of contextual structures for meaningful context
    const contextualFeatures = [
      hasImports,
      hasFunctionCalls,
      hasVariableReferences,
      hasClassRelationships,
    ].filter(Boolean).length;

    return contextualFeatures >= 2;
  }

  private hasImportStatements(lines: string[], language: string): boolean {
    const importPatterns = this.getImportPatterns(language);
    return lines.some((line) =>
      importPatterns.some((pattern) => pattern.test(line)),
    );
  }

  private hasFunctionCalls(lines: string[], language: string): boolean {
    const functionCallPattern = /[a-zA-Z_$][\w$]*\s*\(/;
    return lines.some((line) => functionCallPattern.test(line));
  }

  private hasVariableReferences(lines: string[], language: string): boolean {
    // Look for variable assignments and references
    const variablePatterns = this.getVariablePatterns(language);
    return lines.some((line) =>
      variablePatterns.some((pattern) => pattern.test(line)),
    );
  }

  private hasClassRelationships(lines: string[], language: string): boolean {
    const classPatterns = this.getClassPatterns(language);
    return lines.some((line) =>
      classPatterns.some((pattern) => pattern.test(line)),
    );
  }

  private getImportPatterns(language: string): RegExp[] {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return [
          /^\s*import\s+/,
          /^\s*from\s+.*import/,
          /require\s*\(/,
          /^\s*export\s+/,
        ];
      case 'python':
        return [/^\s*import\s+/, /^\s*from\s+.*import/];
      case 'java':
      case 'csharp':
        return [/^\s*import\s+/, /^\s*using\s+/];
      case 'go':
        return [/^\s*import\s+/];
      default:
        return [/^\s*#include/, /^\s*import/];
    }
  }

  private getVariablePatterns(language: string): RegExp[] {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return [
          /(?:const|let|var)\s+[a-zA-Z_$][\w$]*\s*=/,
          /[a-zA-Z_$][\w$]*\s*=\s*[^=]/,
        ];
      case 'python':
        return [/^[a-zA-Z_]\w*\s*=/, /^\s*[a-zA-Z_]\w*\s*=/];
      case 'java':
      case 'csharp':
        return [
          /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+[a-zA-Z_]\w*\s*=/,
        ];
      default:
        return [/[a-zA-Z_]\w*\s*=/];
    }
  }

  private getClassPatterns(language: string): RegExp[] {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return [
          /(?:class|interface)\s+[a-zA-Z_$][\w$]*/,
          /(?:extends|implements)\s+[a-zA-Z_$][\w$]*/,
        ];
      case 'python':
        return [/^\s*class\s+[a-zA-Z_]\w*/, /class\s+[a-zA-Z_]\w*\([^)]*\)/];
      case 'java':
      case 'csharp':
        return [
          /(?:class|interface)\s+[a-zA-Z_]\w*/,
          /(?:extends|implements)\s+[a-zA-Z_]\w*/,
        ];
      default:
        return [/class\s+[a-zA-Z_]\w*/];
    }
  }

  private async parseContextualNodes(
    content: string,
    language: string,
  ): Promise<ContextualNode[]> {
    const lines = content.split('\n');
    const nodes: ContextualNode[] = [];

    // Parse semantic nodes first
    const semanticNodes = await this.parseSemanticNodes(content, language);

    // Enhance with contextual information
    for (const node of semanticNodes) {
      const contextualNode: ContextualNode = {
        ...node,
        dependencies: this.extractNodeDependencies(node, content, language),
        references: this.extractNodeReferences(node, content, language),
        contextLines: this.extractContextLines(
          lines,
          node.startLine,
          node.endLine,
        ),
        businessDomain: this.inferNodeBusinessDomain(node, content),
      };

      nodes.push(contextualNode);
    }

    return nodes;
  }

  private async parseSemanticNodes(
    content: string,
    language: string,
  ): Promise<SemanticNode[]> {
    // Reuse semantic parsing logic from SemanticChunkingStrategy
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.parseJavaScriptNodes(
          content.split('\n'),
          language === 'typescript',
        );
      case 'python':
        return this.parsePythonNodes(content.split('\n'));
      case 'java':
        return this.parseJavaNodes(content.split('\n'));
      default:
        return this.parseGenericNodes(content.split('\n'));
    }
  }

  private parseJavaScriptNodes(
    lines: string[],
    isTypeScript: boolean,
  ): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    let currentFunction: SemanticNode | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      // Function declarations
      const functionMatch = line.match(
        /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/,
      );
      if (functionMatch) {
        if (currentFunction) {
          currentFunction.endLine = i - 1;
          currentFunction.content = lines
            .slice(currentFunction.startLine, i)
            .join('\n');
          nodes.push(currentFunction);
        }
        currentFunction = {
          type: 'function',
          name: functionMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      // Arrow functions
      const arrowMatch = line.match(
        /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
      );
      if (arrowMatch) {
        if (currentFunction) {
          currentFunction.endLine = i - 1;
          currentFunction.content = lines
            .slice(currentFunction.startLine, i)
            .join('\n');
          nodes.push(currentFunction);
        }
        currentFunction = {
          type: 'function',
          name: arrowMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      // Class declarations
      const classMatch = line.match(/(?:export\s+)?class\s+([a-zA-Z_$][\w$]*)/);
      if (classMatch) {
        if (currentFunction) {
          currentFunction.endLine = i - 1;
          currentFunction.content = lines
            .slice(currentFunction.startLine, i)
            .join('\n');
          nodes.push(currentFunction);
        }
        currentFunction = {
          type: 'class',
          name: classMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      // TypeScript specific
      if (isTypeScript) {
        const interfaceMatch = line.match(
          /(?:export\s+)?interface\s+([a-zA-Z_$][\w$]*)/,
        );
        if (interfaceMatch) {
          if (currentFunction) {
            currentFunction.endLine = i - 1;
            currentFunction.content = lines
              .slice(currentFunction.startLine, i)
              .join('\n');
            nodes.push(currentFunction);
          }
          currentFunction = {
            type: 'interface',
            name: interfaceMatch[1],
            startLine: i,
            endLine: i,
            content: '',
          };
        }
      }

      if (currentFunction && braceDepth === 0 && line.includes('}')) {
        currentFunction.endLine = i;
        currentFunction.content = lines
          .slice(currentFunction.startLine, i + 1)
          .join('\n');
        nodes.push(currentFunction);
        currentFunction = null;
      }
    }

    if (currentFunction) {
      currentFunction.endLine = lines.length - 1;
      currentFunction.content = lines
        .slice(currentFunction.startLine)
        .join('\n');
      nodes.push(currentFunction);
    }

    return nodes;
  }

  private parsePythonNodes(lines: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    let currentNode: SemanticNode | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.length - line.trimStart().length;

      const funcMatch = line.match(/^(\s*)(?:async\s+)?def\s+([a-zA-Z_]\w*)/);
      if (funcMatch) {
        if (currentNode) {
          currentNode.endLine = i - 1;
          currentNode.content = lines
            .slice(currentNode.startLine, i)
            .join('\n');
          nodes.push(currentNode);
        }
        currentNode = {
          type: 'function',
          name: funcMatch[2],
          startLine: i,
          endLine: i,
          content: '',
          indent: funcMatch[1].length,
        };
      }

      const classMatch = line.match(/^(\s*)class\s+([a-zA-Z_]\w*)/);
      if (classMatch) {
        if (currentNode) {
          currentNode.endLine = i - 1;
          currentNode.content = lines
            .slice(currentNode.startLine, i)
            .join('\n');
          nodes.push(currentNode);
        }
        currentNode = {
          type: 'class',
          name: classMatch[2],
          startLine: i,
          endLine: i,
          content: '',
          indent: classMatch[1].length,
        };
      }

      if (
        currentNode &&
        indent <= (currentNode.indent || 0) &&
        trimmed &&
        !line.match(/^(\s*)(?:def|class)/)
      ) {
        currentNode.endLine = i - 1;
        currentNode.content = lines.slice(currentNode.startLine, i).join('\n');
        nodes.push(currentNode);
        currentNode = null;
      }
    }

    if (currentNode) {
      currentNode.endLine = lines.length - 1;
      currentNode.content = lines.slice(currentNode.startLine).join('\n');
      nodes.push(currentNode);
    }

    return nodes;
  }

  private parseJavaNodes(lines: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    let currentNode: SemanticNode | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      const classMatch = line.match(
        /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+([a-zA-Z_]\w*)/,
      );
      if (classMatch) {
        if (currentNode) {
          currentNode.endLine = i - 1;
          currentNode.content = lines
            .slice(currentNode.startLine, i)
            .join('\n');
          nodes.push(currentNode);
        }
        currentNode = {
          type: 'class',
          name: classMatch[1],
          startLine: i,
          endLine: i,
          content: '',
        };
      }

      if (currentNode && braceDepth === 0 && line.includes('}')) {
        currentNode.endLine = i;
        currentNode.content = lines
          .slice(currentNode.startLine, i + 1)
          .join('\n');
        nodes.push(currentNode);
        currentNode = null;
      }
    }

    return nodes;
  }

  private parseGenericNodes(lines: string[]): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    const chunkSize = 30;

    for (let i = 0; i < lines.length; i += chunkSize) {
      const endLine = Math.min(i + chunkSize - 1, lines.length - 1);
      const content = lines.slice(i, endLine + 1).join('\n');

      nodes.push({
        type: 'block',
        name: `block_${i}`,
        startLine: i,
        endLine: endLine,
        content: content,
      });
    }

    return nodes;
  }

  private extractNodeDependencies(
    node: SemanticNode,
    content: string,
    language: string,
  ): string[] {
    const dependencies: string[] = [];
    const nodeContent = node.content;

    // Extract import dependencies
    const importPatterns = this.getImportPatterns(language);
    const lines = nodeContent.split('\n');

    for (const line of lines) {
      for (const pattern of importPatterns) {
        if (pattern.test(line)) {
          const dependency = this.extractDependencyName(line, language);
          if (dependency) {
            dependencies.push(dependency);
          }
        }
      }
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  private extractDependencyName(line: string, language: string): string | null {
    switch (language) {
      case 'javascript':
      case 'typescript': {
        // Extract from import statements
        const jsImportMatch = line.match(/from\s+['"]([^'"]+)['"]/);
        if (jsImportMatch) return jsImportMatch[1];

        const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (requireMatch) return requireMatch[1];
        break;
      }

      case 'python': {
        const pyImportMatch = line.match(
          /(?:from\s+(\S+)\s+import|import\s+(\S+))/,
        );
        if (pyImportMatch) return pyImportMatch[1] || pyImportMatch[2];
        break;
      }

      case 'java': {
        const javaImportMatch = line.match(/import\s+([^;]+);/);
        if (javaImportMatch) return javaImportMatch[1];
        break;
      }
    }

    return null;
  }

  private extractNodeReferences(
    node: SemanticNode,
    content: string,
    language: string,
  ): string[] {
    const references: string[] = [];
    const nodeContent = node.content;

    // Extract function calls and variable references
    const functionCallPattern = /([a-zA-Z_$][\w$]*)\s*\(/g;
    let match;

    while ((match = functionCallPattern.exec(nodeContent)) !== null) {
      const functionName = match[1];
      // Exclude common keywords and built-in functions
      if (!this.isBuiltInFunction(functionName, language)) {
        references.push(functionName);
      }
    }

    return [...new Set(references)]; // Remove duplicates
  }

  private isBuiltInFunction(name: string, language: string): boolean {
    const builtIns: Record<string, string[]> = {
      javascript: [
        'console',
        'setTimeout',
        'setInterval',
        'parseInt',
        'parseFloat',
        'isNaN',
        'isFinite',
      ],
      typescript: [
        'console',
        'setTimeout',
        'setInterval',
        'parseInt',
        'parseFloat',
        'isNaN',
        'isFinite',
      ],
      python: [
        'print',
        'len',
        'range',
        'str',
        'int',
        'float',
        'list',
        'dict',
        'set',
        'tuple',
      ],
      java: ['System', 'String', 'Integer', 'Double', 'Boolean', 'Math'],
    };

    return builtIns[language]?.includes(name) || false;
  }

  private extractContextLines(
    lines: string[],
    startLine: number,
    endLine: number,
  ): ContextLines {
    const beforeStart = Math.max(0, startLine - this.contextRadius);
    const afterEnd = Math.min(lines.length - 1, endLine + this.contextRadius);

    return {
      before: lines.slice(beforeStart, startLine),
      after: lines.slice(endLine + 1, afterEnd + 1),
      startLine: beforeStart,
      endLine: afterEnd,
    };
  }

  private inferNodeBusinessDomain(
    node: SemanticNode,
    content: string,
  ): string | undefined {
    const nodeContent = node.content.toLowerCase();
    const nodeName = node.name.toLowerCase();

    // Financial services - check first as it's more specific than e-commerce
    if (
      this.containsAny(nodeContent, [
        'transaction',
        'billing',
        'invoice',
        'finance',
        'accounting',
        'money',
        'currency',
        'fee',
        'charge',
      ]) ||
      this.containsAny(nodeName, [
        'transaction',
        'billing',
        'invoice',
        'finance',
        'accounting',
        'money',
        'currency',
        'fee',
        'charge',
      ]) ||
      (this.containsAny(nodeContent, ['payment']) &&
        this.containsAny(nodeContent, [
          'processor',
          'gateway',
          'method',
          'transaction',
        ]))
    ) {
      return 'Financial';
    }

    // E-commerce domain - removed 'payment' to avoid conflict with financial
    if (
      this.containsAny(nodeContent, [
        'order',
        'cart',
        'checkout',
        'product',
        'inventory',
        'shipping',
      ]) ||
      this.containsAny(nodeName, [
        'order',
        'cart',
        'checkout',
        'product',
        'inventory',
        'shipping',
      ])
    ) {
      return 'E-commerce';
    }

    // Authentication/User management
    if (
      this.containsAny(nodeContent, [
        'auth',
        'login',
        'register',
        'user',
        'password',
        'token',
        'session',
      ]) ||
      this.containsAny(nodeName, [
        'auth',
        'login',
        'register',
        'user',
        'password',
        'token',
        'session',
      ])
    ) {
      return 'Authentication';
    }

    // Data processing
    if (
      this.containsAny(nodeContent, [
        'data',
        'process',
        'transform',
        'parse',
        'validate',
        'serialize',
      ]) ||
      this.containsAny(nodeName, [
        'data',
        'process',
        'transform',
        'parse',
        'validate',
        'serialize',
      ])
    ) {
      return 'Data Processing';
    }

    // Communication
    if (
      this.containsAny(nodeContent, [
        'message',
        'email',
        'notification',
        'chat',
        'sms',
        'communication',
      ]) ||
      this.containsAny(nodeName, [
        'message',
        'email',
        'notification',
        'chat',
        'sms',
        'communication',
      ])
    ) {
      return 'Communication';
    }

    // Analytics
    if (
      this.containsAny(nodeContent, [
        'analytics',
        'report',
        'dashboard',
        'metric',
        'tracking',
        'statistics',
      ]) ||
      this.containsAny(nodeName, [
        'analytics',
        'report',
        'dashboard',
        'metric',
        'tracking',
        'statistics',
      ])
    ) {
      return 'Analytics';
    }

    return undefined;
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
  }

  private buildDependencyGraph(
    nodes: ContextualNode[],
    content: string,
    language: string,
  ): DependencyGraph {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: [],
    };

    // Initialize nodes in graph
    for (const node of nodes) {
      graph.nodes.set(node.name, {
        name: node.name,
        type: node.type,
        dependencies: node.dependencies,
        references: node.references,
        startLine: node.startLine,
        endLine: node.endLine,
      });
    }

    // Build edges based on dependencies and references
    for (const node of nodes) {
      for (const otherNode of nodes) {
        if (node.name === otherNode.name) continue;

        const strength = this.calculateDependencyStrength(
          node,
          otherNode,
          content,
          language,
        );
        if (strength > 0.1) {
          // Only include meaningful dependencies
          graph.edges.push({
            from: node.name,
            to: otherNode.name,
            strength,
            type: this.determineDependencyType(
              node,
              otherNode,
              content,
              language,
            ),
          });
        }
      }
    }

    return graph;
  }

  private calculateDependencyStrength(
    node: ContextualNode,
    otherNode: ContextualNode,
    content: string,
    language: string,
  ): number {
    let strength = 0;

    // Check if node references otherNode
    if (node.references.includes(otherNode.name)) {
      strength += 0.5;
    }

    // Check if node imports from otherNode's dependencies
    const commonDependencies = node.dependencies.filter((dep) =>
      otherNode.dependencies.includes(dep),
    );
    strength += commonDependencies.length * 0.1;

    // Check proximity (closer nodes have stronger relationships)
    const distance = Math.abs(node.startLine - otherNode.startLine);
    const maxDistance = 100; // lines
    const proximityBonus =
      Math.max(0, (maxDistance - distance) / maxDistance) * 0.2;
    strength += proximityBonus;

    // Check for direct function calls
    const callPattern = new RegExp(
      `\\b${this.escapeRegex(otherNode.name)}\\s*\\(`,
      'g',
    );
    const calls = (node.content.match(callPattern) || []).length;
    strength += Math.min(0.4, calls * 0.1);

    return Math.min(1.0, strength);
  }

  private determineDependencyType(
    node: ContextualNode,
    otherNode: ContextualNode,
    content: string,
    language: string,
  ): DependencyType {
    // Check for function calls
    const callPattern = new RegExp(
      `\\b${this.escapeRegex(otherNode.name)}\\s*\\(`,
      'g',
    );
    if (callPattern.test(node.content)) {
      return 'calls';
    }

    // Check for imports
    if (node.dependencies.some((dep) => dep.includes(otherNode.name))) {
      return 'imports';
    }

    // Check for inheritance
    if (
      node.content.includes(`extends ${otherNode.name}`) ||
      node.content.includes(`implements ${otherNode.name}`)
    ) {
      return 'extends';
    }

    // Default to usage
    return 'uses';
  }

  private async createContextualChunks(
    content: string,
    filePath: string,
    snapshotId: string,
    language: string,
    nodes: ContextualNode[],
    dependencyGraph: DependencyGraph,
  ): Promise<EnhancedCodeChunk[]> {
    const chunks: EnhancedCodeChunk[] = [];
    const lines = content.split('\n');

    for (const node of nodes) {
      // Calculate intelligent overlap based on dependencies
      const overlap = this.calculateIntelligentOverlap(
        node,
        dependencyGraph,
        lines,
      );

      const chunkStartLine = Math.max(0, node.startLine - overlap.before);
      const chunkEndLine = Math.min(
        lines.length - 1,
        node.endLine + overlap.after,
      );
      const chunkContent = lines
        .slice(chunkStartLine, chunkEndLine + 1)
        .join('\n');

      const enhancedMetadata: EnhancedChunkMetadata = {
        language,
        symbols: [node.name],
        semanticType: this.mapNodeTypeToSemanticType(node.type),
        complexityScore: this.calculateNodeComplexity(chunkContent),
        maintainabilityIndex: this.calculateMaintainability(chunkContent),
        dependencies: node.dependencies,
        dependents: this.findDependents(node, dependencyGraph),
        businessDomain: node.businessDomain,
        designPatterns: this.detectDesignPatterns(chunkContent, language),
        codeSmells: this.detectCodeSmells(chunkContent, language),
        securityConcerns: this.detectSecurityConcerns(chunkContent, language),
        linesOfCode: this.calculateLinesOfCode(chunkContent),
      };

      const chunk: EnhancedCodeChunk = {
        id: `${snapshotId}_${path.basename(
          filePath,
        )}_${chunkStartLine}-${chunkEndLine}`.replace(/[^a-zA-Z0-9_.-]/g, '_'),
        content: chunkContent,
        filePath,
        startLine: chunkStartLine,
        endLine: chunkEndLine,
        snapshotId,
        metadata: {
          language,
          symbols: [node.name],
        },
        enhancedMetadata,
        relationships: this.buildChunkRelationships(node, dependencyGraph),
        qualityMetrics: {
          overallScore: 75,
          readabilityScore: this.calculateReadability(chunkContent),
          documentationRatio: this.calculateDocumentationRatio(chunkContent),
          duplicationRisk: 0,
          performanceRisk: 0,
          securityRisk: this.calculateSecurityRisk(chunkContent, language),
          maintainabilityScore: this.calculateMaintainability(chunkContent),
          technicalDebt: {
            estimatedFixTime: 0,
            severity: 'low',
            categories: [],
            issues: [],
          },
        },
        contextInfo: {
          surroundingContext: this.buildSurroundingContext(node.contextLines),
          architecturalLayer: this.determineArchitecturalLayer(
            chunkContent,
            filePath,
          ),
          frameworkContext: this.detectFrameworkContext(chunkContent),
          businessContext: node.businessDomain,
          fileContext: {
            totalLines: lines.length,
            fileSize: content.length,
            lastModified: new Date(),
            siblingChunks: [],
          },
        },
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  private calculateIntelligentOverlap(
    node: ContextualNode,
    dependencyGraph: DependencyGraph,
    lines: string[],
  ): { before: number; after: number } {
    let beforeOverlap = 0;
    let afterOverlap = 0;

    // Find dependencies that might need context
    const strongDependencies = dependencyGraph.edges.filter(
      (edge) =>
        edge.from === node.name && edge.strength > this.overlapThreshold,
    );

    for (const dependency of strongDependencies) {
      const dependentNode = dependencyGraph.nodes.get(dependency.to);
      if (!dependentNode) continue;

      // If dependent is before this node, increase before overlap
      if (dependentNode.endLine < node.startLine) {
        const distance = node.startLine - dependentNode.endLine;
        if (distance < 20) {
          // Only for nearby dependencies
          beforeOverlap = Math.max(
            beforeOverlap,
            Math.min(this.contextRadius, distance / 2),
          );
        }
      }

      // If dependent is after this node, increase after overlap
      if (dependentNode.startLine > node.endLine) {
        const distance = dependentNode.startLine - node.endLine;
        if (distance < 20) {
          // Only for nearby dependencies
          afterOverlap = Math.max(
            afterOverlap,
            Math.min(this.contextRadius, distance / 2),
          );
        }
      }
    }

    return {
      before: Math.round(beforeOverlap),
      after: Math.round(afterOverlap),
    };
  }

  private findDependents(
    node: ContextualNode,
    dependencyGraph: DependencyGraph,
  ): string[] {
    return dependencyGraph.edges
      .filter((edge) => edge.to === node.name)
      .map((edge) => edge.from);
  }

  private detectDesignPatterns(content: string, language: string): string[] {
    const patterns: string[] = [];
    const lowerContent = content.toLowerCase();

    // Singleton pattern
    if (
      lowerContent.includes('singleton') ||
      (lowerContent.includes('instance') && lowerContent.includes('static'))
    ) {
      patterns.push('Singleton');
    }

    // Factory pattern
    if (lowerContent.includes('factory') || lowerContent.includes('create')) {
      patterns.push('Factory');
    }

    // Observer pattern
    if (
      lowerContent.includes('observer') ||
      lowerContent.includes('subscribe') ||
      lowerContent.includes('notify') ||
      lowerContent.includes('listener')
    ) {
      patterns.push('Observer');
    }

    // Strategy pattern
    if (
      lowerContent.includes('strategy') ||
      (lowerContent.includes('interface') && lowerContent.includes('implement'))
    ) {
      patterns.push('Strategy');
    }

    // Decorator pattern
    if (lowerContent.includes('decorator') || lowerContent.includes('@')) {
      patterns.push('Decorator');
    }

    return patterns;
  }

  private detectCodeSmells(content: string, language: string): string[] {
    const smells: string[] = [];
    const lines = content.split('\n');

    // Long method
    if (lines.length > 50) {
      smells.push('Long Method');
    }

    // Too many parameters
    const parameterMatches = content.match(/\([^)]{50,}\)/g);
    if (parameterMatches && parameterMatches.length > 0) {
      smells.push('Long Parameter List');
    }

    // Duplicate code
    const duplicateLines = this.findDuplicateLines(lines);
    if (duplicateLines > 3) {
      smells.push('Duplicate Code');
    }

    // Magic numbers
    const magicNumbers = content.match(/\b\d{2,}\b/g);
    if (magicNumbers && magicNumbers.length > 3) {
      smells.push('Magic Numbers');
    }

    // Deep nesting
    const maxIndentation = Math.max(
      ...lines.map((line) => line.length - line.trimStart().length),
    );
    if (maxIndentation > 20) {
      smells.push('Deep Nesting');
    }

    return smells;
  }

  private findDuplicateLines(lines: string[]): number {
    const lineMap = new Map<string, number>();
    let duplicates = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 10) {
        // Only consider substantial lines
        const count = lineMap.get(trimmed) || 0;
        lineMap.set(trimmed, count + 1);
        if (count === 1) {
          // First duplicate
          duplicates++;
        }
      }
    }

    return duplicates;
  }

  private detectSecurityConcerns(content: string, language: string): string[] {
    const concerns: string[] = [];
    const lowerContent = content.toLowerCase();

    // SQL injection risks
    if (lowerContent.includes('query') && lowerContent.includes('+')) {
      concerns.push('Potential SQL Injection');
    }

    // XSS risks
    if (lowerContent.includes('innerhtml') || lowerContent.includes('eval')) {
      concerns.push('Potential XSS Vulnerability');
    }

    // Hardcoded credentials - look for password assignments with string literals
    if (
      lowerContent.includes('password') &&
      lowerContent.includes('=') &&
      (lowerContent.includes("'") || lowerContent.includes('"'))
    ) {
      concerns.push('Hardcoded Credentials');
    }

    // Insecure random
    if (lowerContent.includes('math.random') && language === 'javascript') {
      concerns.push('Insecure Random Number Generation');
    }

    return concerns;
  }

  private buildChunkRelationships(
    node: ContextualNode,
    dependencyGraph: DependencyGraph,
  ): ChunkRelationship[] {
    const relationships: ChunkRelationship[] = [];

    const nodeEdges = dependencyGraph.edges.filter(
      (edge) => edge.from === node.name,
    );

    for (const edge of nodeEdges) {
      relationships.push({
        type: edge.type,
        targetChunkId: edge.to, // This will need to be mapped to actual chunk IDs later
        strength: edge.strength,
        description: `${edge.type} ${edge.to}`,
        direction: 'outgoing',
        metadata: {
          confidence: edge.strength,
          source: 'static_analysis',
        },
      });
    }

    return relationships;
  }

  private buildSurroundingContext(contextLines: ContextLines): string {
    const contextParts: string[] = [];

    if (contextLines.before.length > 0) {
      contextParts.push('// Context before:');
      contextParts.push(...contextLines.before.slice(-3)); // Last 3 lines
    }

    if (contextLines.after.length > 0) {
      contextParts.push('// Context after:');
      contextParts.push(...contextLines.after.slice(0, 3)); // First 3 lines
    }

    return contextParts.join('\n');
  }

  private async enhanceWithBusinessDomains(
    chunks: EnhancedCodeChunk[],
    content: string,
    filePath: string,
  ): Promise<EnhancedCodeChunk[]> {
    // Analyze file-level business domain
    const fileDomain = this.inferFileBusinessDomain(content, filePath);

    return chunks.map((chunk) => {
      // Use chunk-specific domain if available, otherwise use file domain
      const businessDomain =
        chunk.enhancedMetadata.businessDomain || fileDomain;

      return {
        ...chunk,
        enhancedMetadata: {
          ...chunk.enhancedMetadata,
          businessDomain,
        },
        contextInfo: {
          ...chunk.contextInfo,
          businessContext: businessDomain,
        },
      };
    });
  }

  private inferFileBusinessDomain(
    content: string,
    filePath: string,
  ): string | undefined {
    const lowerContent = content.toLowerCase();
    const lowerPath = filePath.toLowerCase();

    // Financial - check first as it's more specific than e-commerce
    if (
      this.containsAny(lowerContent, [
        'transaction',
        'billing',
        'invoice',
        'finance',
        'accounting',
        'fee',
        'charge',
        'currency',
      ]) ||
      this.containsAny(lowerPath, [
        'transaction',
        'billing',
        'invoice',
        'finance',
        'accounting',
        'fee',
        'charge',
        'currency',
      ]) ||
      (this.containsAny(lowerContent, ['payment']) &&
        this.containsAny(lowerContent, [
          'processor',
          'gateway',
          'method',
          'transaction',
        ]))
    ) {
      return 'Financial';
    }

    // E-commerce - removed 'payment' to avoid conflict with financial
    if (
      this.containsAny(lowerContent, [
        'order',
        'cart',
        'checkout',
        'product',
        'inventory',
      ]) ||
      this.containsAny(lowerPath, [
        'order',
        'cart',
        'checkout',
        'product',
        'inventory',
      ])
    ) {
      return 'E-commerce';
    }

    // Authentication
    if (
      this.containsAny(lowerContent, [
        'auth',
        'login',
        'register',
        'user',
        'password',
        'token',
      ]) ||
      this.containsAny(lowerPath, [
        'auth',
        'login',
        'register',
        'user',
        'password',
        'token',
      ])
    ) {
      return 'Authentication';
    }

    // Communication
    if (
      this.containsAny(lowerContent, [
        'message',
        'email',
        'notification',
        'chat',
        'sms',
      ]) ||
      this.containsAny(lowerPath, [
        'message',
        'email',
        'notification',
        'chat',
        'sms',
      ])
    ) {
      return 'Communication';
    }

    return undefined;
  }

  private createFallbackChunks(
    content: string,
    filePath: string,
    snapshotId: string,
    language: string,
  ): EnhancedCodeChunk[] {
    const lines = content.split('\n');
    const chunks: EnhancedCodeChunk[] = [];
    const chunkSize = 40;

    for (let i = 0; i < lines.length; i += chunkSize) {
      const startLine = i;
      const endLine = Math.min(i + chunkSize - 1, lines.length - 1);
      const chunkContent = lines.slice(startLine, endLine + 1).join('\n');

      const enhancedMetadata: EnhancedChunkMetadata = {
        language,
        semanticType: 'module',
        complexityScore: 1,
        maintainabilityIndex: 50,
        dependencies: [],
        dependents: [],
        designPatterns: [],
        codeSmells: [],
        securityConcerns: [],
        linesOfCode: this.calculateLinesOfCode(chunkContent),
      };

      const chunk: EnhancedCodeChunk = {
        id: `${snapshotId}_${path.basename(
          filePath,
        )}_${startLine}-${endLine}`.replace(/[^a-zA-Z0-9_.-]/g, '_'),
        content: chunkContent,
        filePath,
        startLine,
        endLine,
        snapshotId,
        metadata: { language },
        enhancedMetadata,
        relationships: [],
        qualityMetrics: {
          overallScore: 50,
          readabilityScore: 50,
          documentationRatio: 0,
          duplicationRisk: 0,
          performanceRisk: 0,
          securityRisk: 0,
          maintainabilityScore: 50,
          technicalDebt: {
            estimatedFixTime: 0,
            severity: 'low',
            categories: [],
            issues: [],
          },
        },
        contextInfo: {
          surroundingContext: '',
          architecturalLayer: 'business',
          frameworkContext: [],
          businessContext: undefined,
          fileContext: {
            totalLines: lines.length,
            fileSize: content.length,
            lastModified: new Date(),
            siblingChunks: [],
          },
        },
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  // Helper methods (reused from other strategies)
  private mapNodeTypeToSemanticType(
    nodeType: string,
  ):
    | 'function'
    | 'class'
    | 'interface'
    | 'module'
    | 'config'
    | 'test'
    | 'documentation' {
    switch (nodeType) {
      case 'function':
      case 'method':
        return 'function';
      case 'class':
        return 'class';
      case 'interface':
        return 'interface';
      default:
        return 'module';
    }
  }

  private calculateNodeComplexity(content: string): number {
    const complexityPatterns = /\b(if|for|while|switch|case|catch|&&|\|\|)\b/g;
    const matches = content.match(complexityPatterns);
    return matches ? matches.length + 1 : 1;
  }

  private calculateMaintainability(content: string): number {
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
    return Math.max(0, Math.min(100, 100 - lines * 0.1 + commentRatio * 20));
  }

  private calculateReadability(content: string): number {
    const lines = content.split('\n');
    const avgLineLength =
      lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
    const longLines = lines.filter((line) => line.length > 120).length;

    let score = 100;
    score -= avgLineLength > 80 ? (avgLineLength - 80) * 0.5 : 0;
    score -= longLines * 5;

    return Math.max(0, Math.min(100, score));
  }

  private calculateDocumentationRatio(content: string): number {
    const lines = content.split('\n');
    const docLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/**')
      );
    }).length;

    return lines.length > 0 ? docLines / lines.length : 0;
  }

  private calculateSecurityRisk(content: string, language: string): number {
    const concerns = this.detectSecurityConcerns(content, language);
    return Math.min(100, concerns.length * 25); // Each concern adds 25% risk
  }

  private determineArchitecturalLayer(
    content: string,
    filePath: string,
  ): import('../types/enhancedChunking').ArchitecturalLayer {
    const lowerPath = filePath.toLowerCase();
    const lowerContent = content.toLowerCase();

    // Check content patterns first for more accurate detection
    const hasRouterGet = lowerContent.includes('router.get');
    const hasRouterPost = lowerContent.includes('router.post');
    const hasReqRes = lowerContent.includes('(req, res)');
    const hasResJson = lowerContent.includes('res.json');

    if (hasRouterGet || hasRouterPost || hasReqRes || hasResJson) {
      return 'presentation';
    }

    if (
      lowerContent.includes('app.get') ||
      lowerContent.includes('app.post') ||
      lowerContent.includes('express.router') ||
      lowerContent.includes('req,') ||
      lowerContent.includes('res.status') ||
      lowerContent.includes('async (req, res)')
    ) {
      return 'presentation';
    }

    if (
      lowerPath.includes('controller') ||
      lowerPath.includes('handler') ||
      lowerPath.includes('route') ||
      lowerPath.includes('api')
    ) {
      return 'presentation';
    }

    if (
      lowerContent.includes('database') ||
      lowerContent.includes('query') ||
      lowerContent.includes('select') ||
      lowerContent.includes('insert') ||
      lowerContent.includes('update') ||
      lowerContent.includes('delete') ||
      lowerContent.includes('this.db.')
    ) {
      return 'data';
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
      lowerPath.includes('service') ||
      lowerPath.includes('business') ||
      lowerPath.includes('logic') ||
      lowerPath.includes('manager')
    ) {
      return 'business';
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

    if (
      lowerContent.includes('http') ||
      lowerContent.includes('request') ||
      lowerContent.includes('response') ||
      lowerContent.includes('router')
    ) {
      return 'presentation';
    }

    return 'business';
  }

  private detectFrameworkContext(content: string): string[] {
    const frameworks: string[] = [];
    const lowerContent = content.toLowerCase();

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

    return frameworks;
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

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Additional interfaces for context-aware chunking
interface ContextualNode extends SemanticNode {
  dependencies: string[];
  references: string[];
  contextLines: ContextLines;
  businessDomain?: string;
}

interface ContextLines {
  before: string[];
  after: string[];
  startLine: number;
  endLine: number;
}

interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
}

interface DependencyNode {
  name: string;
  type: string;
  dependencies: string[];
  references: string[];
  startLine: number;
  endLine: number;
}

interface DependencyEdge {
  from: string;
  to: string;
  strength: number;
  type: DependencyType;
}

type DependencyType = 'calls' | 'imports' | 'extends' | 'implements' | 'uses';
/*
 *
 * Hierarchical Chunking Strategy - Creates nested chunks for complex structures
 */
export class HierarchicalChunkingStrategy implements ChunkingStrategy {
  name = 'hierarchical';
  description =
    'Creates hierarchical chunks with parent-child relationships for nested structures';

  isApplicable(language: string, content: string): boolean {
    // Applicable to languages with clear hierarchical structures
    const hierarchicalLanguages = [
      'javascript',
      'typescript',
      'java',
      'csharp',
      'python',
    ];
    return (
      hierarchicalLanguages.includes(language) &&
      this.hasNestedStructures(content)
    );
  }

  private hasNestedStructures(content: string): boolean {
    // Check for nested classes, functions, or modules
    const lines = content.split('\n');

    // Check for brace-based nesting (JavaScript, Java, C#, etc.)
    let braceDepth = 0;
    let maxBraceDepth = 0;

    for (const line of lines) {
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;
      maxBraceDepth = Math.max(maxBraceDepth, braceDepth);
    }

    if (maxBraceDepth > 2) {
      return true;
    }

    // Check for indentation-based nesting (Python)
    let maxIndentLevel = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.length - line.trimStart().length;
      const indentLevel = Math.floor(indent / 4); // Assuming 4-space indentation

      // Check if this line defines a new scope (class, function, etc.)
      if (trimmed.match(/^(class|def|async\s+def)\s+/)) {
        maxIndentLevel = Math.max(maxIndentLevel, indentLevel);
      }
    }

    return maxIndentLevel > 1; // Has significant nesting (more than one level)
  }

  async chunk(
    content: string,
    filePath: string,
    snapshotId: string,
  ): Promise<EnhancedCodeChunk[]> {
    const language = this.detectLanguage(filePath);
    const hierarchicalNodes = await this.parseHierarchicalNodes(
      content,
      language,
    );

    return this.createHierarchicalChunks(
      content,
      filePath,
      snapshotId,
      language,
      hierarchicalNodes,
    );
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const extensionMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.cs': 'csharp',
    };
    return extensionMap[ext] || 'text';
  }

  private shouldPopNode(
    node: HierarchicalNode,
    currentIndent: number,
    currentLine: string,
    language: string,
    braceDepth?: number,
  ): boolean {
    // For indentation-based languages (Python)
    if (language === 'python') {
      // Pop if we've decreased indentation to the same level or less than the current node
      return currentIndent <= (node.indent || 0);
    }

    // For brace-based languages
    const trimmed = currentLine.trim();

    // Pop on closing brace if it reduces the scope
    if (trimmed === '}' || trimmed.endsWith('}')) {
      return true;
    }

    // Check if we've encountered a new structure at the same or higher level
    const nodeInfo = this.identifyHierarchicalNode(
      currentLine,
      language,
      0,
      currentIndent,
    );
    if (nodeInfo) {
      // Only pop if the new structure is at the same indentation level or less
      // This handles cases like class declarations inside other classes
      if (currentIndent <= (node.indent || 0)) {
        return true;
      }
    }

    return false;
  }

  private async parseHierarchicalNodes(
    content: string,
    language: string,
  ): Promise<HierarchicalNode[]> {
    const lines = content.split('\n');
    const nodes: HierarchicalNode[] = [];
    const nodeStack: HierarchicalNode[] = [];
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        !trimmed ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      const indent = line.length - line.trimStart().length;

      // Track brace depth for brace-based languages
      if (language !== 'python') {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;
      }

      // Pop nodes from stack if we've decreased indentation or reached end of scope
      while (nodeStack.length > 0) {
        const topNode = nodeStack[nodeStack.length - 1];
        const shouldPop = this.shouldPopNode(
          topNode,
          indent,
          line,
          language,
          braceDepth,
        );

        if (shouldPop) {
          const completedNode = nodeStack.pop()!;
          completedNode.endLine = i - 1;
          completedNode.content = lines
            .slice(completedNode.startLine, i)
            .join('\n');

          // Add to parent's children or root nodes
          if (completedNode.parent) {
            completedNode.parent.children.push(completedNode);
          } else {
            nodes.push(completedNode);
          }
        } else {
          break;
        }
      }

      // Check for new hierarchical structures
      const nodeInfo = this.identifyHierarchicalNode(line, language, i, indent);

      if (nodeInfo) {
        const parentNode =
          nodeStack.length > 0 ? nodeStack[nodeStack.length - 1] : null;
        const level = nodeStack.length;

        const newNode: HierarchicalNode = {
          type: nodeInfo.type,
          name: nodeInfo.name,
          startLine: i,
          endLine: i,
          content: '',
          indent,
          parent: parentNode,
          children: [],
          level,
          braceDepthAtStart: braceDepth,
        };

        nodeStack.push(newNode);
      }
    }

    // Handle any remaining nodes in the stack
    while (nodeStack.length > 0) {
      const completedNode = nodeStack.pop()!;
      completedNode.endLine = lines.length - 1;
      completedNode.content = lines.slice(completedNode.startLine).join('\n');

      if (completedNode.parent) {
        completedNode.parent.children.push(completedNode);
      } else {
        nodes.push(completedNode);
      }
    }

    return this.flattenHierarchicalNodes(nodes);
  }

  private flattenHierarchicalNodes(
    nodes: HierarchicalNode[],
  ): HierarchicalNode[] {
    const flatNodes: HierarchicalNode[] = [];

    const flatten = (node: HierarchicalNode) => {
      flatNodes.push(node);
      for (const child of node.children) {
        flatten(child);
      }
    };

    for (const node of nodes) {
      flatten(node);
    }

    return flatNodes;
  }

  private identifyHierarchicalNode(
    line: string,
    language: string,
    lineIndex: number,
    indent: number,
  ): { type: string; name: string } | null {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return this.identifyJSHierarchicalNode(line);
      case 'python':
        return this.identifyPythonHierarchicalNode(line);
      case 'java':
      case 'csharp':
        return this.identifyJavaHierarchicalNode(line);
      default:
        return null;
    }
  }

  private identifyJSHierarchicalNode(
    line: string,
  ): { type: string; name: string } | null {
    // Class declaration (including nested classes)
    const classMatch = line.match(/(?:export\s+)?class\s+([a-zA-Z_$][\w$]*)/);
    if (classMatch) {
      return { type: 'class', name: classMatch[1] };
    }

    // Function declaration
    const functionMatch = line.match(
      /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/,
    );
    if (functionMatch) {
      return { type: 'function', name: functionMatch[1] };
    }

    // Arrow function assignment
    const arrowMatch = line.match(
      /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
    );
    if (arrowMatch) {
      return { type: 'function', name: arrowMatch[1] };
    }

    // Method declaration (inside class) - improved detection
    const methodMatch = line.match(
      /^\s*(?:static\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{?/,
    );
    if (
      methodMatch &&
      !line.includes('=') &&
      !line.includes('function') &&
      !line.includes('class') &&
      !line.includes('if') &&
      !line.includes('for') &&
      !line.includes('while')
    ) {
      return { type: 'method', name: methodMatch[1] };
    }

    // Nested function inside another function
    const nestedFunctionMatch = line.match(/^\s*function\s+([a-zA-Z_$][\w$]*)/);
    if (nestedFunctionMatch) {
      return { type: 'function', name: nestedFunctionMatch[1] };
    }

    return null;
  }

  private identifyPythonHierarchicalNode(
    line: string,
  ): { type: string; name: string } | null {
    // Class declaration
    const classMatch = line.match(/^\s*class\s+([a-zA-Z_]\w*)/);
    if (classMatch) {
      return { type: 'class', name: classMatch[1] };
    }

    // Function declaration
    const funcMatch = line.match(/^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)/);
    if (funcMatch) {
      return { type: 'function', name: funcMatch[1] };
    }

    return null;
  }

  private identifyJavaHierarchicalNode(
    line: string,
  ): { type: string; name: string } | null {
    // Class declaration
    const classMatch = line.match(
      /(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+([a-zA-Z_]\w*)/,
    );
    if (classMatch) {
      return { type: 'class', name: classMatch[1] };
    }

    // Interface declaration
    const interfaceMatch = line.match(
      /(?:public|private|protected)?\s*interface\s+([a-zA-Z_]\w*)/,
    );
    if (interfaceMatch) {
      return { type: 'interface', name: interfaceMatch[1] };
    }

    // Method declaration
    const methodMatch = line.match(
      /(?:public|private|protected)?\s*(?:static)?\s*(?:\w+\s+)?([a-zA-Z_]\w*)\s*\([^)]*\)/,
    );
    if (
      methodMatch &&
      line.includes('(') &&
      !line.includes('class') &&
      !line.includes('interface')
    ) {
      return { type: 'method', name: methodMatch[1] };
    }

    return null;
  }

  private createHierarchicalChunks(
    content: string,
    filePath: string,
    snapshotId: string,
    language: string,
    nodes: HierarchicalNode[],
  ): EnhancedCodeChunk[] {
    const chunks: EnhancedCodeChunk[] = [];
    const lines = content.split('\n');

    for (const node of nodes) {
      const chunkContent =
        node.content ||
        lines.slice(node.startLine, node.endLine + 1).join('\n');

      const enhancedMetadata: EnhancedChunkMetadata = {
        language,
        symbols: [node.name],
        semanticType: this.mapNodeTypeToSemanticType(node.type),
        complexityScore: this.calculateHierarchicalComplexity(node),
        maintainabilityIndex: this.calculateMaintainability(chunkContent),
        dependencies: [],
        dependents: [],
        designPatterns: this.detectHierarchicalPatterns(node),
        codeSmells: [],
        securityConcerns: [],
        linesOfCode: this.calculateLinesOfCode(chunkContent),
      };

      const chunk: EnhancedCodeChunk = {
        id: `${snapshotId}_${path.basename(filePath)}_${node.startLine}-${
          node.endLine
        }_L${node.level}`.replace(/[^a-zA-Z0-9_.-]/g, '_'),
        content: chunkContent,
        filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        snapshotId,
        metadata: {
          language,
          symbols: [node.name],
        },
        enhancedMetadata,
        relationships: this.createHierarchicalRelationships(node),
        qualityMetrics: {
          overallScore: 75,
          readabilityScore: this.calculateReadability(chunkContent),
          documentationRatio: this.calculateDocumentationRatio(chunkContent),
          duplicationRisk: 0,
          performanceRisk: 0,
          securityRisk: 0,
          maintainabilityScore: this.calculateMaintainability(chunkContent),
          technicalDebt: {
            estimatedFixTime: 0,
            severity: 'low',
            categories: [],
            issues: [],
          },
        },
        contextInfo: {
          surroundingContext: this.extractHierarchicalContext(node, lines),
          architecturalLayer: this.determineArchitecturalLayerFromNode(node),
          frameworkContext: [],
          businessContext: undefined,
          fileContext: {
            totalLines: lines.length,
            fileSize: content.length,
            lastModified: new Date(),
            siblingChunks: [],
          },
        },
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  private calculateHierarchicalComplexity(node: HierarchicalNode): number {
    let complexity = 1;

    // Base complexity from content
    if (node.content) {
      const complexityPatterns =
        /\b(if|for|while|switch|case|catch|&&|\|\|)\b/g;
      const matches = node.content.match(complexityPatterns);
      complexity += matches ? matches.length : 0;
    }

    // Add complexity for nesting level
    complexity += node.level * 0.5;

    // Add complexity for number of children
    complexity += node.children.length * 0.3;

    return Math.round(complexity * 10) / 10;
  }

  private detectHierarchicalPatterns(node: HierarchicalNode): string[] {
    const patterns: string[] = [];

    if (node.type === 'class' && node.children.length > 0) {
      patterns.push('Composite');
    }

    if (node.level > 2) {
      patterns.push('Nested Structure');
    }

    return patterns;
  }

  private createHierarchicalRelationships(
    node: HierarchicalNode,
  ): ChunkRelationship[] {
    const relationships: ChunkRelationship[] = [];

    // Parent relationship
    if (node.parent) {
      relationships.push({
        type: 'extends',
        targetChunkId: `${node.parent.startLine}-${node.parent.endLine}`,
        strength: 0.9,
        description: `Child of ${node.parent.name}`,
        direction: 'outgoing',
        metadata: {
          confidence: 0.9,
          source: 'ast',
        },
      });
    }

    // Children relationships
    for (const child of node.children) {
      relationships.push({
        type: 'uses',
        targetChunkId: `${child.startLine}-${child.endLine}`,
        strength: 0.8,
        description: `Contains ${child.name}`,
        direction: 'outgoing',
        metadata: {
          confidence: 0.8,
          source: 'ast',
        },
      });
    }

    return relationships;
  }

  private extractHierarchicalContext(
    node: HierarchicalNode,
    lines: string[],
  ): string {
    const contextLines: string[] = [];

    // Add parent context
    if (node.parent) {
      contextLines.push(`Parent: ${node.parent.name} (${node.parent.type})`);
    }

    // Add children context
    if (node.children.length > 0) {
      contextLines.push(
        `Children: ${node.children.map((c) => c.name).join(', ')}`,
      );
    }

    return contextLines.join('\n');
  }

  private determineArchitecturalLayerFromNode(
    node: HierarchicalNode,
  ): import('../types/enhancedChunking').ArchitecturalLayer {
    const name = node.name.toLowerCase();

    if (name.includes('controller') || name.includes('handler')) {
      return 'presentation';
    }

    if (name.includes('service') || name.includes('manager')) {
      return 'business';
    }

    if (
      name.includes('repository') ||
      name.includes('dao') ||
      name.includes('model')
    ) {
      return 'data';
    }

    return 'business';
  }

  private mapNodeTypeToSemanticType(
    nodeType: string,
  ):
    | 'function'
    | 'class'
    | 'interface'
    | 'module'
    | 'config'
    | 'test'
    | 'documentation' {
    switch (nodeType) {
      case 'function':
      case 'method':
        return 'function';
      case 'class':
        return 'class';
      case 'interface':
        return 'interface';
      default:
        return 'module';
    }
  }

  private calculateMaintainability(content: string): number {
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
    return Math.max(0, Math.min(100, 100 - lines * 0.1 + commentRatio * 20));
  }

  private calculateReadability(content: string): number {
    const lines = content.split('\n');
    const avgLineLength =
      lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
    const longLines = lines.filter((line) => line.length > 120).length;

    let score = 100;
    score -= avgLineLength > 80 ? (avgLineLength - 80) * 0.5 : 0;
    score -= longLines * 5;

    return Math.max(0, Math.min(100, score));
  }

  private calculateDocumentationRatio(content: string): number {
    const lines = content.split('\n');
    const docLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/**')
      );
    }).length;

    return lines.length > 0 ? docLines / lines.length : 0;
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

interface HierarchicalNode {
  type: string;
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  indent?: number;
  parent: HierarchicalNode | null;
  children: HierarchicalNode[];
  level: number;
  braceDepthAtStart?: number;
}
