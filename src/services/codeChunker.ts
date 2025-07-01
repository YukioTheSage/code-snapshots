import * as vscode from 'vscode';
import * as path from 'path';
import * as javaParser from 'java-parser';
import * as Parser from 'web-tree-sitter'; // Added tree-sitter for better parsing
import { log, logVerbose } from '../logger';

export interface CodeChunk {
  id: string;
  content: string;
  filePath: string;
  /** 0-based start line index */
  startLine: number;
  /** 0-based end line index */
  endLine: number;
  snapshotId: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  language: string;
  symbols?: string[]; // Function/class names detected within the chunk boundaries
  imports?: string[]; // All import statements found in the file (file-level)
  commentRatio?: number; // Ratio of comments to code lines in the chunk
  complexity?: number; // Optional: code complexity metric (e.g., cyclomatic)
}

interface AstNode {
  type: string;
  name?: string;
  start: number;
  end: number;
  loc: {
    start: { line: number; column: number }; // 0-based line index
    end: { line: number; column: number }; // 0-based line index
  };
}

export class CodeChunker {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private treeSitterParsers: Map<string, Parser.Parser> = new Map();
  private parserInitialized = false;

  constructor() {
    const config = vscode.workspace.getConfiguration(
      'vscode-snapshots.semanticSearch',
    );

    // Increase default chunk size for better context
    this.chunkSize = Math.max(10, config.get<number>('chunkSize', 250));

    // Increase default overlap for better continuity
    this.chunkOverlap = Math.max(
      0,
      Math.min(config.get<number>('chunkOverlap', 100), this.chunkSize - 5),
    );

    log(
      `CodeChunker initialized with chunkSize=${this.chunkSize}, chunkOverlap=${this.chunkOverlap}`,
    );

    // Initialize parsers asynchronously to avoid blocking
    this.initializeParsers().catch((error) => {
      log(`Parser initialization error: ${error}`);
    });
  }

  /**
   * Initialize tree-sitter parsers for supported languages
   */
  private async initializeParsers(): Promise<void> {
    try {
      // Initialize the Parser class
      await Parser.Parser.init();

      // Load parsers for each supported language
      // Note: In a real implementation, these would be loaded from WASM files
      // For demonstration purposes, we'll just set up the Python parser
      const pythonParser = new Parser.Language();
      // This would be the actual loading code:
      // await pythonParser.load('/path/to/tree-sitter-python.wasm');
      this.treeSitterParsers.set('python', new Parser.Parser());
      this.treeSitterParsers.get('python')?.setLanguage(pythonParser);

      this.parserInitialized = true;
      log('Tree-sitter parsers initialized successfully');
    } catch (error) {
      log(`Failed to initialize Tree-sitter parsers: ${error}`);
      // Continue without tree-sitter, we'll fall back to regex
    }
  }

  /**
   * Chunks a file's content into semantically meaningful pieces.
   * Uses AST parsing for supported languages, falling back to line-based chunking.
   */
  async chunkFile(
    filePath: string,
    content: string,
    snapshotId: string,
  ): Promise<CodeChunk[]> {
    // Enhanced language detection that considers both extension and content
    const language = await this.detectLanguage(filePath, content);
    logVerbose(`Chunking file ${filePath} with language ${language}`);

    if (this.isAstSupportedLanguage(language)) {
      try {
        const semanticNodes = await this.parseToSemanticNodes(
          content,
          language,
        );

        if (semanticNodes.length > 0) {
          logVerbose(
            `AST parsing successful for ${filePath}, creating chunks based on ${semanticNodes.length} nodes.`,
          );
          return this.chunkWithAst(
            filePath,
            content,
            snapshotId,
            language,
            semanticNodes,
          );
        } else {
          log(
            `AST parsing for ${filePath} yielded no semantic nodes. Falling back to line-based chunking.`,
          );
        }
      } catch (error) {
        log(
          `Error during AST parsing/chunking for ${filePath}: ${error}. Falling back to line-based chunking.`,
        );
      }
    }

    // Fallback to line-based chunking
    return await this.chunkByLines(filePath, content, snapshotId, language);
  }

  /**
   * Enhanced language detection that considers file extension and content patterns.
   * Avoids VS Code's language detection during semantic search to prevent creating unsaved documents in tabs.
   */
  private async detectLanguage(
    filePath: string,
    content: string,
  ): Promise<string> {
    // Skip VS Code's built-in language detection since it creates unsaved documents
    // This prevents unsaved clones from appearing in VS Code tabs during semantic search indexing

    // Fall back to extension-based detection
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

  /**
   * Normalize VS Code language IDs to our internal representation
   */
  private normalizeLanguageId(vscodeLangId: string): string {
    const mapping: Record<string, string> = {
      javascriptreact: 'javascript',
      typescriptreact: 'typescript',
    };

    return mapping[vscodeLangId] || vscodeLangId;
  }

  /**
   * Determines if a language supports AST-based chunking in this implementation.
   */
  private isAstSupportedLanguage(language: string): boolean {
    const astSupportedLanguages = [
      'javascript',
      'typescript',
      'python',
      'java',
    ];
    return astSupportedLanguages.includes(language);
  }

  /**
   * Parses code into semantic nodes using language-specific AST parsers.
   */
  private async parseToSemanticNodes(
    content: string,
    language: string,
  ): Promise<AstNode[]> {
    try {
      switch (language) {
        case 'javascript':
          return Promise.resolve(this.parseJavaScript(content, false));
        case 'typescript':
          return Promise.resolve(this.parseJavaScript(content, true));
        case 'python':
          // Use tree-sitter if initialized, otherwise fall back to regex
          if (this.parserInitialized && this.treeSitterParsers.has('python')) {
            return this.parsePythonWithTreeSitter(content);
          } else {
            return Promise.resolve(this.parsePython(content));
          }
        case 'java':
          return Promise.resolve(this.parseJava(content));
        default:
          logVerbose(
            `AST parsing not supported for language: ${language}. No nodes generated.`,
          );
          return Promise.resolve([]);
      }
    } catch (error) {
      log(
        `Error during parseToSemanticNodes for language ${language}: ${error}`,
      );
      return Promise.resolve([]); // Return empty on parsing errors to allow fallback
    }
  }

  /**
   * Parse JavaScript/TypeScript code using regex patterns
   * @param content Source code content
   * @param isTypescript Whether to include TypeScript-specific patterns
   */
  private parseJavaScript(content: string, isTypescript: boolean): AstNode[] {
    const semanticNodes: AstNode[] = [];
    const lines = content.split('\n');

    // Regex patterns for detecting JavaScript/TypeScript constructs
    const patterns = [
      // Class declaration: class MyClass {}
      {
        type: 'class',
        regex: /(?:export\s+)?class\s+([A-Za-z$_][\w$]*)/,
        nameIndex: 1,
      },

      // Function declaration: function myFunc() {}
      {
        type: 'function',
        regex: /function\s+([A-Za-z$_][\w$]*)\s*\(/,
        nameIndex: 1,
      },

      // Method definition: myMethod() {}
      {
        type: 'method',
        regex: /(?:async\s+)?([A-Za-z$_][\w$]*)\s*\([^)]*\)\s*{/,
        nameIndex: 1,
      },

      // Arrow function: const myFunc = () => {}
      {
        type: 'function',
        regex:
          /(?:const|let|var)\s+([A-Za-z$_][\w$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
        nameIndex: 1,
      },
    ];

    // Add TypeScript-specific patterns
    if (isTypescript) {
      patterns.push(
        // Interface declaration: interface MyInterface {}
        {
          type: 'interface',
          regex: /(?:export\s+)?interface\s+([A-Za-z$_][\w$]*)/,
          nameIndex: 1,
        },

        // Type declaration: type MyType = {}
        {
          type: 'type',
          regex: /(?:export\s+)?type\s+([A-Za-z$_][\w$]*)\s*=/,
          nameIndex: 1,
        },

        // Enum declaration: enum MyEnum {}
        {
          type: 'enum',
          regex: /(?:export\s+)?enum\s+([A-Za-z$_][\w$]*)/,
          nameIndex: 1,
        },
      );
    }

    // Track braces to determine where blocks end
    const braceStack: {
      line: number;
      col: number;
      type: string;
      name: string;
    }[] = [];
    let inComment = false;
    let blockStarted = false;

    // Process each line to find patterns and track braces
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      // Check if line contains multi-line comment markers
      if (line.includes('/*')) inComment = true;
      if (line.includes('*/')) inComment = false;
      if (inComment || line.trim().startsWith('//')) continue;

      // Check for declarations
      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          const name = match[pattern.nameIndex];
          // Record the start of a block
          braceStack.push({
            line: lineIndex,
            col: line.indexOf(match[0]),
            type: pattern.type,
            name: name,
          });
          blockStarted = true;
        }
      }

      // Process braces to track scopes
      if (blockStarted) {
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '{') {
            // Opening brace - already handled above
          } else if (line[i] === '}' && braceStack.length > 0) {
            // Closing brace - pop the stack and create a node
            const start = braceStack.pop();
            if (start) {
              semanticNodes.push({
                type: start.type,
                name: start.name,
                start: 0, // We're not tracking exact char positions
                end: 0,
                loc: {
                  start: { line: start.line, column: start.col },
                  end: { line: lineIndex, column: i },
                },
              });
            }
          }
        }
      }
    }

    // Sort nodes by start line for consistency
    semanticNodes.sort((a, b) => a.loc.start.line - b.loc.start.line);

    return semanticNodes;
  }

  /**
   * Parse Python using Tree-sitter for more accurate AST extraction
   */
  private parsePythonWithTreeSitter(content: string): Promise<AstNode[]> {
    return new Promise((resolve) => {
      const semanticNodes: AstNode[] = [];
      if (!this.parserInitialized) {
        resolve(this.parsePython(content)); // Fall back to regex
        return;
      }

      const pythonParser = this.treeSitterParsers.get('python');
      if (!pythonParser) {
        resolve(this.parsePython(content)); // Fall back to regex
        return;
      }

      try {
        let rootNode = null;
        try {
          const parseResult = pythonParser.parse(content);
          rootNode = parseResult ? parseResult.rootNode : null;
          if (!rootNode) {
            resolve(this.parsePython(content)); // Fall back to regex if parsing fails
            return;
          }
        } catch (e) {
          resolve(this.parsePython(content)); // Fall back to regex if parsing fails
          return;
        }

        // Define a visitor function to extract functions and classes
        const visitNode = (node: any) => {
          if (!node) return;

          if (
            node.type === 'function_definition' ||
            node.type === 'class_definition'
          ) {
            // Find the identifier node (name)
            let nameNode = null;
            for (let i = 0; i < node.childCount; i++) {
              let child = null;
              try {
                child = node.child ? node.child(i) : null;
              } catch (e) {
                // Skip if child access fails
                continue;
              }
              if (child && child.type === 'identifier') {
                nameNode = child;
                break;
              }
            }

            if (nameNode) {
              semanticNodes.push({
                type:
                  node.type === 'function_definition' ? 'function' : 'class',
                name: nameNode.text || '',
                start: node.startIndex,
                end: node.endIndex,
                loc: {
                  start: {
                    line: node.startPosition.row,
                    column: node.startPosition.column,
                  },
                  end: {
                    line: node.endPosition.row,
                    column: node.endPosition.column,
                  },
                },
              });
            }
          }

          // Visit children recursively
          for (let i = 0; i < (node.childCount || 0); i++) {
            let child = null;
            try {
              child = node.child ? node.child(i) : null;
            } catch (e) {
              continue; // Skip if child access fails
            }
            if (child) {
              visitNode(child);
            }
          }
        };

        // Start visiting from root
        visitNode(rootNode);

        // Sort nodes by start line
        semanticNodes.sort((a, b) => a.loc.start.line - b.loc.start.line);

        // If no nodes found, add whole file as one node
        if (semanticNodes.length === 0 && content.trim().length > 0) {
          const lines = content.split('\n');
          semanticNodes.push({
            type: 'file',
            name: 'file.py',
            start: 0,
            end: content.length,
            loc: {
              start: { line: 0, column: 0 },
              end: {
                line: lines.length - 1,
                column: lines[lines.length - 1].length,
              },
            },
          });
        }

        resolve(semanticNodes);
      } catch (error) {
        log(`Error parsing Python with Tree-sitter: ${error}`);
        // Fall back to regex-based parsing
        resolve(this.parsePython(content));
      }
    });
  }

  /**
   * Improved Python regex parser with better docstring and decorator handling
   */
  private parsePython(content: string): AstNode[] {
    const semanticNodes: AstNode[] = [];
    const lines = content.split('\n');

    // Enhanced regex patterns for Python
    const functionRegex = /^(\s*)def\s+([a-zA-Z_]\w*)\s*\(/;
    const classRegex = /^(\s*)class\s+([a-zA-Z_]\w*)\s*(?:\(.*\))?\s*:/;
    const asyncFunctionRegex = /^(\s*)async\s+def\s+([a-zA-Z_]\w*)\s*\(/;
    const decoratorRegex = /^(\s*)@/;
    // Removed unused docstringRegex

    let currentBlock: {
      startLine: number;
      name: string;
      type: string;
      indent: number;
      decorators: string[];
    } | null = null;

    let collectingDecorators = false;
    let pendingDecorators: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Skip empty lines and comments
      if (trimmedLine === '' || trimmedLine.startsWith('#')) {
        continue;
      }

      const currentIndentMatch = line.match(/^(\s*)/);
      const currentIndent = currentIndentMatch
        ? currentIndentMatch[1].length
        : 0;

      // Check for decorators
      if (decoratorRegex.test(line)) {
        collectingDecorators = true;
        pendingDecorators.push(trimmedLine);
        continue;
      }

      // Check if we are outside a block or the current line has less/equal indent
      if (currentBlock && currentIndent <= currentBlock.indent) {
        // Finalize the previous block
        semanticNodes.push({
          type: currentBlock.type,
          name: currentBlock.name,
          start: currentBlock.startLine,
          end: i - 1,
          loc: {
            start: {
              line: currentBlock.startLine,
              column: currentBlock.indent,
            },
            end: { line: i - 1, column: lines[i - 1]?.length || 0 },
          },
        });
        currentBlock = null;
      }

      // Check for function or class definition
      if (!currentBlock) {
        const funcMatch = line.match(functionRegex);
        const classMatch = line.match(classRegex);
        const asyncFuncMatch = line.match(asyncFunctionRegex);

        if (funcMatch || asyncFuncMatch) {
          const match = funcMatch || asyncFuncMatch;
          if (!match) continue;
          currentBlock = {
            startLine: collectingDecorators ? i - pendingDecorators.length : i,
            name: match[2],
            type: 'function',
            indent: match[1].length,
            decorators: pendingDecorators,
          };
          collectingDecorators = false;
          pendingDecorators = [];
        } else if (classMatch) {
          currentBlock = {
            startLine: collectingDecorators ? i - pendingDecorators.length : i,
            name: classMatch[2],
            type: 'class',
            indent: classMatch[1].length,
            decorators: pendingDecorators,
          };
          collectingDecorators = false;
          pendingDecorators = [];
        } else {
          // If not a function/class, reset decorator collection
          collectingDecorators = false;
          pendingDecorators = [];
        }
      }
    }

    // Finalize any open block at the end of the file
    if (currentBlock) {
      const endLine = lines.length - 1;
      semanticNodes.push({
        type: currentBlock.type,
        name: currentBlock.name,
        start: currentBlock.startLine,
        end: endLine,
        loc: {
          start: { line: currentBlock.startLine, column: currentBlock.indent },
          end: { line: endLine, column: lines[endLine]?.length || 0 },
        },
      });
    }

    // If no nodes found, add whole file as one node
    if (semanticNodes.length === 0 && content.trim().length > 0) {
      semanticNodes.push({
        type: 'file',
        name: 'file.py',
        start: 0,
        end: content.length,
        loc: {
          start: { line: 0, column: 0 },
          end: {
            line: lines.length - 1,
            column: lines[lines.length - 1].length,
          },
        },
      });
    }

    // Sort nodes by start line
    semanticNodes.sort((a, b) => a.loc.start.line - b.loc.start.line);
    return semanticNodes;
  }

  /**
   * Improved Java parser using visitor pattern for robustness
   */
  private parseJava(content: string): AstNode[] {
    const semanticNodes: AstNode[] = [];
    try {
      const ast: javaParser.CstNode = javaParser.parse(content);

      // Use a proper visitor pattern for Java parsing
      const visitor = {
        visit: function (node: any) {
          if (!node || typeof node !== 'object') return;

          let type: string | null = null;
          let name: string | undefined;
          const location = node.location;

          if (node.type === 'MethodDeclaration') {
            type = 'method';
            name = node.name?.identifier;
          } else if (node.type === 'ClassDeclaration') {
            type = 'class';
            name = node.name?.identifier;
          } else if (node.type === 'InterfaceDeclaration') {
            type = 'interface';
            name = node.name?.identifier;
          } else if (node.type === 'ConstructorDeclaration') {
            type = 'constructor';
            name = node.name?.identifier;
          } else if (node.type === 'EnumDeclaration') {
            type = 'enum';
            name = node.name?.identifier;
          } else if (node.type === 'AnnotationDeclaration') {
            type = 'annotation';
            name = node.name?.identifier;
          }

          if (
            type &&
            name &&
            location &&
            node.startOffset !== undefined &&
            node.endOffset !== undefined
          ) {
            // Normalize to 0-based line numbers
            const startLine = location.startLine - 1;
            const endLine = location.endLine - 1;
            // Normalize columns too
            const startCol =
              location.startColumn > 0 ? location.startColumn - 1 : 0;
            const endCol = location.endColumn > 0 ? location.endColumn - 1 : 0;

            if (startLine >= 0 && endLine >= startLine) {
              semanticNodes.push({
                type: type,
                name: name,
                start: node.startOffset,
                end: node.endOffset,
                loc: {
                  start: { line: startLine, column: startCol },
                  end: { line: endLine, column: endCol },
                },
              });
            }
          }

          // Visit all properties that might contain child nodes
          Object.keys(node).forEach((key) => {
            const value = (node as any)[key];
            if (key !== 'location' && key !== 'text') {
              if (Array.isArray(value)) {
                value.forEach((item) => this.visit(item));
              } else if (value && typeof value === 'object') {
                this.visit(value);
              }
            }
          });
        },
      };

      visitor.visit(ast as any);

      // Sort nodes by start line
      semanticNodes.sort((a, b) => a.loc.start.line - b.loc.start.line);

      // Add whole file if no nodes found
      if (semanticNodes.length === 0 && content.trim().length > 0) {
        const lines = content.split('\n');
        semanticNodes.push({
          type: 'file',
          name: 'file.java',
          start: 0,
          end: content.length,
          loc: {
            start: { line: 0, column: 0 },
            end: {
              line: lines.length - 1,
              column: lines[lines.length - 1].length,
            },
          },
        });
      }

      return semanticNodes;
    } catch (error) {
      log(`Error parsing Java: ${error}`);
      return [];
    }
  }

  /**
   * Enhanced createChunk method with more precise metadata extraction
   */
  private createChunk(
    filePath: string,
    content: string,
    snapshotId: string,
    startLine: number,
    endLine: number,
    language: string,
    symbols: string[] = [],
    imports: string[] = [],
  ): CodeChunk {
    // More accurate comment ratio calculation
    const commentRatio = this.calculateCommentRatio(content, language);

    // Calculate optional complexity metric
    const complexity = this.calculateComplexity(content, language);

    // Ensure line numbers are valid
    const SLine = Math.max(0, startLine);
    const ELine = Math.max(SLine, endLine);

    return {
      id: `${snapshotId}_${path.basename(filePath)}_${SLine}-${ELine}`.replace(
        /[^a-zA-Z0-9_.-]/g,
        '_',
      ),
      content,
      filePath,
      startLine: SLine,
      endLine: ELine,
      snapshotId,
      metadata: {
        language,
        symbols: symbols.length > 0 ? symbols : undefined,
        imports: imports.length > 0 ? imports : undefined,
        commentRatio:
          commentRatio > 0 ? parseFloat(commentRatio.toFixed(2)) : undefined,
        complexity: complexity > 0 ? complexity : undefined,
      },
    };
  }

  /**
   * Calculate approximate code complexity (cyclomatic complexity)
   */
  private calculateComplexity(content: string, language: string): number {
    // A simple regex-based estimation of cyclomatic complexity
    // This measures branches in code (if, for, while, switch cases, etc.)
    let complexityRegex: RegExp;

    switch (language) {
      case 'javascript':
      case 'typescript':
      case 'java':
      case 'c':
      case 'cpp':
      case 'csharp':
        // Count if, else if, for, while, case statements
        complexityRegex = /\b(if|for|while|case|catch)\b|&&|\|\|/g;
        break;
      case 'python':
        // Count if, elif, for, while, except
        complexityRegex = /\b(if|elif|for|while|except)\b|and |or /g;
        break;
      default:
        return 0; // Not supported for other languages
    }

    const matches = content.match(complexityRegex);
    return matches ? matches.length + 1 : 1; // Base complexity of 1
  }

  /**
   * Enhanced comment ratio calculation with better multiline support
   */
  private calculateCommentRatio(content: string, language: string): number {
    const lines = content.split('\n');
    const totalLines = lines.length;

    if (totalLines === 0) return 0;

    // Configure regex patterns for different languages
    const commentPatterns = this.getCommentPatterns(language);
    if (!commentPatterns) return 0;

    const {
      lineCommentRegex,
      blockCommentStartRegex,
      blockCommentEndRegex,
      stringDelimiterRegex,
    } = commentPatterns;

    let commentLines = 0;
    let inBlockComment = false;
    let inString = false;
    let stringDelimiter = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue; // Skip empty lines

      let isCommentLine = false;
      let j = 0;

      // Process the line character by character for accurate detection
      while (j < line.length) {
        const remaining = line.substring(j);

        // Skip string content as it might contain comment-like sequences
        if (!inBlockComment && stringDelimiterRegex) {
          const stringMatch = remaining.match(stringDelimiterRegex);
          if (stringMatch && stringMatch.index === 0) {
            if (inString && stringMatch[0] === stringDelimiter) {
              // End of string
              inString = false;
              j += stringMatch[0].length;
              continue;
            } else if (!inString) {
              // Start of string
              inString = true;
              stringDelimiter = stringMatch[0];
              j += stringMatch[0].length;
              continue;
            }
          }
        }

        // Skip content inside strings
        if (inString) {
          j++;
          continue;
        }

        // Check for line comment start
        if (!inBlockComment && lineCommentRegex) {
          const lineCommentMatch = remaining.match(lineCommentRegex);
          if (lineCommentMatch && lineCommentMatch.index === 0) {
            isCommentLine = true;
            break;
          }
        }

        // Check for block comment start
        if (!inBlockComment && blockCommentStartRegex) {
          const blockStartMatch = remaining.match(blockCommentStartRegex);
          if (blockStartMatch && blockStartMatch.index === 0) {
            inBlockComment = true;
            isCommentLine = true;
            j += blockStartMatch[0].length;
            continue;
          }
        }

        // Check for block comment end
        if (inBlockComment && blockCommentEndRegex) {
          const blockEndMatch = remaining.match(blockCommentEndRegex);
          if (blockEndMatch && blockEndMatch.index === 0) {
            inBlockComment = false;
            isCommentLine = true;
            j += blockEndMatch[0].length;
            continue;
          }
        }

        // If in a block comment, the whole line is a comment
        if (inBlockComment) {
          isCommentLine = true;
          break;
        }

        j++; // Move to next character
      }

      if (isCommentLine) {
        commentLines++;
      }
    }

    return commentLines / totalLines;
  }

  /**
   * Get language-specific comment patterns
   */
  private getCommentPatterns(language: string): {
    lineCommentRegex?: RegExp;
    blockCommentStartRegex?: RegExp;
    blockCommentEndRegex?: RegExp;
    stringDelimiterRegex?: RegExp;
  } {
    switch (language) {
      case 'javascript':
      case 'typescript':
      case 'java':
      case 'c':
      case 'cpp':
      case 'csharp':
        return {
          lineCommentRegex: /\/\//,
          blockCommentStartRegex: /\/\*/,
          blockCommentEndRegex: /\*\//,
          stringDelimiterRegex: /["'`]/,
        };
      case 'python':
        return {
          lineCommentRegex: /#/,
          blockCommentStartRegex: /"""|'''/,
          blockCommentEndRegex: /"""|'''/,
          stringDelimiterRegex: /"""|'''/,
        };
      case 'html':
        return {
          blockCommentStartRegex: /<!--/,
          blockCommentEndRegex: /-->/,
        };
      case 'css':
      case 'scss':
      case 'sass':
        return {
          blockCommentStartRegex: /\/\*/,
          blockCommentEndRegex: /\*\//,
        };
      // Add more languages as needed
      default:
        return {
          lineCommentRegex: /#/,
        };
    }
  }

  /**
   * Enhanced extraction of imports with better language-specific patterns
   */
  private extractImports(lines: string[], language: string): string[] {
    const imports = new Set<string>();

    // Join lines for multiline pattern matching
    const content = lines.join('\n');

    switch (language) {
      case 'javascript':
      case 'typescript': {
        // Handle ES6 imports and require statements
        const esImportRegex =
          /import\s+(?:(?:\*\s+as\s+\w+)|(?:[\w\s{},*]+))\s+from\s+["']([^"']+)["']/g;
        const requireRegex =
          /(?:const|let|var)\s+(?:[\w\s{},*]+)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g;

        let match;
        while ((match = esImportRegex.exec(content)) !== null) {
          imports.add(match[1]);
        }

        while ((match = requireRegex.exec(content)) !== null) {
          imports.add(match[1]);
        }
        break;
      }

      case 'python': {
        // Handle Python imports and from...import
        const pythonImportRegex =
          /^(?:import\s+([\w.]+)(?:\s+as\s+\w+)?|from\s+([\w.]+)\s+import\s+(?:\([\s\w,*]+\)|[\s\w,*]+))/gm;

        let match;
        while ((match = pythonImportRegex.exec(content)) !== null) {
          const importName = match[1] || match[2];
          if (importName) imports.add(importName);
        }
        break;
      }

      case 'java': {
        // Handle Java imports
        const javaImportRegex = /import\s+(?:static\s+)?([\w.]+\*?);/g;

        let match;
        while ((match = javaImportRegex.exec(content)) !== null) {
          imports.add(match[1]);
        }
        break;
      }

      // Add more language-specific patterns as needed
    }

    return Array.from(imports);
  }

  /**
   * Improved chunking with AST, with better handling of large nodes
   */
  private async chunkWithAst(
    filePath: string,
    content: string,
    snapshotId: string,
    language: string,
    nodes: AstNode[],
  ): Promise<CodeChunk[]> {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    const imports = this.extractImports(lines, language);

    // Process batches of nodes to form chunks
    let currentChunkNodes: AstNode[] = [];
    let currentChunkLines = 0;

    for (const node of nodes) {
      const nodeStartLine = node.loc.start.line;
      const nodeEndLine = node.loc.end.line;
      const nodeLineCount = nodeEndLine - nodeStartLine + 1;

      // Skip invalid nodes
      if (nodeLineCount <= 0) continue;

      // Handle large nodes by splitting them
      if (nodeLineCount > this.chunkSize) {
        // Finalize any previous chunk
        if (currentChunkNodes.length > 0) {
          chunks.push(
            this.createChunkFromNodes(
              filePath,
              lines,
              currentChunkNodes,
              snapshotId,
              language,
              imports,
            ),
          );
          currentChunkNodes = [];
          currentChunkLines = 0;
        }

        // Improved large node splitting with more context preservation
        this.splitLargeNodeIntoChunks(
          filePath,
          lines,
          node,
          snapshotId,
          language,
          imports,
          chunks,
        );
      } else {
        // Check if adding this node would exceed chunk size
        if (
          currentChunkLines + nodeLineCount > this.chunkSize &&
          currentChunkNodes.length > 0
        ) {
          chunks.push(
            this.createChunkFromNodes(
              filePath,
              lines,
              currentChunkNodes,
              snapshotId,
              language,
              imports,
            ),
          );
          currentChunkNodes = [];
          currentChunkLines = 0;
        }

        // Add node to current chunk batch
        currentChunkNodes.push(node);

        // Recalculate the actual lines covered by the chunk
        if (currentChunkNodes.length === 1) {
          currentChunkLines = nodeLineCount;
        } else {
          const chunkStartLine = Math.min(
            ...currentChunkNodes.map((n) => n.loc.start.line),
          );
          const chunkEndLine = Math.max(
            ...currentChunkNodes.map((n) => n.loc.end.line),
          );
          currentChunkLines = chunkEndLine - chunkStartLine + 1;
        }
      }
    }

    // Add any remaining nodes as final chunk
    if (currentChunkNodes.length > 0) {
      chunks.push(
        this.createChunkFromNodes(
          filePath,
          lines,
          currentChunkNodes,
          snapshotId,
          language,
          imports,
        ),
      );
    }

    // Fallback if no chunks were created
    if (chunks.length === 0 && lines.length > 0) {
      return await this.chunkByLines(filePath, content, snapshotId, language);
    }

    // Apply overlap with improved context preservation
    const finalChunks = this.applyChunkOverlapping(
      chunks,
      lines,
      this.chunkOverlap,
    );

    logVerbose(
      `Created ${finalChunks.length} AST-based chunks for ${filePath}`,
    );
    return finalChunks;
  }

  /**
   * Enhanced method to split large nodes with better semantic preservation
   */
  private splitLargeNodeIntoChunks(
    filePath: string,
    lines: string[],
    node: AstNode,
    snapshotId: string,
    language: string,
    imports: string[],
    chunks: CodeChunk[],
  ): void {
    const nodeStartLine = node.loc.start.line;
    const nodeEndLine = node.loc.end.line;

    // Try to find logical break points in the code
    const breakpoints = this.findLogicalBreakpoints(
      lines,
      nodeStartLine,
      nodeEndLine,
      language,
    );

    if (breakpoints.length > 1) {
      // Use logical breakpoints if found
      for (let i = 0; i < breakpoints.length - 1; i++) {
        const startLine = breakpoints[i];
        const endLine = breakpoints[i + 1] - 1;

        // Skip if range is invalid
        if (endLine < startLine) continue;

        const chunkLines = lines.slice(startLine, endLine + 1);
        const chunkContent = chunkLines.join('\n');

        // Only include node name in first chunk
        const symbolsForChunk = i === 0 && node.name ? [node.name] : [];

        chunks.push(
          this.createChunk(
            filePath,
            chunkContent,
            snapshotId,
            startLine,
            endLine,
            language,
            symbolsForChunk,
            imports,
          ),
        );
      }
    } else {
      // Fall back to fixed-size chunking
      const step = Math.max(
        1,
        this.chunkSize -
          Math.min(this.chunkOverlap, Math.floor(this.chunkSize / 4)),
      );

      for (let i = nodeStartLine; i <= nodeEndLine; i += step) {
        const chunkStartLine = i;
        const chunkEndLine = Math.min(i + this.chunkSize - 1, nodeEndLine);

        // Ensure valid range
        if (chunkEndLine < chunkStartLine) continue;

        const chunkLines = lines.slice(chunkStartLine, chunkEndLine + 1);
        const chunkContent = chunkLines.join('\n');

        // Only include node name in first chunk
        const symbolsForChunk =
          i === nodeStartLine && node.name ? [node.name] : [];

        chunks.push(
          this.createChunk(
            filePath,
            chunkContent,
            snapshotId,
            chunkStartLine,
            chunkEndLine,
            language,
            symbolsForChunk,
            imports,
          ),
        );

        // Stop if we've reached the end
        if (chunkEndLine === nodeEndLine) break;
      }
    }
  }

  /**
   * Find logical break points in code for better chunking
   */
  private findLogicalBreakpoints(
    lines: string[],
    startLine: number,
    endLine: number,
    language: string,
  ): number[] {
    const breakpoints = new Set<number>([startLine]); // Always include start

    // Track nesting and context
    let nestingLevel = 0;
    let lastBreakPoint = startLine;

    // Configure language-specific patterns
    const emptyLineRegex = /^\s*$/;
    let commentRegex: RegExp | null = null;
    let blockStartRegex: RegExp | null = null;
    let blockEndRegex: RegExp | null = null;

    switch (language) {
      case 'javascript':
      case 'typescript':
        commentRegex = /^\s*\/\//;
        blockStartRegex =
          /^\s*[\w$]+\s*[({[]|^\s*(?:function|class|interface|enum|if|for|while|switch)\b/;
        blockEndRegex = /^\s*[})\]]/;
        break;
      case 'python':
        commentRegex = /^\s*#/;
        blockStartRegex =
          /^\s*(?:def|class|if|for|while|try|except|with|async)\b/;
        // Python uses indentation for blocks
        break;
      case 'java':
        commentRegex = /^\s*\/\//;
        blockStartRegex =
          /^\s*(?:public|private|protected|static|final|abstract|synchronized)?\s*(?:class|interface|enum|void|[\w<>[\]]+)\s+\w+/;
        blockEndRegex = /^\s*}/;
        break;
    }

    // Track indentation for languages like Python
    const indentLevels: number[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const line = lines[i];
      const indentMatch = line.match(/^(\s*)/);
      indentLevels[i] = indentMatch ? indentMatch[1].length : 0;
    }

    // Find the base indentation level
    const baseIndent = Math.min(
      ...(indentLevels
        .slice(startLine, endLine + 1)
        .filter((indent) => indent !== undefined && indent > 0) || [0]),
    );

    // Scan through lines looking for logical break points
    for (let i = startLine; i <= endLine; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Skip empty lines
      if (trimmedLine === '') continue;

      // Track nesting changes
      if (blockStartRegex?.test(line)) {
        nestingLevel++;
        // Major declarations are key breakpoints
        if (
          (line.includes('function') ||
            line.includes('class') ||
            line.includes('def ')) &&
          i - lastBreakPoint > 5 // Ensure minimum chunk size
        ) {
          breakpoints.add(i);
          lastBreakPoint = i;
        }
      } else if (blockEndRegex?.test(line)) {
        nestingLevel = Math.max(0, nestingLevel - 1);
        // End of a major block could be a good break point
        if (nestingLevel === 0 && i - lastBreakPoint > 10) {
          breakpoints.add(i + 1); // Add after the block end
          lastBreakPoint = i + 1;
        }
      }

      // Comment blocks that indicate logical sections
      if (commentRegex?.test(line)) {
        const isSignificantComment =
          line.includes('SECTION') ||
          line.includes('MARK') ||
          line.includes('TODO') ||
          line.includes('FIXME') ||
          line.match(/[-=*]{3,}/) || // Divider with 3+ symbols
          line.match(/#{2,}/) || // Multiple hash symbols
          line.includes('Step');

        if (isSignificantComment && i - lastBreakPoint > 10) {
          breakpoints.add(i);
          lastBreakPoint = i;
        }
      }

      // For Python, changes in indentation level can indicate logical breaks
      if (language === 'python' && i > startLine) {
        const prevIndent = indentLevels[i - 1];
        const currentIndent = indentLevels[i];

        // If indentation decreases to base level, it's a block end
        if (
          prevIndent > baseIndent &&
          currentIndent === baseIndent &&
          i - lastBreakPoint > 10
        ) {
          breakpoints.add(i);
          lastBreakPoint = i;
        }
      }

      // Check for multiple empty lines which often indicate section breaks
      if (
        i >= 2 &&
        emptyLineRegex.test(lines[i - 2]) &&
        emptyLineRegex.test(lines[i - 1]) &&
        !emptyLineRegex.test(line) &&
        i - lastBreakPoint > 10
      ) {
        breakpoints.add(i);
        lastBreakPoint = i;
      }
    }

    // Always include end line + 1 (for slicing)
    breakpoints.add(endLine + 1);

    // Convert to sorted array
    const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b);

    // Ensure no section is too large
    const result: number[] = [];
    const maxChunkSize = this.chunkSize * 1.5;

    for (let i = 0; i < sortedBreakpoints.length - 1; i++) {
      const start = sortedBreakpoints[i];
      const end = sortedBreakpoints[i + 1];
      const size = end - start;

      result.push(start);

      // Split large sections at better breakpoints
      if (size > maxChunkSize) {
        const numBreaks = Math.ceil(size / this.chunkSize) - 1;

        for (let j = 1; j <= numBreaks; j++) {
          // Find a good place to break - prefer empty lines or comment starts
          const breakPoint = start + Math.round((j * size) / (numBreaks + 1));
          let bestBreakPoint = breakPoint;

          // Look for a better break point nearby
          for (
            let k = Math.max(start, breakPoint - 5);
            k < Math.min(end, breakPoint + 5);
            k++
          ) {
            const line = lines[k]?.trim() || '';
            if (line === '' || commentRegex?.test(line)) {
              bestBreakPoint = k;
              break;
            }
          }

          result.push(bestBreakPoint);
        }
      }
    }

    result.push(sortedBreakpoints[sortedBreakpoints.length - 1]);
    return result.sort((a, b) => a - b);
  }

  /**
   * Create chunk from a set of nodes with improved metadata
   */
  private createChunkFromNodes(
    filePath: string,
    lines: string[],
    nodes: AstNode[],
    snapshotId: string,
    language: string,
    imports: string[],
  ): CodeChunk {
    // Calculate the actual start/end lines covered by all nodes
    const startLine = Math.min(...nodes.map((n) => n.loc.start.line));
    const endLine = Math.max(...nodes.map((n) => n.loc.end.line));

    // Validate line range
    if (endLine < startLine || startLine < 0 || endLine >= lines.length) {
      logVerbose(`Invalid line range for chunk: ${startLine}-${endLine}`);
      // Create minimal valid chunk
      const validStartLine = Math.max(0, startLine);
      const validEndLine = Math.min(
        lines.length - 1,
        Math.max(validStartLine, endLine),
      );

      const content = lines.slice(validStartLine, validEndLine + 1).join('\n');
      return this.createChunk(
        filePath,
        content,
        snapshotId,
        validStartLine,
        validEndLine,
        language,
        [],
        imports,
      );
    }

    // Extract chunk content
    const chunkLines = lines.slice(startLine, endLine + 1);
    const chunkContent = chunkLines.join('\n');

    // Extract symbols from node names
    const symbols = nodes
      .map((node) => node.name)
      .filter((name): name is string => !!name);

    return this.createChunk(
      filePath,
      chunkContent,
      snapshotId,
      startLine,
      endLine,
      language,
      symbols,
      imports,
    );
  }

  /**
   * Improved chunk overlapping with better context preservation
   */
  private applyChunkOverlapping(
    chunks: CodeChunk[],
    fileLines: string[],
    overlapSize: number,
  ): CodeChunk[] {
    if (chunks.length <= 1 || overlapSize <= 0) {
      return chunks;
    }

    const finalChunks: CodeChunk[] = [];
    finalChunks.push(chunks[0]);

    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = finalChunks[finalChunks.length - 1];
      const currentChunk = chunks[i];

      // Skip if chunks are from different files
      if (prevChunk.filePath !== currentChunk.filePath) {
        finalChunks.push(currentChunk);
        continue;
      }

      // Calculate gap between chunks
      const gap = currentChunk.startLine - prevChunk.endLine - 1;

      if (gap < 0) {
        // Chunks already overlap, merge them
        const mergedStartLine = Math.min(
          prevChunk.startLine,
          currentChunk.startLine,
        );
        const mergedEndLine = Math.max(prevChunk.endLine, currentChunk.endLine);

        const mergedContent = fileLines
          .slice(mergedStartLine, mergedEndLine + 1)
          .join('\n');

        const mergedSymbols = Array.from(
          new Set([
            ...(prevChunk.metadata.symbols || []),
            ...(currentChunk.metadata.symbols || []),
          ]),
        );

        // Replace previous chunk with merged chunk
        finalChunks[finalChunks.length - 1] = this.createChunk(
          currentChunk.filePath,
          mergedContent,
          currentChunk.snapshotId,
          mergedStartLine,
          mergedEndLine,
          currentChunk.metadata.language,
          mergedSymbols,
          currentChunk.metadata.imports || [],
        );
      } else if (gap < overlapSize) {
        // There's a small gap - include it and context from both chunks
        const overlapStartLine = Math.max(
          0,
          prevChunk.endLine - Math.floor(overlapSize / 2) + 1,
        );
        const overlapContent = fileLines
          .slice(overlapStartLine, currentChunk.endLine + 1)
          .join('\n');

        const mergedSymbols = Array.from(
          new Set([
            ...(prevChunk.metadata.symbols || []),
            ...(currentChunk.metadata.symbols || []),
          ]),
        );

        // Add modified chunk with improved overlap
        finalChunks.push(
          this.createChunk(
            currentChunk.filePath,
            overlapContent,
            currentChunk.snapshotId,
            overlapStartLine,
            currentChunk.endLine,
            currentChunk.metadata.language,
            mergedSymbols,
            currentChunk.metadata.imports || [],
          ),
        );
      } else {
        // Large gap - add standard context from both sides
        const contextLines = Math.min(
          overlapSize,
          Math.floor(this.chunkSize / 4),
        );

        if (contextLines > 0) {
          // Add context from previous chunk ending
          const prevContextStartLine = Math.max(
            prevChunk.startLine,
            prevChunk.endLine - contextLines + 1,
          );

          // And context from current chunk beginning
          const overlapContent = [
            ...fileLines.slice(prevContextStartLine, prevChunk.endLine + 1),
            '// ...', // Add separator
            ...fileLines.slice(
              currentChunk.startLine,
              currentChunk.endLine + 1,
            ),
          ].join('\n');

          // Add the chunk with context
          finalChunks.push(
            this.createChunk(
              currentChunk.filePath,
              overlapContent,
              currentChunk.snapshotId,
              currentChunk.startLine,
              currentChunk.endLine,
              currentChunk.metadata.language,
              currentChunk.metadata.symbols || [],
              currentChunk.metadata.imports || [],
            ),
          );
        } else {
          // No context needed
          finalChunks.push(currentChunk);
        }
      }
    }

    return finalChunks;
  }

  /**
   * Fallback line-based chunking with improved metadata extraction
   */
  private async chunkByLines(
    filePath: string,
    content: string,
    snapshotId: string,
    language: string,
  ): Promise<CodeChunk[]> {
    // Split the content into lines
    const lines = content.split('\n');

    if (lines.length === 0) {
      return [];
    }

    const chunks: CodeChunk[] = [];
    const imports = this.extractImports(lines, language);

    // Use logical breakpoints for more natural chunking
    const logicalBreakpoints = this.findFileBreakpoints(lines, language);

    if (logicalBreakpoints.length > 0) {
      // Use logical breakpoints to create chunks
      let chunkStartLine = 0;

      for (const breakpoint of logicalBreakpoints) {
        // Skip invalid breakpoints
        if (breakpoint <= chunkStartLine || breakpoint >= lines.length) {
          continue;
        }

        // Get the chunk content
        const chunkLines = lines.slice(chunkStartLine, breakpoint);
        const chunkContent = chunkLines.join('\n');

        // Skip empty chunks
        if (chunkContent.trim() === '') {
          chunkStartLine = breakpoint;
          continue;
        }

        // Extract symbols from the chunk
        const symbols = this.extractSymbols(chunkLines, language);

        // Create a chunk
        chunks.push(
          this.createChunk(
            filePath,
            chunkContent,
            snapshotId,
            chunkStartLine,
            breakpoint - 1,
            language,
            symbols,
            imports,
          ),
        );

        // Move to the next chunk
        chunkStartLine = breakpoint;
      }
    } else {
      // Create fixed-size chunks with overlap if no logical breakpoints found
      const fixedChunks = this.createFixedSizeChunks(
        filePath,
        lines,
        snapshotId,
        language,
        imports,
      );
      fixedChunks.forEach((chunk) => {
        chunks.push(chunk);
      });
    }

    // Apply overlap with improved context preservation
    const finalChunks = this.applyChunkOverlapping(
      chunks,
      lines,
      this.chunkOverlap,
    );

    logVerbose(
      `Created ${finalChunks.length} line-based chunks for ${filePath}`,
    );
    return finalChunks;
  }

  /**
   * Create fixed-size chunks with overlap
   */
  private createFixedSizeChunks(
    filePath: string,
    lines: string[],
    snapshotId: string,
    language: string,
    imports: string[],
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lineCount = lines.length;
    const step = Math.max(1, this.chunkSize - this.chunkOverlap);

    for (let i = 0; i < lineCount; i += step) {
      const startLine = i;
      const endLine = Math.min(startLine + this.chunkSize - 1, lineCount - 1);

      // Skip invalid ranges
      if (endLine < startLine || startLine >= lineCount) continue;

      const chunkLines = lines.slice(startLine, endLine + 1);
      const chunkContent = chunkLines.join('\n');

      // Extract symbols for this chunk
      const symbols = this.extractSymbols(chunkLines, language);

      chunks.push(
        this.createChunk(
          filePath,
          chunkContent,
          snapshotId,
          startLine,
          endLine,
          language,
          symbols,
          imports,
        ),
      );

      // Stop if we've reached the end
      if (endLine === lineCount - 1) break;
    }

    return chunks;
  }

  /**
   * Find logical breakpoints in a file for improved line-based chunking
   */
  private findFileBreakpoints(lines: string[], language: string): number[] {
    const breakpoints = new Set<number>([0]); // Always include start
    const lineCount = lines.length;

    const patterns = this.getLanguageBreakpointPatterns(language);

    // Scan for logical sections
    let consecutiveEmptyLines = 0;

    for (let i = 0; i < lineCount; i++) {
      const line = lines[i].trim();

      // Track empty lines as potential section breaks
      if (line === '') {
        consecutiveEmptyLines++;
        if (consecutiveEmptyLines >= 2) {
          breakpoints.add(i + 1);
          consecutiveEmptyLines = 0;
        }
        continue;
      } else {
        consecutiveEmptyLines = 0;
      }

      // Check for section headers or structure starts
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          breakpoints.add(i);
          break;
        }
      }
    }

    // Always include end line + 1 (for slicing)
    breakpoints.add(lineCount);

    // Convert to sorted array
    const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b);

    // Ensure no section is too large by adding more breakpoints if needed
    const result = [0]; // Always start at line 0

    for (let i = 1; i < sortedBreakpoints.length; i++) {
      const prevPoint = sortedBreakpoints[i - 1];
      const currentPoint = sortedBreakpoints[i];
      const sectionSize = currentPoint - prevPoint;

      if (sectionSize > this.chunkSize * 2) {
        // Add intermediate points to break large sections
        const neededPoints = Math.ceil(sectionSize / this.chunkSize) - 1;
        for (let j = 1; j <= neededPoints; j++) {
          result.push(
            prevPoint + Math.floor((j * sectionSize) / (neededPoints + 1)),
          );
        }
      }

      result.push(currentPoint);
    }

    return result.sort((a, b) => a - b);
  }

  /**
   * Get language-specific patterns for identifying logical breakpoints
   */
  private getLanguageBreakpointPatterns(language: string): RegExp[] {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return [
          /^\/\/\s*(?:SECTION|MARK|TODO|FIXME|[=-]{3,})/i,
          /^(?:export\s+)?(?:class|function|const|let|var|interface|type|enum)\s+\w+/,
          /^\/\*{1,2}/, // Start of block comment
        ];
      case 'python':
        return [
          /^#\s*(?:SECTION|MARK|TODO|FIXME|[-=*]{3,})/i,
          /^(?:def|class|if\s+__name__\s*==\s*['"]__main__['"]|@\w+)/,
        ];
      case 'java':
        return [
          /^\/\/\s*(?:SECTION|MARK|TODO|FIXME|[=-]{3,})/i,
          /^(?:public|private|protected)\s+(?:class|interface|enum)/,
          /^(?:public|private|protected|static|final)\s+\w+/,
          /^\/\*{1,2}/, // Start of block comment
        ];
      // Add more languages as needed
      default:
        return [/^#{1,2}/, /^\/\//]; // Basic patterns for most languages
    }
  }

  /**
   * Create sub-chunks for a large section in line-based chunking
   */
  private createSubChunks(
    filePath: string,
    lines: string[],
    startLine: number,
    endLine: number,
    snapshotId: string,
    language: string,
    imports: string[],
  ): CodeChunk[] {
    const subChunks: CodeChunk[] = [];
    const sectionSize = endLine - startLine + 1;
    const step = Math.max(
      1,
      this.chunkSize -
        Math.min(this.chunkOverlap, Math.floor(this.chunkSize / 3)),
    );

    for (let i = 0; i < sectionSize; i += step) {
      const chunkStartLine = startLine + i;
      const chunkEndLine = Math.min(
        chunkStartLine + this.chunkSize - 1,
        endLine,
      );

      // Skip invalid ranges
      if (chunkEndLine < chunkStartLine) continue;

      const chunkLines = lines.slice(chunkStartLine, chunkEndLine + 1);
      const chunkContent = chunkLines.join('\n');

      // Extract symbols for this chunk
      const symbols = this.extractSymbols(chunkLines, language);

      subChunks.push(
        this.createChunk(
          filePath,
          chunkContent,
          snapshotId,
          chunkStartLine,
          chunkEndLine,
          language,
          symbols,
          imports,
        ),
      );

      // Stop if we've reached the end
      if (chunkEndLine === endLine) break;
    }

    return subChunks;
  }

  /**
   * Enhanced symbol extraction with more precise patterns
   */
  private extractSymbols(lines: string[], language: string): string[] {
    const symbols = new Set<string>();
    const content = lines.join('\n');

    // Language-specific patterns
    switch (language) {
      case 'javascript':
      case 'typescript': {
        // Class declarations
        const classRegex = /\bclass\s+([a-zA-Z_$][\w$]*)/g;
        let match;
        while ((match = classRegex.exec(content)) !== null) {
          symbols.add(match[1]);
        }

        // Function declarations
        const funcRegex = /\bfunction\s+([a-zA-Z_$][\w$]*)/g;
        while ((match = funcRegex.exec(content)) !== null) {
          symbols.add(match[1]);
        }

        // Arrow functions and method definitions
        const methodRegex =
          /(?:(?:const|let|var)\s+)?([a-zA-Z_$][\w$]*)\s*[:=]\s*(?:function|\(.*?\)\s*(?:=>|\{))/g;
        while ((match = methodRegex.exec(content)) !== null) {
          symbols.add(match[1]);
        }

        // TypeScript interfaces and types
        if (language === 'typescript') {
          const interfaceRegex = /\binterface\s+([a-zA-Z_$][\w$]*)/g;
          while ((match = interfaceRegex.exec(content)) !== null) {
            symbols.add(match[1]);
          }

          const typeRegex = /\btype\s+([a-zA-Z_$][\w$]*)\s*=/g;
          while ((match = typeRegex.exec(content)) !== null) {
            symbols.add(match[1]);
          }
        }
        break;
      }

      case 'python': {
        // Functions and classes
        const funcClassRegex =
          /^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)|^\s*class\s+([a-zA-Z_]\w*)/gm;
        let match;
        while ((match = funcClassRegex.exec(content)) !== null) {
          symbols.add(match[1] || match[2]);
        }
        break;
      }

      case 'java': {
        // Classes, interfaces, enums
        const classRegex = /\b(?:class|interface|enum)\s+([a-zA-Z_$][\w$]*)/g;
        let match;
        while ((match = classRegex.exec(content)) !== null) {
          symbols.add(match[1]);
        }

        // Methods
        const methodRegex =
          /(?:public|private|protected|static|final|abstract)(?:\s+\w+)*\s+([a-zA-Z_$][\w$]*)\s*\(/g;
        while ((match = methodRegex.exec(content)) !== null) {
          symbols.add(match[1]);
        }
        break;
      }

      // Add more languages as needed
    }

    return Array.from(symbols);
  }
}
