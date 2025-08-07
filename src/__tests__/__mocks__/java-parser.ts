// Mock for java-parser module to avoid ES module issues in Jest

export interface CstNode {
  name: string;
  children: CstNode[];
  location?: {
    startLine: number;
    endLine: number;
  };
}

export function parse(content: string): CstNode {
  // Simple mock that returns a basic AST structure
  return {
    name: 'CompilationUnit',
    children: [
      {
        name: 'ClassDeclaration',
        children: [],
        location: {
          startLine: 1,
          endLine: 10,
        },
      },
    ],
  };
}

// Export as default for compatibility
export default {
  parse,
};
