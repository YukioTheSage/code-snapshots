import { HierarchicalChunkingStrategy } from '../chunkingStrategies';
import { EnhancedCodeChunk } from '../../types/enhancedChunking';

describe('HierarchicalChunkingStrategy', () => {
  let strategy: HierarchicalChunkingStrategy;

  beforeEach(() => {
    strategy = new HierarchicalChunkingStrategy();
  });

  describe('isApplicable', () => {
    it('should return true for languages with nested structures', () => {
      const nestedJSCode = `
        class OuterClass {
          constructor() {
            this.inner = new InnerClass();
          }
          
          class InnerClass {
            method() {
              function nestedFunction() {
                return "nested";
              }
              return nestedFunction();
            }
          }
        }
      `;

      expect(strategy.isApplicable('javascript', nestedJSCode)).toBe(true);
      expect(strategy.isApplicable('typescript', nestedJSCode)).toBe(true);
    });

    it('should return true for Python with nested structures', () => {
      const nestedPythonCode = `
        class OuterClass:
            def __init__(self):
                self.value = 1
                
            class InnerClass:
                def __init__(self):
                    self.inner_value = 2
                    
                def inner_method(self):
                    def nested_function():
                        return "nested"
                    return nested_function()
      `;

      expect(strategy.isApplicable('python', nestedPythonCode)).toBe(true);
    });

    it('should return true for Java with nested structures', () => {
      const nestedJavaCode = `
        public class OuterClass {
            private int value;
            
            public OuterClass() {
                this.value = 1;
            }
            
            public class InnerClass {
                private String name;
                
                public void innerMethod() {
                    // nested logic
                    if (value > 0) {
                        for (int i = 0; i < value; i++) {
                            System.out.println(i);
                        }
                    }
                }
            }
        }
      `;

      expect(strategy.isApplicable('java', nestedJavaCode)).toBe(true);
    });

    it('should return false for unsupported languages', () => {
      const code = 'some code';
      expect(strategy.isApplicable('unsupported', code)).toBe(false);
    });

    it('should return false for supported languages without significant nesting', () => {
      const flatCode = `
        function simpleFunction() {
          return 'simple';
        }
        
        const variable = 'value';
      `;

      expect(strategy.isApplicable('javascript', flatCode)).toBe(false);
    });
  });

  describe('chunk - JavaScript/TypeScript hierarchical structures', () => {
    it('should create hierarchical chunks for nested classes', async () => {
      const nestedCode = `
        class OuterClass {
          constructor() {
            this.value = 1;
          }
          
          outerMethod() {
            return this.value;
          }
          
          class InnerClass {
            constructor() {
              this.innerValue = 2;
            }
            
            innerMethod() {
              return this.innerValue;
            }
          }
        }
      `;

      const chunks = await strategy.chunk(nestedCode, 'nested.js', 'snapshot1');

      expect(chunks.length).toBeGreaterThan(0);

      // Should have chunks at different hierarchy levels
      const levels = chunks.map((chunk) => {
        const match = chunk.id.match(/_L(\d+)/);
        return match ? parseInt(match[1]) : 0;
      });

      expect(Math.max(...levels)).toBeGreaterThan(0);

      // Should have parent-child relationships
      const hasHierarchicalRelationships = chunks.some((chunk) =>
        chunk.relationships.some(
          (rel) => rel.type === 'extends' || rel.type === 'uses',
        ),
      );
      expect(hasHierarchicalRelationships).toBe(true);
    });

    it('should create hierarchical chunks for nested functions', async () => {
      const nestedCode = `
        function outerFunction() {
          const outerVar = 'outer';
          
          function innerFunction() {
            const innerVar = 'inner';
            
            function deeplyNestedFunction() {
              return outerVar + innerVar;
            }
            
            return deeplyNestedFunction();
          }
          
          return innerFunction();
        }
      `;

      const chunks = await strategy.chunk(nestedCode, 'nested.js', 'snapshot1');

      expect(chunks.length).toBeGreaterThan(1);

      // Should identify different function levels
      const functionChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'function',
      );
      expect(functionChunks.length).toBeGreaterThan(1);

      // Should have hierarchical relationships
      const hasParentChildRelationships = chunks.some(
        (chunk) => chunk.relationships.length > 0,
      );
      expect(hasParentChildRelationships).toBe(true);
    });
  });

  describe('chunk - Python hierarchical structures', () => {
    it('should create hierarchical chunks for nested Python classes', async () => {
      const pythonCode = `
        class OuterClass:
            def __init__(self):
                self.value = 1
                
            def outer_method(self):
                return self.value
                
            class InnerClass:
                def __init__(self):
                    self.inner_value = 2
                    
                def inner_method(self):
                    def nested_function():
                        return "nested"
                    return nested_function()
      `;

      const chunks = await strategy.chunk(pythonCode, 'nested.py', 'snapshot1');

      expect(chunks.length).toBeGreaterThan(0);

      // Should have class chunks
      const classChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'class',
      );
      expect(classChunks.length).toBeGreaterThanOrEqual(1);

      // Should have method chunks
      const methodChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'function',
      );
      expect(methodChunks.length).toBeGreaterThan(0);
    });

    it('should handle Python indentation-based nesting', async () => {
      const pythonCode = `
        class Container:
            def __init__(self):
                self.items = []
                
            def add_item(self, item):
                if item is not None:
                    if isinstance(item, str):
                        self.items.append(item.strip())
                    else:
                        self.items.append(str(item))
                        
            def process_items(self):
                for item in self.items:
                    if len(item) > 0:
                        yield item.upper()
      `;

      const chunks = await strategy.chunk(
        pythonCode,
        'container.py',
        'snapshot1',
      );

      expect(chunks.length).toBeGreaterThan(0);

      // Should properly handle indentation levels
      const complexityScores = chunks.map(
        (chunk) => chunk.enhancedMetadata.complexityScore,
      );
      expect(Math.max(...complexityScores)).toBeGreaterThan(1);
    });
  });

  describe('chunk - Java hierarchical structures', () => {
    it('should create hierarchical chunks for Java nested classes', async () => {
      const javaCode = `
        public class OuterClass {
            private int value;
            
            public OuterClass(int value) {
                this.value = value;
            }
            
            public int getValue() {
                return value;
            }
            
            public class InnerClass {
                private String name;
                
                public InnerClass(String name) {
                    this.name = name;
                }
                
                public String getName() {
                    return name;
                }
                
                public String getFullInfo() {
                    return name + ": " + value;
                }
            }
            
            public static class StaticNestedClass {
                private boolean flag;
                
                public StaticNestedClass(boolean flag) {
                    this.flag = flag;
                }
                
                public boolean getFlag() {
                    return flag;
                }
            }
        }
      `;

      const chunks = await strategy.chunk(javaCode, 'Nested.java', 'snapshot1');

      expect(chunks.length).toBeGreaterThan(0);

      // Should have class chunks at different levels
      const classChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'class',
      );
      expect(classChunks.length).toBeGreaterThanOrEqual(1);

      // Should detect hierarchical patterns
      const hasCompositePattern = chunks.some((chunk) =>
        chunk.enhancedMetadata.designPatterns.includes('Composite'),
      );
      expect(hasCompositePattern).toBe(true);
    });
  });

  describe('hierarchical complexity calculation', () => {
    it('should calculate higher complexity for deeply nested structures', async () => {
      const deeplyNestedCode = `
        class Level1 {
          method1() {
            class Level2 {
              method2() {
                class Level3 {
                  method3() {
                    if (true) {
                      for (let i = 0; i < 10; i++) {
                        while (i > 0) {
                          console.log(i);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        deeplyNestedCode,
        'deep.js',
        'snapshot1',
      );

      // Should have varying complexity scores based on nesting level
      const complexityScores = chunks.map(
        (chunk) => chunk.enhancedMetadata.complexityScore,
      );
      expect(Math.max(...complexityScores)).toBeGreaterThan(3);

      // Deeper nested chunks should have higher complexity
      const deepestChunk = chunks.find(
        (chunk) => chunk.id.includes('_L2') || chunk.id.includes('_L3'),
      );
      if (deepestChunk) {
        expect(deepestChunk.enhancedMetadata.complexityScore).toBeGreaterThan(
          2,
        );
      }
    });

    it('should assign appropriate complexity based on nesting level and content', async () => {
      const moderatelyNestedCode = `
        class Parent {
          constructor() {
            this.children = [];
          }
          
          addChild(child) {
            this.children.push(child);
          }
          
          class Child {
            constructor(name) {
              this.name = name;
            }
            
            getName() {
              return this.name;
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        moderatelyNestedCode,
        'moderate.js',
        'snapshot1',
      );

      // Should have reasonable complexity scores
      chunks.forEach((chunk) => {
        expect(chunk.enhancedMetadata.complexityScore).toBeGreaterThan(0);
        expect(chunk.enhancedMetadata.complexityScore).toBeLessThan(20);
      });
    });
  });

  describe('hierarchical relationships', () => {
    it('should create parent-child relationships between nested structures', async () => {
      const hierarchicalCode = `
        class Container {
          constructor() {
            this.items = new Map();
          }
          
          class Item {
            constructor(id, value) {
              this.id = id;
              this.value = value;
            }
            
            getValue() {
              return this.value;
            }
            
            class ItemMetadata {
              constructor(item) {
                this.createdAt = new Date();
                this.itemId = item.id;
              }
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        hierarchicalCode,
        'hierarchy.js',
        'snapshot1',
      );

      // Should have parent-child relationships
      const parentRelationships = chunks.filter((chunk) =>
        chunk.relationships.some((rel) => rel.type === 'extends'),
      );
      expect(parentRelationships.length).toBeGreaterThan(0);

      // Should have child relationships
      const childRelationships = chunks.filter((chunk) =>
        chunk.relationships.some((rel) => rel.type === 'uses'),
      );
      expect(childRelationships.length).toBeGreaterThan(0);

      // Relationships should have meaningful descriptions
      const relationshipDescriptions = chunks.flatMap((chunk) =>
        chunk.relationships.map((rel) => rel.description),
      );
      expect(
        relationshipDescriptions.some((desc) => desc.includes('Child of')),
      ).toBe(true);
    });

    it('should maintain relationship strength based on nesting proximity', async () => {
      const nestedCode = `
        class Outer {
          outerMethod() {
            class DirectChild {
              childMethod() {
                class GrandChild {
                  grandChildMethod() {
                    return 'deep';
                  }
                }
              }
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        nestedCode,
        'strength.js',
        'snapshot1',
      );

      // Direct parent-child relationships should have higher strength
      const directRelationships = chunks.filter((chunk) =>
        chunk.relationships.some((rel) => rel.strength >= 0.8),
      );
      expect(directRelationships.length).toBeGreaterThan(0);
    });
  });

  describe('hierarchical context extraction', () => {
    it('should extract hierarchical context including parent and children info', async () => {
      const contextCode = `
        class DocumentProcessor {
          constructor() {
            this.processors = [];
          }
          
          class TextProcessor {
            process(text) {
              return text.trim();
            }
            
            class WordProcessor {
              processWords(words) {
                return words.filter(w => w.length > 0);
              }
            }
          }
          
          class ImageProcessor {
            process(image) {
              return image.resize(100, 100);
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        contextCode,
        'context.js',
        'snapshot1',
      );

      // Should have context information about hierarchy
      const contextsWithHierarchy = chunks.filter(
        (chunk) =>
          chunk.contextInfo.surroundingContext.includes('Parent:') ||
          chunk.contextInfo.surroundingContext.includes('Children:'),
      );
      expect(contextsWithHierarchy.length).toBeGreaterThan(0);
    });

    it('should determine architectural layers based on hierarchical structure', async () => {
      const layeredCode = `
        class UserController {
          constructor() {
            this.userService = new UserService();
          }
          
          class UserService {
            constructor() {
              this.userRepository = new UserRepository();
            }
            
            class UserRepository {
              findById(id) {
                return this.database.query('SELECT * FROM users WHERE id = ?', [id]);
              }
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        layeredCode,
        'layers.js',
        'snapshot1',
      );

      // Should identify different architectural layers
      const architecturalLayers = chunks.map(
        (chunk) => chunk.contextInfo.architecturalLayer,
      );
      const uniqueLayers = [...new Set(architecturalLayers)];

      expect(uniqueLayers.length).toBeGreaterThanOrEqual(1);
      expect(architecturalLayers).toContain('presentation');
    });
  });

  describe('design pattern detection', () => {
    it('should detect Composite pattern in hierarchical structures', async () => {
      const compositeCode = `
        class Component {
          constructor() {
            this.children = [];
          }
          
          add(component) {
            this.children.push(component);
          }
          
          class Leaf {
            operation() {
              return 'leaf operation';
            }
          }
          
          class Composite {
            constructor() {
              super();
              this.children = [];
            }
            
            operation() {
              return this.children.map(child => child.operation()).join(', ');
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        compositeCode,
        'composite.js',
        'snapshot1',
      );

      // Should detect Composite pattern
      const compositePatterns = chunks.filter((chunk) =>
        chunk.enhancedMetadata.designPatterns.includes('Composite'),
      );
      expect(compositePatterns.length).toBeGreaterThan(0);
    });

    it('should detect nested structure patterns', async () => {
      const deeplyNestedCode = `
        class Level1 {
          class Level2 {
            class Level3 {
              class Level4 {
                deepMethod() {
                  return 'very deep';
                }
              }
            }
          }
        }
      `;

      const chunks = await strategy.chunk(
        deeplyNestedCode,
        'deep-pattern.js',
        'snapshot1',
      );

      // Should detect nested structure pattern
      const nestedPatterns = chunks.filter((chunk) =>
        chunk.enhancedMetadata.designPatterns.includes('Nested Structure'),
      );
      expect(nestedPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('cross-language hierarchical support', () => {
    it('should handle C# nested classes', async () => {
      const csharpCode = `
        public class OuterClass
        {
            private int value;
            
            public OuterClass(int value)
            {
                this.value = value;
            }
            
            public class InnerClass
            {
                private string name;
                
                public InnerClass(string name)
                {
                    this.name = name;
                }
                
                public string GetName()
                {
                    return name;
                }
            }
        }
      `;

      const chunks = await strategy.chunk(csharpCode, 'Nested.cs', 'snapshot1');

      expect(chunks.length).toBeGreaterThan(0);

      // Should handle C# syntax
      const classChunks = chunks.filter(
        (chunk) => chunk.enhancedMetadata.semanticType === 'class',
      );
      expect(classChunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should maintain consistency across different languages', async () => {
      const jsCode = `
        class Outer {
          class Inner {
            method() { return 'js'; }
          }
        }
      `;

      const pythonCode = `
        class Outer:
            class Inner:
                def method(self):
                    return 'python'
      `;

      const jsChunks = await strategy.chunk(jsCode, 'test.js', 'snapshot1');
      const pythonChunks = await strategy.chunk(
        pythonCode,
        'test.py',
        'snapshot1',
      );

      // Both should create hierarchical structures
      expect(jsChunks.length).toBeGreaterThan(0);
      expect(pythonChunks.length).toBeGreaterThan(0);

      // Both should have similar relationship patterns
      const jsHasRelationships = jsChunks.some(
        (chunk) => chunk.relationships.length > 0,
      );
      const pythonHasRelationships = pythonChunks.some(
        (chunk) => chunk.relationships.length > 0,
      );

      expect(jsHasRelationships).toBe(pythonHasRelationships);
    });
  });
});
