import { EnhancedCodeChunker } from '../enhancedCodeChunker';
import { describe, it, expect, beforeEach } from '@jest/globals';

describe('EnhancedCodeChunker', () => {
  let chunker: EnhancedCodeChunker;

  beforeEach(() => {
    chunker = new EnhancedCodeChunker();
  });

  describe('JavaScript/TypeScript chunking', () => {
    it('should create enhanced chunks for JavaScript functions', async () => {
      const content = `
// User authentication service
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

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
  if (!isValid) {
    return null;
  }
  
  return generateToken(user);
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
        content,
        'test-snapshot',
      );

      expect(chunks.length).toBeGreaterThan(0);

      // Check that chunks have enhanced metadata
      for (const chunk of chunks) {
        expect(chunk.enhancedMetadata).toBeDefined();
        expect(chunk.enhancedMetadata.semanticType).toBeDefined();
        expect(chunk.enhancedMetadata.complexityScore).toBeGreaterThan(0);
        expect(
          chunk.enhancedMetadata.maintainabilityIndex,
        ).toBeGreaterThanOrEqual(0);
        expect(chunk.enhancedMetadata.dependencies).toBeDefined();
        expect(Array.isArray(chunk.enhancedMetadata.designPatterns)).toBe(true);
        expect(Array.isArray(chunk.enhancedMetadata.codeSmells)).toBe(true);
        expect(Array.isArray(chunk.enhancedMetadata.securityConcerns)).toBe(
          true,
        );

        expect(chunk.qualityMetrics).toBeDefined();
        expect(chunk.qualityMetrics.readabilityScore).toBeGreaterThanOrEqual(0);
        expect(chunk.qualityMetrics.documentationRatio).toBeGreaterThanOrEqual(
          0,
        );

        expect(chunk.contextInfo).toBeDefined();
        expect(chunk.contextInfo.architecturalLayer).toBeDefined();
        expect(Array.isArray(chunk.contextInfo.frameworkContext)).toBe(true);
      }
    });

    it('should detect semantic types correctly', async () => {
      const functionContent = `
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
`;

      const classContent = `
class ShoppingCart {
  constructor() {
    this.items = [];
  }
  
  addItem(item) {
    this.items.push(item);
  }
}
`;

      const functionChunks = await chunker.chunkFileEnhanced(
        'calc.js',
        functionContent,
        'test',
      );
      const classChunks = await chunker.chunkFileEnhanced(
        'cart.js',
        classContent,
        'test',
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

    it('should detect security concerns', async () => {
      const insecureContent = `
const query = "SELECT * FROM users WHERE id = " + userId;
database.execute(query);

element.innerHTML = userInput;

const password = "hardcoded123";
`;

      const chunks = await chunker.chunkFileEnhanced(
        'insecure.js',
        insecureContent,
        'test',
      );

      const hasSecurityConcerns = chunks.some(
        (chunk) => chunk.enhancedMetadata.securityConcerns.length > 0,
      );
      expect(hasSecurityConcerns).toBe(true);
    });
  });

  describe('Python chunking', () => {
    it('should create enhanced chunks for Python code', async () => {
      const content = `
import os
import hashlib
from datetime import datetime

class UserManager:
    """Manages user operations"""
    
    def __init__(self, database):
        self.db = database
        
    def create_user(self, username, email, password):
        """Create a new user with hashed password"""
        if not username or not email or not password:
            raise ValueError("All fields are required")
            
        hashed_password = hashlib.sha256(password.encode()).hexdigest()
        
        user_data = {
            'username': username,
            'email': email,
            'password': hashed_password,
            'created_at': datetime.now()
        }
        
        return self.db.insert_user(user_data)
    
    def authenticate(self, username, password):
        """Authenticate user credentials"""
        user = self.db.find_user_by_username(username)
        if not user:
            return False
            
        hashed_input = hashlib.sha256(password.encode()).hexdigest()
        return hashed_input == user['password']

def validate_email(email):
    """Simple email validation"""
    return '@' in email and '.' in email
`;

      const chunks = await chunker.chunkFileEnhanced(
        'user_manager.py',
        content,
        'test-snapshot',
      );

      expect(chunks.length).toBeGreaterThan(0);

      // Should detect class and function semantic types
      const semanticTypes = chunks.map(
        (chunk) => chunk.enhancedMetadata.semanticType,
      );
      expect(semanticTypes).toContain('class');
      expect(semanticTypes).toContain('function');

      // Should extract dependencies
      const allDependencies = chunks.flatMap(
        (chunk) => chunk.enhancedMetadata.dependencies,
      );
      expect(allDependencies).toContain('os');
      expect(allDependencies).toContain('hashlib');
      expect(allDependencies).toContain('datetime');
    });
  });

  describe('Quality metrics', () => {
    it('should calculate readability scores', async () => {
      const readableContent = `
/**
 * Calculates the total price including tax
 * @param {number} basePrice - The base price before tax
 * @param {number} taxRate - The tax rate as a decimal
 * @returns {number} The total price including tax
 */
function calculateTotalPrice(basePrice, taxRate) {
  if (basePrice < 0 || taxRate < 0) {
    throw new Error('Price and tax rate must be non-negative');
  }
  
  const taxAmount = basePrice * taxRate;
  const totalPrice = basePrice + taxAmount;
  
  return Math.round(totalPrice * 100) / 100; // Round to 2 decimal places
}
`;

      const unreadableContent = `
function x(a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z){if(a>b){if(c>d){if(e>f){if(g>h){if(i>j){if(k>l){if(m>n){if(o>p){if(q>r){if(s>t){if(u>v){if(w>x){if(y>z){return 1;}else{return 2;}}}}}}}}}}}}}return 0;}
`;

      const readableChunks = await chunker.chunkFileEnhanced(
        'readable.js',
        readableContent,
        'test',
      );
      const unreadableChunks = await chunker.chunkFileEnhanced(
        'unreadable.js',
        unreadableContent,
        'test',
      );

      const readableScore =
        readableChunks[0]?.qualityMetrics.readabilityScore || 0;
      const unreadableScore =
        unreadableChunks[0]?.qualityMetrics.readabilityScore || 0;

      expect(readableScore).toBeGreaterThan(unreadableScore);
    });

    it('should detect code smells', async () => {
      const longMethodContent = `
function processOrder(order) {
  // This is a very long method that does too many things
  ${Array(60).fill('  console.log("Processing step");').join('\n')}
  return order;
}
`;

      const chunks = await chunker.chunkFileEnhanced(
        'long-method.js',
        longMethodContent,
        'test',
      );

      const hasLongMethodSmell = chunks.some((chunk) =>
        chunk.enhancedMetadata.codeSmells.includes('Long Method'),
      );
      expect(hasLongMethodSmell).toBe(true);
    });
  });

  describe('Relationship analysis', () => {
    it('should detect function call relationships', async () => {
      const content = `
function helper() {
  return "helper result";
}

function main() {
  const result = helper();
  return result;
}
`;

      const chunks = await chunker.chunkFileEnhanced(
        'relationships.js',
        content,
        'test',
      );

      // Should have relationships between chunks
      const hasCallRelationships = chunks.some((chunk) =>
        chunk.relationships.some((rel) => rel.type === 'calls'),
      );
      expect(hasCallRelationships).toBe(true);
    });
  });

  describe('Context analysis', () => {
    it('should determine architectural layers', async () => {
      const controllerContent = `
class UserController {
  async getUser(req, res) {
    const user = await this.userService.findById(req.params.id);
    res.json(user);
  }
}
`;

      const serviceContent = `
class UserService {
  async findById(id) {
    return this.userRepository.findById(id);
  }
}
`;

      const repositoryContent = `
class UserRepository {
  async findById(id) {
    return this.database.query('SELECT * FROM users WHERE id = ?', [id]);
  }
}
`;

      const controllerChunks = await chunker.chunkFileEnhanced(
        'user.controller.js',
        controllerContent,
        'test',
      );
      const serviceChunks = await chunker.chunkFileEnhanced(
        'user.service.js',
        serviceContent,
        'test',
      );
      const repositoryChunks = await chunker.chunkFileEnhanced(
        'user.repository.js',
        repositoryContent,
        'test',
      );

      expect(controllerChunks[0]?.contextInfo.architecturalLayer).toBe(
        'presentation',
      );
      expect(serviceChunks[0]?.contextInfo.architecturalLayer).toBe('business');
      expect(repositoryChunks[0]?.contextInfo.architecturalLayer).toBe('data');
    });

    it('should detect framework context', async () => {
      const reactContent = `
import React, { useState, useEffect } from 'react';

function UserProfile() {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    fetchUser();
  }, []);
  
  return <div>{user?.name}</div>;
}
`;

      const chunks = await chunker.chunkFileEnhanced(
        'UserProfile.jsx',
        reactContent,
        'test',
      );

      expect(chunks[0]?.contextInfo.frameworkContext).toContain('React');
    });
  });

  describe('Chunking strategies', () => {
    it('should use semantic chunking for supported languages', async () => {
      const content = `
function first() { return 1; }
function second() { return 2; }
class MyClass { method() { return 3; } }
`;

      const chunks = await chunker.chunkFileEnhanced(
        'test.js',
        content,
        'test',
        'semantic',
      );

      expect(chunks.length).toBeGreaterThan(1); // Should create separate chunks for functions/classes
    });

    it('should use hierarchical chunking for nested structures', async () => {
      const content = `
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

      const chunks = await chunker.chunkFileEnhanced(
        'nested.js',
        content,
        'test',
        'hierarchical',
      );

      expect(chunks.length).toBeGreaterThan(0);
      // Should have relationship information for nested structures
      const hasHierarchicalRelationships = chunks.some((chunk) =>
        chunk.relationships.some(
          (rel) => rel.type === 'extends' || rel.type === 'uses',
        ),
      );
      expect(hasHierarchicalRelationships).toBe(true);
    });
  });
});
