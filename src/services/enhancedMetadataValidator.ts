/**
 * Enhanced Metadata Validator
 *
 * Provides validation utilities for enhanced code chunk metadata,
 * ensuring data integrity and consistency across the chunking system.
 */

import {
  EnhancedCodeChunk,
  EnhancedChunkMetadata,
  QualityMetrics,
  ChunkRelationship,
  ContextInfo,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SemanticType,
  RelationshipType,
  ArchitecturalLayer,
  TechnicalDebtCategory,
} from '../types/enhancedChunking';

/**
 * Validator class for enhanced metadata structures
 */
export class EnhancedMetadataValidator {
  private static readonly VALID_SEMANTIC_TYPES: SemanticType[] = [
    'function',
    'class',
    'interface',
    'type',
    'enum',
    'module',
    'config',
    'test',
    'documentation',
    'constant',
    'utility',
    'component',
    'service',
    'model',
    'controller',
    'middleware',
    'route',
    'schema',
    'migration',
    'fixture',
    'script',
    'other',
  ];

  private static readonly VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
    'calls',
    'imports',
    'extends',
    'implements',
    'uses',
    'tests',
    'mocks',
    'configures',
    'depends_on',
    'similar_to',
    'overrides',
    'decorates',
    'composes',
    'aggregates',
  ];

  private static readonly VALID_ARCHITECTURAL_LAYERS: ArchitecturalLayer[] = [
    'presentation',
    'business',
    'data',
    'service',
    'infrastructure',
    'test',
    'configuration',
    'unknown',
  ];

  private static readonly VALID_TECHNICAL_DEBT_CATEGORIES: TechnicalDebtCategory[] =
    [
      'code_smells',
      'security_vulnerabilities',
      'performance_issues',
      'maintainability_issues',
      'documentation_gaps',
      'test_coverage_gaps',
      'architectural_violations',
      'style_violations',
    ];

  /**
   * Validate an enhanced code chunk
   */
  static validateEnhancedChunk(chunk: EnhancedCodeChunk): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate base chunk properties
    this.validateBaseChunk(chunk, errors, warnings);

    // Validate enhanced metadata
    this.validateEnhancedMetadata(chunk.enhancedMetadata, errors, warnings);

    // Validate relationships
    this.validateRelationships(chunk.relationships, errors, warnings);

    // Validate quality metrics
    this.validateQualityMetrics(chunk.qualityMetrics, errors, warnings);

    // Validate context info
    this.validateContextInfo(chunk.contextInfo, errors, warnings);

    // Calculate validation score
    const score = this.calculateValidationScore(errors, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score,
    };
  }

  /**
   * Validate base chunk properties
   */
  private static validateBaseChunk(
    chunk: EnhancedCodeChunk,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    // Required fields
    if (!chunk.id || typeof chunk.id !== 'string') {
      errors.push({
        code: 'MISSING_ID',
        message: 'Chunk ID is required and must be a string',
        field: 'id',
        severity: 'error',
      });
    }

    if (!chunk.content || typeof chunk.content !== 'string') {
      errors.push({
        code: 'MISSING_CONTENT',
        message: 'Chunk content is required and must be a string',
        field: 'content',
        severity: 'error',
      });
    }

    if (!chunk.filePath || typeof chunk.filePath !== 'string') {
      errors.push({
        code: 'MISSING_FILE_PATH',
        message: 'File path is required and must be a string',
        field: 'filePath',
        severity: 'error',
      });
    }

    if (typeof chunk.startLine !== 'number' || chunk.startLine < 0) {
      errors.push({
        code: 'INVALID_START_LINE',
        message: 'Start line must be a non-negative number',
        field: 'startLine',
        severity: 'error',
      });
    }

    if (typeof chunk.endLine !== 'number' || chunk.endLine < chunk.startLine) {
      errors.push({
        code: 'INVALID_END_LINE',
        message:
          'End line must be a number greater than or equal to start line',
        field: 'endLine',
        severity: 'error',
      });
    }

    // Warnings for potentially problematic values
    if (chunk.content && chunk.content.length > 10000) {
      warnings.push({
        code: 'LARGE_CHUNK',
        message: 'Chunk content is very large (>10k characters)',
        field: 'content',
        suggestion: 'Consider splitting into smaller chunks',
      });
    }

    if (chunk.endLine - chunk.startLine > 500) {
      warnings.push({
        code: 'LARGE_LINE_RANGE',
        message: 'Chunk spans a very large number of lines (>500)',
        field: 'endLine',
        suggestion: 'Consider splitting into smaller chunks',
      });
    }
  }

  /**
   * Validate enhanced metadata
   */
  private static validateEnhancedMetadata(
    metadata: EnhancedChunkMetadata,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    // Validate semantic type
    if (!this.VALID_SEMANTIC_TYPES.includes(metadata.semanticType)) {
      errors.push({
        code: 'INVALID_SEMANTIC_TYPE',
        message: `Invalid semantic type: ${metadata.semanticType}`,
        field: 'enhancedMetadata.semanticType',
        severity: 'error',
      });
    }

    // Validate complexity score
    if (
      typeof metadata.complexityScore !== 'number' ||
      metadata.complexityScore < 0 ||
      metadata.complexityScore > 100
    ) {
      errors.push({
        code: 'INVALID_COMPLEXITY_SCORE',
        message: 'Complexity score must be a number between 0 and 100',
        field: 'enhancedMetadata.complexityScore',
        severity: 'error',
      });
    }

    // Validate maintainability index
    if (
      typeof metadata.maintainabilityIndex !== 'number' ||
      metadata.maintainabilityIndex < 0 ||
      metadata.maintainabilityIndex > 100
    ) {
      errors.push({
        code: 'INVALID_MAINTAINABILITY_INDEX',
        message: 'Maintainability index must be a number between 0 and 100',
        field: 'enhancedMetadata.maintainabilityIndex',
        severity: 'error',
      });
    }

    // Validate arrays
    if (!Array.isArray(metadata.dependencies)) {
      errors.push({
        code: 'INVALID_DEPENDENCIES',
        message: 'Dependencies must be an array',
        field: 'enhancedMetadata.dependencies',
        severity: 'error',
      });
    }

    if (!Array.isArray(metadata.dependents)) {
      errors.push({
        code: 'INVALID_DEPENDENTS',
        message: 'Dependents must be an array',
        field: 'enhancedMetadata.dependents',
        severity: 'error',
      });
    }

    if (!Array.isArray(metadata.designPatterns)) {
      errors.push({
        code: 'INVALID_DESIGN_PATTERNS',
        message: 'Design patterns must be an array',
        field: 'enhancedMetadata.designPatterns',
        severity: 'error',
      });
    }

    if (!Array.isArray(metadata.codeSmells)) {
      errors.push({
        code: 'INVALID_CODE_SMELLS',
        message: 'Code smells must be an array',
        field: 'enhancedMetadata.codeSmells',
        severity: 'error',
      });
    }

    if (!Array.isArray(metadata.securityConcerns)) {
      errors.push({
        code: 'INVALID_SECURITY_CONCERNS',
        message: 'Security concerns must be an array',
        field: 'enhancedMetadata.securityConcerns',
        severity: 'error',
      });
    }

    // Validate lines of code metrics
    if (!metadata.linesOfCode) {
      errors.push({
        code: 'MISSING_LINES_OF_CODE',
        message: 'Lines of code metrics are required',
        field: 'enhancedMetadata.linesOfCode',
        severity: 'error',
      });
    } else {
      this.validateLinesOfCodeMetrics(metadata.linesOfCode, errors, warnings);
    }

    // Warnings
    if (metadata.complexityScore > 80) {
      warnings.push({
        code: 'HIGH_COMPLEXITY',
        message: 'Chunk has high complexity score',
        field: 'enhancedMetadata.complexityScore',
        suggestion: 'Consider refactoring to reduce complexity',
      });
    }

    if (metadata.maintainabilityIndex < 20) {
      warnings.push({
        code: 'LOW_MAINTAINABILITY',
        message: 'Chunk has low maintainability index',
        field: 'enhancedMetadata.maintainabilityIndex',
        suggestion: 'Consider refactoring to improve maintainability',
      });
    }
  }

  /**
   * Validate lines of code metrics
   */
  private static validateLinesOfCodeMetrics(
    loc: any,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    const requiredFields = ['total', 'code', 'comments', 'blank', 'mixed'];

    for (const field of requiredFields) {
      if (typeof loc[field] !== 'number' || loc[field] < 0) {
        errors.push({
          code: 'INVALID_LOC_METRIC',
          message: `Lines of code metric '${field}' must be a non-negative number`,
          field: `enhancedMetadata.linesOfCode.${field}`,
          severity: 'error',
        });
      }
    }

    // Validate logical consistency
    if (loc.total !== loc.code + loc.comments + loc.blank - loc.mixed) {
      warnings.push({
        code: 'INCONSISTENT_LOC_METRICS',
        message: 'Lines of code metrics may be inconsistent',
        field: 'enhancedMetadata.linesOfCode',
        suggestion: 'Verify that total = code + comments + blank - mixed',
      });
    }
  }

  /**
   * Validate relationships
   */
  private static validateRelationships(
    relationships: ChunkRelationship[],
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    if (!Array.isArray(relationships)) {
      errors.push({
        code: 'INVALID_RELATIONSHIPS',
        message: 'Relationships must be an array',
        field: 'relationships',
        severity: 'error',
      });
      return;
    }

    relationships.forEach((relationship, index) => {
      const fieldPrefix = `relationships[${index}]`;

      // Validate relationship type
      if (!this.VALID_RELATIONSHIP_TYPES.includes(relationship.type)) {
        errors.push({
          code: 'INVALID_RELATIONSHIP_TYPE',
          message: `Invalid relationship type: ${relationship.type}`,
          field: `${fieldPrefix}.type`,
          severity: 'error',
        });
      }

      // Validate target chunk ID
      if (
        !relationship.targetChunkId ||
        typeof relationship.targetChunkId !== 'string'
      ) {
        errors.push({
          code: 'MISSING_TARGET_CHUNK_ID',
          message: 'Target chunk ID is required and must be a string',
          field: `${fieldPrefix}.targetChunkId`,
          severity: 'error',
        });
      }

      // Validate strength
      if (
        typeof relationship.strength !== 'number' ||
        relationship.strength < 0 ||
        relationship.strength > 1
      ) {
        errors.push({
          code: 'INVALID_RELATIONSHIP_STRENGTH',
          message: 'Relationship strength must be a number between 0 and 1',
          field: `${fieldPrefix}.strength`,
          severity: 'error',
        });
      }

      // Validate direction
      if (
        !['outgoing', 'incoming', 'bidirectional'].includes(
          relationship.direction,
        )
      ) {
        errors.push({
          code: 'INVALID_RELATIONSHIP_DIRECTION',
          message: 'Invalid relationship direction',
          field: `${fieldPrefix}.direction`,
          severity: 'error',
        });
      }

      // Validate metadata if present
      if (relationship.metadata) {
        if (
          typeof relationship.metadata.confidence !== 'number' ||
          relationship.metadata.confidence < 0 ||
          relationship.metadata.confidence > 1
        ) {
          errors.push({
            code: 'INVALID_RELATIONSHIP_CONFIDENCE',
            message: 'Relationship confidence must be a number between 0 and 1',
            field: `${fieldPrefix}.metadata.confidence`,
            severity: 'error',
          });
        }

        if (
          !['ast', 'static_analysis', 'semantic', 'heuristic'].includes(
            relationship.metadata.source,
          )
        ) {
          errors.push({
            code: 'INVALID_RELATIONSHIP_SOURCE',
            message: 'Invalid relationship source',
            field: `${fieldPrefix}.metadata.source`,
            severity: 'error',
          });
        }
      }
    });
  }

  /**
   * Validate quality metrics
   */
  private static validateQualityMetrics(
    metrics: QualityMetrics,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    const scoreFields = [
      'overallScore',
      'readabilityScore',
      'documentationRatio',
      'duplicationRisk',
      'performanceRisk',
      'securityRisk',
      'maintainabilityScore',
    ];

    scoreFields.forEach((field) => {
      const value = (metrics as any)[field];
      if (typeof value !== 'number') {
        errors.push({
          code: 'INVALID_QUALITY_METRIC',
          message: `Quality metric '${field}' must be a number`,
          field: `qualityMetrics.${field}`,
          severity: 'error',
        });
      } else if (field === 'documentationRatio') {
        // Documentation ratio is 0-1
        if (value < 0 || value > 1) {
          errors.push({
            code: 'INVALID_DOCUMENTATION_RATIO',
            message: 'Documentation ratio must be between 0 and 1',
            field: `qualityMetrics.${field}`,
            severity: 'error',
          });
        }
      } else {
        // Other scores are 0-100
        if (value < 0 || value > 100) {
          errors.push({
            code: 'INVALID_QUALITY_SCORE',
            message: `Quality metric '${field}' must be between 0 and 100`,
            field: `qualityMetrics.${field}`,
            severity: 'error',
          });
        }
      }
    });

    // Validate technical debt
    if (!metrics.technicalDebt) {
      errors.push({
        code: 'MISSING_TECHNICAL_DEBT',
        message: 'Technical debt metrics are required',
        field: 'qualityMetrics.technicalDebt',
        severity: 'error',
      });
    } else {
      this.validateTechnicalDebt(metrics.technicalDebt, errors, warnings);
    }

    // Warnings for concerning metrics
    if (metrics.securityRisk > 70) {
      warnings.push({
        code: 'HIGH_SECURITY_RISK',
        message: 'Chunk has high security risk',
        field: 'qualityMetrics.securityRisk',
        suggestion: 'Review for security vulnerabilities',
      });
    }

    if (metrics.performanceRisk > 70) {
      warnings.push({
        code: 'HIGH_PERFORMANCE_RISK',
        message: 'Chunk has high performance risk',
        field: 'qualityMetrics.performanceRisk',
        suggestion: 'Review for performance issues',
      });
    }
  }

  /**
   * Validate technical debt metrics
   */
  private static validateTechnicalDebt(
    debt: any,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    if (
      typeof debt.estimatedFixTime !== 'number' ||
      debt.estimatedFixTime < 0
    ) {
      errors.push({
        code: 'INVALID_ESTIMATED_FIX_TIME',
        message: 'Estimated fix time must be a non-negative number',
        field: 'qualityMetrics.technicalDebt.estimatedFixTime',
        severity: 'error',
      });
    }

    if (!['low', 'medium', 'high', 'critical'].includes(debt.severity)) {
      errors.push({
        code: 'INVALID_DEBT_SEVERITY',
        message: 'Invalid technical debt severity',
        field: 'qualityMetrics.technicalDebt.severity',
        severity: 'error',
      });
    }

    if (!Array.isArray(debt.categories)) {
      errors.push({
        code: 'INVALID_DEBT_CATEGORIES',
        message: 'Technical debt categories must be an array',
        field: 'qualityMetrics.technicalDebt.categories',
        severity: 'error',
      });
    } else {
      debt.categories.forEach((category: any, index: number) => {
        if (!this.VALID_TECHNICAL_DEBT_CATEGORIES.includes(category)) {
          errors.push({
            code: 'INVALID_DEBT_CATEGORY',
            message: `Invalid technical debt category: ${category}`,
            field: `qualityMetrics.technicalDebt.categories[${index}]`,
            severity: 'error',
          });
        }
      });
    }

    if (!Array.isArray(debt.issues)) {
      errors.push({
        code: 'INVALID_DEBT_ISSUES',
        message: 'Technical debt issues must be an array',
        field: 'qualityMetrics.technicalDebt.issues',
        severity: 'error',
      });
    }
  }

  /**
   * Validate context info
   */
  private static validateContextInfo(
    context: ContextInfo,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    // Validate architectural layer
    if (!this.VALID_ARCHITECTURAL_LAYERS.includes(context.architecturalLayer)) {
      errors.push({
        code: 'INVALID_ARCHITECTURAL_LAYER',
        message: `Invalid architectural layer: ${context.architecturalLayer}`,
        field: 'contextInfo.architecturalLayer',
        severity: 'error',
      });
    }

    // Validate framework context
    if (!Array.isArray(context.frameworkContext)) {
      errors.push({
        code: 'INVALID_FRAMEWORK_CONTEXT',
        message: 'Framework context must be an array',
        field: 'contextInfo.frameworkContext',
        severity: 'error',
      });
    }

    // Validate file context
    if (!context.fileContext) {
      errors.push({
        code: 'MISSING_FILE_CONTEXT',
        message: 'File context is required',
        field: 'contextInfo.fileContext',
        severity: 'error',
      });
    } else {
      this.validateFileContext(context.fileContext, errors, warnings);
    }
  }

  /**
   * Validate file context
   */
  private static validateFileContext(
    fileContext: any,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    if (
      typeof fileContext.totalLines !== 'number' ||
      fileContext.totalLines < 0
    ) {
      errors.push({
        code: 'INVALID_TOTAL_LINES',
        message: 'Total lines must be a non-negative number',
        field: 'contextInfo.fileContext.totalLines',
        severity: 'error',
      });
    }

    if (typeof fileContext.fileSize !== 'number' || fileContext.fileSize < 0) {
      errors.push({
        code: 'INVALID_FILE_SIZE',
        message: 'File size must be a non-negative number',
        field: 'contextInfo.fileContext.fileSize',
        severity: 'error',
      });
    }

    if (!(fileContext.lastModified instanceof Date)) {
      errors.push({
        code: 'INVALID_LAST_MODIFIED',
        message: 'Last modified must be a Date object',
        field: 'contextInfo.fileContext.lastModified',
        severity: 'error',
      });
    }

    if (!Array.isArray(fileContext.siblingChunks)) {
      errors.push({
        code: 'INVALID_SIBLING_CHUNKS',
        message: 'Sibling chunks must be an array',
        field: 'contextInfo.fileContext.siblingChunks',
        severity: 'error',
      });
    }
  }

  /**
   * Calculate validation score based on errors and warnings
   */
  private static calculateValidationScore(
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): number {
    const errorPenalty = errors.length * 10;
    const warningPenalty = warnings.length * 2;
    const totalPenalty = errorPenalty + warningPenalty;

    return Math.max(0, 100 - totalPenalty);
  }

  /**
   * Validate a batch of enhanced chunks
   */
  static validateBatch(chunks: EnhancedCodeChunk[]): ValidationResult[] {
    return chunks.map((chunk) => this.validateEnhancedChunk(chunk));
  }

  /**
   * Get validation summary for a batch of chunks
   */
  static getBatchValidationSummary(results: ValidationResult[]): {
    totalChunks: number;
    validChunks: number;
    invalidChunks: number;
    averageScore: number;
    commonErrors: string[];
    commonWarnings: string[];
  } {
    const totalChunks = results.length;
    const validChunks = results.filter((r) => r.isValid).length;
    const invalidChunks = totalChunks - validChunks;
    const averageScore =
      results.reduce((sum, r) => sum + r.score, 0) / totalChunks;

    // Count error and warning frequencies
    const errorCounts: Record<string, number> = {};
    const warningCounts: Record<string, number> = {};

    results.forEach((result) => {
      result.errors.forEach((error) => {
        errorCounts[error.code] = (errorCounts[error.code] || 0) + 1;
      });
      result.warnings.forEach((warning) => {
        warningCounts[warning.code] = (warningCounts[warning.code] || 0) + 1;
      });
    });

    // Get most common errors and warnings
    const commonErrors = Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([code]) => code);

    const commonWarnings = Object.entries(warningCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([code]) => code);

    return {
      totalChunks,
      validChunks,
      invalidChunks,
      averageScore,
      commonErrors,
      commonWarnings,
    };
  }
}
