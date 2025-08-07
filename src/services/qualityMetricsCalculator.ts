/**
 * Quality Metrics Calculator
 *
 * Implements comprehensive quality metrics calculation algorithms for code chunks,
 * including readability scores, maintainability index, complexity metrics,
 * code smell detection, and security concern identification.
 */

import {
  QualityMetrics,
  TechnicalDebtMetrics,
  TechnicalDebtIssue,
  TechnicalDebtCategory,
  LinesOfCodeMetrics,
  EnhancedCodeChunk,
} from '../types/enhancedChunking';

/**
 * Configuration for quality metrics calculation
 */
export interface QualityMetricsConfig {
  /** Weight for different quality factors (0-1) */
  weights: {
    readability: number;
    complexity: number;
    maintainability: number;
    documentation: number;
    testCoverage: number;
    security: number;
  };

  /** Thresholds for quality assessments */
  thresholds: {
    highComplexity: number;
    lowMaintainability: number;
    lowDocumentation: number;
    highDuplication: number;
    highSecurityRisk: number;
  };

  /** Language-specific configurations */
  languageConfig: Record<string, LanguageConfig>;
}

/**
 * Language-specific configuration
 */
export interface LanguageConfig {
  /** Keywords that indicate complexity */
  complexityKeywords: string[];

  /** Patterns that indicate code smells */
  codeSmellPatterns: RegExp[];

  /** Security-sensitive patterns */
  securityPatterns: RegExp[];

  /** Comment patterns */
  commentPatterns: {
    singleLine: RegExp;
    multiLineStart: RegExp;
    multiLineEnd: RegExp;
  };
}

/**
 * Default configuration for quality metrics
 */
const DEFAULT_CONFIG: QualityMetricsConfig = {
  weights: {
    readability: 0.25,
    complexity: 0.2,
    maintainability: 0.2,
    documentation: 0.15,
    testCoverage: 0.1,
    security: 0.1,
  },
  thresholds: {
    highComplexity: 15,
    lowMaintainability: 30,
    lowDocumentation: 0.1,
    highDuplication: 70,
    highSecurityRisk: 60,
  },
  languageConfig: {
    javascript: {
      complexityKeywords: [
        'if',
        'else',
        'for',
        'while',
        'switch',
        'case',
        'catch',
        'try',
      ],
      codeSmellPatterns: [
        /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{500,}\}/g, // Long functions
        /var\s+\w+/g, // Use of var instead of let/const
        /==\s*null|!=\s*null/g, // Loose equality with null
        /console\.log/g, // Console.log statements
      ],
      securityPatterns: [
        /eval\s*\(/g, // eval usage
        /innerHTML\s*=/g, // innerHTML assignment
        /document\.write/g, // document.write usage
        /setTimeout\s*\(\s*["']/g, // setTimeout with string
      ],
      commentPatterns: {
        singleLine: /\/\/.*/g,
        multiLineStart: /\/\*/g,
        multiLineEnd: /\*\//g,
      },
    },
    typescript: {
      complexityKeywords: [
        'if',
        'else',
        'for',
        'while',
        'switch',
        'case',
        'catch',
        'try',
      ],
      codeSmellPatterns: [
        /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{500,}\}/g,
        /any\s+\w+/g, // Use of any type
        /console\.log/g,
        /@ts-ignore/g, // TypeScript ignore comments
      ],
      securityPatterns: [
        /eval\s*\(/g,
        /innerHTML\s*=/g,
        /document\.write/g,
        /setTimeout\s*\(\s*["']/g,
      ],
      commentPatterns: {
        singleLine: /\/\/.*/g,
        multiLineStart: /\/\*/g,
        multiLineEnd: /\*\//g,
      },
    },
    python: {
      complexityKeywords: [
        'if',
        'elif',
        'else',
        'for',
        'while',
        'try',
        'except',
        'with',
      ],
      codeSmellPatterns: [
        /def\s+\w+\s*\([^)]*\):\s*[\s\S]{500,}(?=\ndef|\nclass|\n\S|$)/g, // Long functions
        /except:\s*$/gm, // Bare except clauses
        /global\s+\w+/g, // Global variables
        /print\s*\(/g, // Print statements (should use logging)
      ],
      securityPatterns: [
        /eval\s*\(/g,
        /exec\s*\(/g,
        /input\s*\(/g, // Raw input (Python 2 style)
        /pickle\.loads/g, // Unsafe pickle usage
        /subprocess\.call.*shell\s*=\s*True/g, // Shell injection risk
      ],
      commentPatterns: {
        singleLine: /#.*/g,
        multiLineStart: /"""|'''/g,
        multiLineEnd: /"""|'''/g,
      },
    },
    java: {
      complexityKeywords: [
        'if',
        'else',
        'for',
        'while',
        'switch',
        'case',
        'catch',
        'try',
      ],
      codeSmellPatterns: [
        /public\s+\w+\s+\w+\s*\([^)]*\)\s*\{[\s\S]{500,}\}/g, // Long methods
        /System\.out\.print/g, // System.out usage
        /catch\s*\([^)]*\)\s*\{\s*\}/g, // Empty catch blocks
        /public\s+class\s+\w+\s*\{[\s\S]{2000,}\}/g, // Large classes
      ],
      securityPatterns: [
        /Runtime\.getRuntime\(\)\.exec/g, // Runtime.exec usage
        /Class\.forName/g, // Dynamic class loading
        /Statement\.execute/g, // SQL execution without prepared statements
        /MessageDigest\.getInstance\("MD5"\)/g, // Weak hash algorithm
      ],
      commentPatterns: {
        singleLine: /\/\/.*/g,
        multiLineStart: /\/\*/g,
        multiLineEnd: /\*\//g,
      },
    },
  },
};

/**
 * Quality metrics calculator class
 */
export class QualityMetricsCalculator {
  private config: QualityMetricsConfig;

  constructor(config: Partial<QualityMetricsConfig> = {}) {
    this.config = this.mergeConfig(DEFAULT_CONFIG, config);
  }

  /**
   * Calculate comprehensive quality metrics for a code chunk
   */
  async calculateQualityMetrics(
    content: string,
    language: string,
    linesOfCode: LinesOfCodeMetrics,
    testCoverage?: number,
  ): Promise<QualityMetrics> {
    // Calculate individual metrics
    const readabilityScore = this.calculateReadabilityScore(content, language);
    const complexityScore = this.calculateComplexityScore(content, language);
    const maintainabilityScore = this.calculateMaintainabilityIndex(
      content,
      language,
      complexityScore,
      readabilityScore,
    );
    const documentationRatio = this.calculateDocumentationRatio(linesOfCode);
    const duplicationRisk = this.calculateDuplicationRisk(content, language);
    const performanceRisk = this.calculatePerformanceRisk(content, language);
    const securityRisk = this.calculateSecurityRisk(content, language);
    const technicalDebt = await this.calculateTechnicalDebt(content, language);
    const styleComplianceScore = this.calculateStyleCompliance(
      content,
      language,
    );

    // Calculate overall score
    const overallScore = this.calculateOverallScore({
      readabilityScore,
      complexityScore: 100 - complexityScore, // Invert complexity (lower is better)
      maintainabilityScore,
      documentationRatio: documentationRatio * 100,
      testCoverage: testCoverage || 0,
      securityRisk: 100 - securityRisk, // Invert security risk (lower is better)
    });

    return {
      overallScore,
      readabilityScore,
      testCoverage,
      documentationRatio,
      duplicationRisk,
      performanceRisk,
      securityRisk,
      maintainabilityScore,
      technicalDebt,
      styleComplianceScore,
    };
  }

  /**
   * Calculate readability score based on various factors
   */
  private calculateReadabilityScore(content: string, language: string): number {
    const lines = content.split('\n');
    let score = 100;

    // Factor 1: Average line length
    const avgLineLength =
      lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
    if (avgLineLength > 120) score -= 10;
    else if (avgLineLength > 80) score -= 5;

    // Factor 2: Nesting depth
    const maxNestingDepth = this.calculateMaxNestingDepth(content, language);
    if (maxNestingDepth > 5) score -= 15;
    else if (maxNestingDepth > 3) score -= 8;

    // Factor 3: Function/method length
    const avgFunctionLength = this.calculateAverageFunctionLength(
      content,
      language,
    );
    if (avgFunctionLength > 50) score -= 15;
    else if (avgFunctionLength > 30) score -= 8;

    // Factor 4: Variable naming quality
    const namingScore = this.calculateNamingQuality(content, language);
    score += (namingScore - 50) * 0.3; // Adjust based on naming quality

    // Factor 5: Comment quality
    const commentQuality = this.calculateCommentQuality(content, language);
    score += (commentQuality - 50) * 0.2;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate complexity score using cyclomatic complexity and other factors
   */
  private calculateComplexityScore(content: string, language: string): number {
    const langConfig = this.config.languageConfig[language];
    if (!langConfig) return 10; // Default complexity for unknown languages

    let complexity = 1; // Base complexity

    // Count complexity-inducing keywords
    langConfig.complexityKeywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = content.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    });

    // Add complexity for logical operators
    const logicalOperators = content.match(/&&|\|\||and\s+|or\s+/g);
    if (logicalOperators) {
      complexity += logicalOperators.length;
    }

    // Add complexity for nested structures
    const nestingDepth = this.calculateMaxNestingDepth(content, language);
    complexity += Math.max(0, nestingDepth - 2) * 2;

    // Convert to 0-100 scale (higher = more complex)
    return Math.min(100, complexity * 3);
  }

  /**
   * Calculate maintainability index
   */
  private calculateMaintainabilityIndex(
    content: string,
    language: string,
    complexityScore: number,
    readabilityScore: number,
  ): number {
    const linesOfCode = content.split('\n').length;
    const commentRatio = this.calculateCommentRatio(content, language);

    // Simplified maintainability index calculation
    // Based on Halstead metrics, cyclomatic complexity, and lines of code
    let maintainability = 100;

    // Penalize high complexity
    maintainability -= complexityScore * 0.3;

    // Penalize large code size
    if (linesOfCode > 100) maintainability -= 10;
    else if (linesOfCode > 50) maintainability -= 5;

    // Reward good documentation
    maintainability += commentRatio * 20;

    // Factor in readability
    maintainability += (readabilityScore - 50) * 0.2;

    return Math.max(0, Math.min(100, maintainability));
  }

  /**
   * Calculate documentation ratio
   */
  private calculateDocumentationRatio(linesOfCode: LinesOfCodeMetrics): number {
    if (linesOfCode.code === 0) return 0;
    return linesOfCode.comments / (linesOfCode.comments + linesOfCode.code);
  }

  /**
   * Calculate duplication risk
   */
  private calculateDuplicationRisk(content: string, language: string): number {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const lineFrequency: Record<string, number> = {};

    // Count line frequencies
    lines.forEach((line) => {
      if (line.length > 10) {
        // Only consider substantial lines
        lineFrequency[line] = (lineFrequency[line] || 0) + 1;
      }
    });

    // Calculate duplication percentage
    const duplicatedLines = Object.values(lineFrequency).reduce((sum, freq) => {
      return sum + (freq > 1 ? freq - 1 : 0);
    }, 0);

    const duplicationPercentage = (duplicatedLines / lines.length) * 100;
    return Math.min(100, duplicationPercentage * 2); // Scale up for visibility
  }

  /**
   * Calculate performance risk
   */
  private calculatePerformanceRisk(content: string, language: string): number {
    let risk = 0;

    // Language-specific performance anti-patterns
    const performancePatterns: Record<string, RegExp[]> = {
      javascript: [
        /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)/g, // Nested loops
        /document\.getElementById/g, // DOM queries in loops
        /\.innerHTML\s*\+=/g, // String concatenation with innerHTML
        /new\s+RegExp/g, // RegExp in loops
      ],
      python: [
        /for\s+\w+\s+in\s+range\([^)]*\):[^:]*for\s+\w+\s+in\s+range/g, // Nested loops
        /\.append\s*\(/g, // List append in loops (should use list comprehension)
        /\+\s*=.*str/g, // String concatenation
        /global\s+\w+/g, // Global variables
      ],
      java: [
        /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)/g, // Nested loops
        /String\s+\w+\s*=\s*"[^"]*"\s*\+/g, // String concatenation
        /Vector|Hashtable/g, // Legacy collections
        /synchronized\s*\(/g, // Synchronization overhead
      ],
    };

    const patterns = performancePatterns[language] || [];
    patterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        risk += matches.length * 10;
      }
    });

    // Check for algorithmic complexity indicators
    const nestedLoops = content.match(
      /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)/g,
    );
    if (nestedLoops) {
      risk += nestedLoops.length * 20;
    }

    return Math.min(100, risk);
  }

  /**
   * Calculate security risk
   */
  private calculateSecurityRisk(content: string, language: string): number {
    const langConfig = this.config.languageConfig[language];
    if (!langConfig) return 0;

    let risk = 0;

    // Check for security-sensitive patterns
    langConfig.securityPatterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        risk += matches.length * 15;
      }
    });

    // Additional security checks
    const securityIssues = [
      /password|secret|key/i, // Hardcoded credentials
      /http:\/\//g, // Insecure HTTP
      /Math\.random/g, // Weak random number generation
      /md5|sha1/gi, // Weak hash algorithms
    ];

    securityIssues.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        risk += matches.length * 10;
      }
    });

    return Math.min(100, risk);
  }

  /**
   * Calculate technical debt metrics
   */
  private async calculateTechnicalDebt(
    content: string,
    language: string,
  ): Promise<TechnicalDebtMetrics> {
    const issues: TechnicalDebtIssue[] = [];

    // Detect code smells
    const codeSmells = this.detectCodeSmells(content, language);
    issues.push(...codeSmells);

    // Detect security vulnerabilities
    const securityIssues = this.detectSecurityIssues(content, language);
    issues.push(...securityIssues);

    // Detect performance issues
    const performanceIssues = this.detectPerformanceIssues(content, language);
    issues.push(...performanceIssues);

    // Detect maintainability issues
    const maintainabilityIssues = this.detectMaintainabilityIssues(
      content,
      language,
    );
    issues.push(...maintainabilityIssues);

    // Calculate metrics
    const estimatedFixTime = issues.reduce(
      (sum, issue) => sum + (issue.estimatedEffort || 1),
      0,
    );
    const severity = this.calculateOverallSeverity(issues);
    const categories = [...new Set(issues.map((issue) => issue.category))];

    return {
      estimatedFixTime,
      severity,
      categories,
      issues,
    };
  }

  /**
   * Calculate style compliance score
   */
  private calculateStyleCompliance(content: string, language: string): number {
    let score = 100;
    const lines = content.split('\n');

    // Check indentation consistency
    const indentationIssues = this.checkIndentationConsistency(lines);
    score -= indentationIssues * 2;

    // Check naming conventions
    const namingIssues = this.checkNamingConventions(content, language);
    score -= namingIssues * 3;

    // Check line length
    const longLines = lines.filter((line) => line.length > 120).length;
    score -= longLines * 1;

    // Check spacing and formatting
    const spacingIssues = this.checkSpacingIssues(content, language);
    score -= spacingIssues * 1;

    return Math.max(0, score);
  }

  /**
   * Calculate overall quality score
   */
  private calculateOverallScore(metrics: {
    readabilityScore: number;
    complexityScore: number;
    maintainabilityScore: number;
    documentationRatio: number;
    testCoverage: number;
    securityRisk: number;
  }): number {
    const weights = this.config.weights;

    return (
      metrics.readabilityScore * weights.readability +
      metrics.complexityScore * weights.complexity +
      metrics.maintainabilityScore * weights.maintainability +
      metrics.documentationRatio * weights.documentation +
      metrics.testCoverage * weights.testCoverage +
      metrics.securityRisk * weights.security
    );
  }

  // Helper methods for detailed analysis

  private calculateMaxNestingDepth(content: string, language: string): number {
    const lines = content.split('\n');
    let maxDepth = 0;
    let currentDepth = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();

      // Count opening braces/blocks
      const openBraces = (trimmed.match(/\{/g) || []).length;
      const closeBraces = (trimmed.match(/\}/g) || []).length;

      currentDepth += openBraces - closeBraces;
      maxDepth = Math.max(maxDepth, currentDepth);
    });

    return maxDepth;
  }

  private calculateAverageFunctionLength(
    content: string,
    language: string,
  ): number {
    // This is a simplified implementation
    // In practice, you'd use AST parsing for accurate function detection
    const functionPattern =
      language === 'python'
        ? /def\s+\w+.*?(?=\ndef|\nclass|\n\S|$)/gs
        : /function\s+\w+.*?\{.*?\}/gs;

    const functionMatches = content.match(functionPattern);
    if (!functionMatches || functionMatches.length === 0) return 0;

    const totalLines = functionMatches.reduce((sum: number, func: string) => {
      return sum + func.split('\n').length;
    }, 0);

    return totalLines / functionMatches.length;
  }

  private calculateNamingQuality(content: string, language: string): number {
    // Simplified naming quality assessment
    let score = 50;

    // Check for meaningful variable names
    const shortNames = content.match(/\b[a-z]\b/g) || [];
    score -= shortNames.length * 2;

    // Check for descriptive names
    const descriptiveNames = content.match(/\b[a-zA-Z]{5,}\b/g) || [];
    score += Math.min(20, descriptiveNames.length);

    return Math.max(0, Math.min(100, score));
  }

  private calculateCommentQuality(content: string, language: string): number {
    const langConfig = this.config.languageConfig[language];
    if (!langConfig) return 50;

    const comments = content.match(langConfig.commentPatterns.singleLine) || [];
    const meaningfulComments = comments.filter(
      (comment) =>
        comment.length > 20 &&
        !comment.includes('TODO') &&
        !comment.includes('FIXME'),
    );

    return Math.min(
      100,
      (meaningfulComments.length / Math.max(1, comments.length)) * 100,
    );
  }

  private calculateCommentRatio(content: string, language: string): number {
    const langConfig = this.config.languageConfig[language];
    if (!langConfig) return 0;

    const lines = content.split('\n');
    const commentLines = lines.filter((line) =>
      langConfig.commentPatterns.singleLine.test(line.trim()),
    ).length;

    return commentLines / Math.max(1, lines.length);
  }

  private detectCodeSmells(
    content: string,
    language: string,
  ): TechnicalDebtIssue[] {
    const langConfig = this.config.languageConfig[language];
    if (!langConfig) return [];

    const issues: TechnicalDebtIssue[] = [];

    langConfig.codeSmellPatterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(() => {
          issues.push({
            category: 'code_smells',
            description: `Code smell detected: ${pattern.source}`,
            severity: 'medium',
            suggestion: 'Consider refactoring this code pattern',
            estimatedEffort: 2,
          });
        });
      }
    });

    return issues;
  }

  private detectSecurityIssues(
    content: string,
    language: string,
  ): TechnicalDebtIssue[] {
    const langConfig = this.config.languageConfig[language];
    if (!langConfig) return [];

    const issues: TechnicalDebtIssue[] = [];

    langConfig.securityPatterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(() => {
          issues.push({
            category: 'security_vulnerabilities',
            description: `Security concern detected: ${pattern.source}`,
            severity: 'high',
            suggestion:
              'Review for security implications and use safer alternatives',
            estimatedEffort: 4,
          });
        });
      }
    });

    return issues;
  }

  private detectPerformanceIssues(
    content: string,
    language: string,
  ): TechnicalDebtIssue[] {
    const issues: TechnicalDebtIssue[] = [];

    // Detect nested loops
    const nestedLoops = content.match(
      /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)/g,
    );
    if (nestedLoops) {
      nestedLoops.forEach(() => {
        issues.push({
          category: 'performance_issues',
          description: 'Nested loops detected - potential O(n²) complexity',
          severity: 'medium',
          suggestion:
            'Consider optimizing algorithm or using more efficient data structures',
          estimatedEffort: 3,
        });
      });
    }

    return issues;
  }

  private detectMaintainabilityIssues(
    content: string,
    language: string,
  ): TechnicalDebtIssue[] {
    const issues: TechnicalDebtIssue[] = [];
    const lines = content.split('\n');

    // Long functions
    if (lines.length > 50) {
      issues.push({
        category: 'maintainability_issues',
        description: 'Function/method is too long',
        severity: 'medium',
        suggestion: 'Break down into smaller, more focused functions',
        estimatedEffort: 3,
      });
    }

    // High complexity
    const complexity = this.calculateComplexityScore(content, language);
    if (complexity > this.config.thresholds.highComplexity) {
      issues.push({
        category: 'maintainability_issues',
        description: 'High cyclomatic complexity',
        severity: 'high',
        suggestion: 'Simplify control flow and reduce branching',
        estimatedEffort: 4,
      });
    }

    return issues;
  }

  private calculateOverallSeverity(
    issues: TechnicalDebtIssue[],
  ): 'low' | 'medium' | 'high' | 'critical' {
    const severityCounts = {
      critical: issues.filter((i) => i.severity === 'critical').length,
      high: issues.filter((i) => i.severity === 'high').length,
      medium: issues.filter((i) => i.severity === 'medium').length,
      low: issues.filter((i) => i.severity === 'low').length,
    };

    if (severityCounts.critical > 0) return 'critical';
    if (severityCounts.high > 2) return 'critical';
    if (severityCounts.high > 0) return 'high';
    if (severityCounts.medium > 3) return 'high';
    if (severityCounts.medium > 0) return 'medium';
    return 'low';
  }

  private checkIndentationConsistency(lines: string[]): number {
    const indentations = lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.match(/^\s*/)?.[0].length || 0);

    const indentSet = new Set(indentations.filter((indent) => indent > 0));
    return indentSet.size > 3 ? indentSet.size - 3 : 0; // Allow up to 3 different indentation levels
  }

  private checkNamingConventions(content: string, language: string): number {
    let issues = 0;

    // Check for consistent naming patterns
    const variableNames = content.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
    const camelCaseNames = variableNames.filter((name) =>
      /^[a-z][a-zA-Z0-9]*$/.test(name),
    );
    const snake_caseNames = variableNames.filter((name) =>
      /^[a-z][a-z0-9_]*$/.test(name),
    );

    // If both patterns are used significantly, it's inconsistent
    if (camelCaseNames.length > 5 && snake_caseNames.length > 5) {
      issues += 5;
    }

    return issues;
  }

  private checkSpacingIssues(content: string, language: string): number {
    let issues = 0;

    // Check for missing spaces around operators
    const operatorIssues = content.match(/\w[+\-*/=]\w/g) || [];
    issues += operatorIssues.length;

    // Check for multiple consecutive spaces
    const multipleSpaces = content.match(/  +/g) || [];
    issues += multipleSpaces.length;

    return issues;
  }

  private mergeConfig(
    defaultConfig: QualityMetricsConfig,
    userConfig: Partial<QualityMetricsConfig>,
  ): QualityMetricsConfig {
    return {
      weights: { ...defaultConfig.weights, ...userConfig.weights },
      thresholds: { ...defaultConfig.thresholds, ...userConfig.thresholds },
      languageConfig: {
        ...defaultConfig.languageConfig,
        ...userConfig.languageConfig,
      },
    };
  }
}
