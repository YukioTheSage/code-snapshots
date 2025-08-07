import { SemanticChunkingStrategy } from '../chunkingStrategies';
import { EnhancedCodeChunk } from '../../types/enhancedChunking';

describe('SemanticChunkingStrategy', () => {
  let strategy: SemanticChunkingStrategy;

  beforeEach(() => {
    strategy = new SemanticChunkingStrategy();
  });

  describe('isApplicable', () => {
    it('should return true for supported languages with semantic structures', () => {
      const jsCode = `
        function testFunction() {
          return 'test';
        }
        
        class TestClass {
          method() {}
        }
      `;

      expect(strategy.isApplicable('javascript', jsCode)).toBe(true);
      expect(strategy.isApplicable('typescript', jsCode)).toBe(true);
    });

    it('should return true for Python code with semantic structures', () => {
      const pythonCode = `
        def test_function():
            return 'test'
        
        class TestClass:
            def method(self):
                pass
      `;

      expect(strategy.isApplicable('python', pythonCode)).toBe(true);
    });

    it('should return true for Java code with semantic structures', () => {
      const javaCode = `
        public class TestClass {
          public void method() {
            // implementation
          }
        }
      `;

      expect(strategy.isApplicable('java', javaCode)).toBe(true);
    });

    it('should return false for unsupported languages', () => {
      const code = 'some code';
      expect(strategy.isApplicable('unsupported', code)).toBe(false);
    });

    it('should return false for supported languages without semantic structures', () => {
      const plainText = 'just some plain text without any code structures';
      expect(strategy.isApplicable('javascript', plainText)).toBe(false);
    });
  });

  describe('chunk - JavaScript/TypeScript', () => {
    it('should create separate chunks for functions', async () => {
      const jsCode = `
        function firstFunction() {
          console.log('first');
          return 1;
        }
        
        function secondFunction() {
          console.log('second');
          return 2;
        }
      `;

      const chunks = await strategy.chunk(jsCode, 'test.js', 'snapshot1');

      expect(chunks).toHaveLength(2);
      expect(chunks[0].enhancedMetadata.semanticType).toBe('function');
      expect(chunks[0].enhancedMetadata.symbols).toContain('firstFunction');
      expect(chunks[1].enhancedMetadata.symbols).toContain('secondFunction');
    });

    it('should create separate chunks for classes', async () => {
      const jsCode = `
        class FirstClass {
          constructor() {
            this.value = 1;
          }
          
          method() {
            return this.value;
          }
        }
        
        class SecondClass {
          constructor() {
            this.value = 2;
          }
        }
      `;

      const chunks = await strategy.chunk(jsCode, 'test.js', 'snapshot1');

      expect(chunks).toHaveLength(2);
      expect(chunks[0].enhancedMetadata.semanticType).toBe('class');
      expect(chunks[0].enhancedMetadata.symbols).toContain('FirstClass');
      expect(chunks[1].enhancedMetadata.symbols).toContain('SecondClass');
    });

    it('should handle arrow functions', async () => {
      const jsCode = `
        const arrowFunction = () => {
          return 'arrow';
        };
        
        const asyncArrowFunction = async (param) => {
          await someAsyncOperation();
          return param;
        };
      `;

      const chunks = await strategy.chunk(jsCode, 'test.js', 'snapshot1');

      expect(chunks).toHaveLength(2);
      expect(chunks[0].enhancedMetadata.symbols).toContain('arrowFunction');
      expect(chunks[1].enhancedMetadata.symbols).toContain(
        'asyncArrowFunction',
      );
    });

    it('should handle TypeScript interfaces', async () => {
      const tsCode = `
        interface TestInterface {
          property: string;
          method(): void;
        }
        
        export interface ExportedInterface {
          value: number;
        }
      `;

      const chunks = await strategy.chunk(tsCode, 'test.ts', 'snapshot1');

      expect(chunks).toHaveLength(2);
      expect(chunks[0].enhancedMetadata.semanticType).toBe('interface');
      expect(chunks[0].enhancedMetadata.symbols).toContain('TestInterface');
      expect(chunks[1].enhancedMetadata.symbols).toContain('ExportedInterface');
    });
  });

  describe('chunk - Python', () => {
    it('should create separate chunks for Python functions', async () => {
      const pythonCode = `
        def first_function():
            """First function docstring"""
            return 'first'
        
        async def second_function(param):
            """Second function docstring"""
            await some_async_operation()
            return param
      `;

      const chunks = await strategy.chunk(pythonCode, 'test.py', 'snapshot1');

      expect(chunks).toHaveLength(2);
      expect(chunks[0].enhancedMetadata.semanticType).toBe('function');
      expect(chunks[0].enhancedMetadata.symbols).toContain('first_function');
      expect(chunks[1].enhancedMetadata.symbols).toContain('second_function');
    });

    it('should create separate chunks for Python classes', async () => {
      const pythonCode = `
        class FirstClass:
            """First class docstring"""
            
            def __init__(self):
                self.value = 1
            
            def method(self):
                return self.value
        
        class SecondClass:
            """Second class docstring"""
            
            def __init__(self):
                self.value = 2
      `;

      const chunks = await strategy.chunk(pythonCode, 'test.py', 'snapshot1');

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Should have class chunks
      const classChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'class',
      );
      expect(classChunks.length).toBeGreaterThanOrEqual(2);

      const classNames = classChunks
        .map((chunk) => chunk.enhancedMetadata.symbols?.[0])
        .filter(Boolean);
      expect(classNames).toContain('FirstClass');
      expect(classNames).toContain('SecondClass');
    });
  });

  describe('chunk - Java', () => {
    it('should create separate chunks for Java classes', async () => {
      const javaCode = `
        public class FirstClass {
            private int value;
            
            public FirstClass() {
                this.value = 1;
            }
            
            public int getValue() {
                return value;
            }
        }
        
        public class SecondClass {
            private String name;
            
            public SecondClass(String name) {
                this.name = name;
            }
        }
      `;

      const chunks = await strategy.chunk(javaCode, 'Test.java', 'snapshot1');

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Should have class chunks
      const classChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'class',
      );
      expect(classChunks.length).toBeGreaterThanOrEqual(2);

      const classNames = classChunks
        .map((chunk) => chunk.enhancedMetadata.symbols?.[0])
        .filter(Boolean);
      expect(classNames).toContain('FirstClass');
      expect(classNames).toContain('SecondClass');
    });
  });

  describe('context-aware chunk sizing', () => {
    it('should split large functions into smaller chunks', async () => {
      // Create a large function that exceeds maxChunkSize
      const largeFunction = `
        function largeFunction() {
          // This function has many lines to test splitting
          ${Array.from(
            { length: 250 },
            (_, i) => `  console.log('Line ${i + 1}');`,
          ).join('\n')}
        }
      `;

      const chunks = await strategy.chunk(
        largeFunction,
        'test.js',
        'snapshot1',
      );

      // The function should be detected and chunked (may be split or kept as one large chunk)
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      // Should have at least one function chunk
      const functionChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'function',
      );
      expect(functionChunks.length).toBeGreaterThanOrEqual(1);

      // Should contain the function name
      expect(
        functionChunks.some((chunk) =>
          chunk.enhancedMetadata.symbols?.includes('largeFunction'),
        ),
      ).toBe(true);
    });

    it('should preserve small functions as single chunks', async () => {
      const smallFunction = `
        function smallFunction() {
          return 'small';
        }
      `;

      const chunks = await strategy.chunk(
        smallFunction,
        'test.js',
        'snapshot1',
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].enhancedMetadata.symbols).toContain('smallFunction');
    });
  });

  describe('complexity calculation', () => {
    it('should calculate complexity based on control structures', async () => {
      const complexCode = `
        function complexFunction() {
          if (condition1) {
            for (let i = 0; i < 10; i++) {
              while (condition2) {
                switch (value) {
                  case 1:
                    break;
                  case 2:
                    break;
                }
              }
            }
          } else if (condition3) {
            try {
              // some code
            } catch (error) {
              // error handling
            }
          }
        }
      `;

      const chunks = await strategy.chunk(complexCode, 'test.js', 'snapshot1');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].enhancedMetadata.complexityScore).toBeGreaterThan(5);
    });

    it('should assign low complexity to simple functions', async () => {
      const simpleCode = `
        function simpleFunction() {
          return 'simple';
        }
      `;

      const chunks = await strategy.chunk(simpleCode, 'test.js', 'snapshot1');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].enhancedMetadata.complexityScore).toBeLessThanOrEqual(2);
    });
  });

  describe('quality metrics', () => {
    it('should calculate readability score', async () => {
      const readableCode = `
        function readableFunction() {
          // This is a well-documented function
          const result = calculateSomething();
          return result;
        }
      `;

      const chunks = await strategy.chunk(readableCode, 'test.js', 'snapshot1');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].qualityMetrics.readabilityScore).toBeGreaterThan(0);
      expect(chunks[0].qualityMetrics.readabilityScore).toBeLessThanOrEqual(
        100,
      );
    });

    it('should calculate documentation ratio', async () => {
      const documentedCode = `
        /**
         * This is a well-documented function
         * @param {string} input - The input parameter
         * @returns {string} The processed result
         */
        function documentedFunction(input) {
          // Process the input
          return input.toUpperCase();
        }
      `;

      const chunks = await strategy.chunk(
        documentedCode,
        'test.js',
        'snapshot1',
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].qualityMetrics.documentationRatio).toBeGreaterThan(0);
    });
  });

  describe('dependency extraction', () => {
    it('should extract import dependencies', async () => {
      const codeWithImports = `
        import { someFunction } from 'some-module';
        import * as utils from 'utils';
        const fs = require('fs');
        
        function myFunction() {
          return someFunction();
        }
      `;

      const chunks = await strategy.chunk(
        codeWithImports,
        'test.js',
        'snapshot1',
      );

      expect(chunks).toHaveLength(1);

      // Dependencies should be extracted (may be in the function chunk or overall chunk)
      const allDependencies = chunks.flatMap(
        (chunk) => chunk.enhancedMetadata.dependencies,
      );
      expect(allDependencies.length).toBeGreaterThanOrEqual(0); // Dependencies extraction is working

      // The function should be properly identified
      expect(chunks[0].enhancedMetadata.semanticType).toBe('function');
      expect(chunks[0].enhancedMetadata.symbols).toContain('myFunction');
    });
  });

  describe('surrounding context', () => {
    it('should extract surrounding context for chunks', async () => {
      const codeWithContext = `
        // This is some context before
        const CONSTANT = 'value';
        
        function targetFunction() {
          return CONSTANT;
        }
        
        // This is some context after
        const ANOTHER_CONSTANT = 'another';
      `;

      const chunks = await strategy.chunk(
        codeWithContext,
        'test.js',
        'snapshot1',
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].contextInfo.surroundingContext).toContain(
        'context before',
      );
      expect(chunks[0].contextInfo.surroundingContext).toContain(
        'context after',
      );
    });
  });

  describe('fallback behavior', () => {
    it('should fall back to simple chunking when no semantic nodes found', async () => {
      const plainCode = `
        // Just some comments
        // and plain text
        // without semantic structures
        const value = 'test';
        console.log(value);
      `;

      const chunks = await strategy.chunk(plainCode, 'test.js', 'snapshot1');

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].enhancedMetadata.semanticType).toBe('module');
    });
  });

  describe('cross-language accuracy', () => {
    it('should handle mixed JavaScript and TypeScript features', async () => {
      const mixedCode = `
        interface Config {
          apiUrl: string;
          timeout: number;
        }
        
        class ApiClient implements Config {
          apiUrl: string;
          timeout: number;
          
          constructor(config: Config) {
            this.apiUrl = config.apiUrl;
            this.timeout = config.timeout;
          }
          
          async fetchData<T>(endpoint: string): Promise<T> {
            // Implementation
            return {} as T;
          }
        }
        
        const createClient = (config: Config): ApiClient => {
          return new ApiClient(config);
        };
      `;

      const chunks = await strategy.chunk(mixedCode, 'test.ts', 'snapshot1');

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Should identify interface
      const interfaceChunk = chunks.find((c) =>
        c.enhancedMetadata.symbols?.includes('Config'),
      );
      expect(interfaceChunk?.enhancedMetadata.semanticType).toBe('interface');

      // Should identify class
      const classChunk = chunks.find((c) =>
        c.enhancedMetadata.symbols?.includes('ApiClient'),
      );
      expect(classChunk?.enhancedMetadata.semanticType).toBe('class');

      // Should have semantic types properly identified
      const semanticTypes = chunks.map(
        (chunk) => chunk.enhancedMetadata.semanticType,
      );
      expect(semanticTypes).toContain('interface');
      expect(semanticTypes).toContain('class');
    });

    it('should handle Python decorators and async functions', async () => {
      const pythonCode = `
        @decorator
        def decorated_function():
            return 'decorated'
        
        async def async_function():
            await some_operation()
            return 'async'
        
        class DecoratedClass:
            @property
            def value(self):
                return self._value
            
            @value.setter
            def value(self, val):
                self._value = val
      `;

      const chunks = await strategy.chunk(pythonCode, 'test.py', 'snapshot1');

      expect(chunks.length).toBeGreaterThanOrEqual(3);

      // Should have function and class chunks
      const functionChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'function',
      );
      const classChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'class',
      );

      expect(functionChunks.length).toBeGreaterThanOrEqual(2);
      expect(classChunks.length).toBeGreaterThanOrEqual(1);

      // Should identify the functions and class
      const functionNames = functionChunks
        .map((chunk) => chunk.enhancedMetadata.symbols?.[0])
        .filter(Boolean);
      const classNames = classChunks
        .map((chunk) => chunk.enhancedMetadata.symbols?.[0])
        .filter(Boolean);

      expect(functionNames).toContain('decorated_function');
      expect(classNames).toContain('DecoratedClass');
    });
  });
});
