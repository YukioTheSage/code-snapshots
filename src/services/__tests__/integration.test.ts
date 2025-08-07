/**
 * Integration test for Enhanced Code Chunker
 * This test verifies that the enhanced chunking functionality works end-to-end
 */

import { EnhancedCodeChunker } from '../enhancedCodeChunker';

describe('Enhanced Code Chunker Integration', () => {
  let chunker: EnhancedCodeChunker;

  beforeEach(() => {
    chunker = new EnhancedCodeChunker();
  });

  it('should create enhanced chunks with all required properties', async () => {
    // Test with a simple JavaScript function
    const testCode = `
// Authentication service
import bcrypt from 'bcrypt';

/**
 * Authenticates a user with email and password
 */
function authenticateUser(email, password) {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }
  
  const user = findUserByEmail(email);
  if (!user) {
    return null;
  }
  
  const isValid = bcrypt.compare(password, user.hashedPassword);
  return isValid ? generateToken(user) : null;
}

class UserService {
  constructor(database) {
    this.db = database;
  }
  
  async createUser(userData) {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    return this.db.users.create({
      ...userData,
      hashedPassword
    });
  }
}
`;

    const chunks = await chunker.chunkFileEnhanced(
      'auth.js',
      testCode,
      'test-snapshot',
    );

    expect(chunks.length).toBeGreaterThan(0);

    // Verify chunks have enhanced metadata
    for (const chunk of chunks) {
      expect(chunk.enhancedMetadata).toBeDefined();
      expect(chunk.qualityMetrics).toBeDefined();
      expect(chunk.contextInfo).toBeDefined();
      expect(chunk.relationships).toBeDefined();

      // Verify enhanced metadata properties
      expect(chunk.enhancedMetadata.semanticType).toBeDefined();
      expect(chunk.enhancedMetadata.complexityScore).toBeGreaterThanOrEqual(0);
      expect(
        chunk.enhancedMetadata.maintainabilityIndex,
      ).toBeGreaterThanOrEqual(0);
      expect(chunk.enhancedMetadata.linesOfCode).toBeDefined();

      // Verify quality metrics properties
      expect(chunk.qualityMetrics.overallScore).toBeGreaterThanOrEqual(0);
      expect(chunk.qualityMetrics.readabilityScore).toBeGreaterThanOrEqual(0);
      expect(chunk.qualityMetrics.technicalDebt).toBeDefined();

      // Verify context info properties
      expect(chunk.contextInfo.architecturalLayer).toBeDefined();
      expect(chunk.contextInfo.fileContext).toBeDefined();
    }
  });

  it('should detect semantic types correctly', async () => {
    const functionCode = `
function testFunction() {
  return "test";
}
`;

    const classCode = `
class TestClass {
  constructor() {
    this.value = 42;
  }
}
`;

    const functionChunks = await chunker.chunkFileEnhanced(
      'function.js',
      functionCode,
      'test-snapshot',
    );
    const classChunks = await chunker.chunkFileEnhanced(
      'class.js',
      classCode,
      'test-snapshot',
    );

    expect(
      functionChunks.some(
        (chunk) => chunk.enhancedMetadata.semanticType === 'function',
      ),
    ).toBe(true);
    expect(
      classChunks.some(
        (chunk) => chunk.enhancedMetadata.semanticType === 'class',
      ),
    ).toBe(true);
  });

  it('should calculate complexity scores', async () => {
    const simpleCode = `
function simple() {
  return 1;
}
`;

    const complexCode = `
function complex(x, y) {
  if (x > 0) {
    for (let i = 0; i < y; i++) {
      if (i % 2 === 0) {
        while (x > i) {
          try {
            x = x / 2;
          } catch (error) {
            break;
          }
        }
      }
    }
  }
  return x;
}
`;

    const simpleChunks = await chunker.chunkFileEnhanced(
      'simple.js',
      simpleCode,
      'test-snapshot',
    );
    const complexChunks = await chunker.chunkFileEnhanced(
      'complex.js',
      complexCode,
      'test-snapshot',
    );

    const simpleComplexity =
      simpleChunks[0]?.enhancedMetadata.complexityScore || 0;
    const complexComplexity =
      complexChunks[0]?.enhancedMetadata.complexityScore || 0;

    expect(complexComplexity).toBeGreaterThan(simpleComplexity);
  });
});
