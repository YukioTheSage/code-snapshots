/**
 * codelapse-core - Shared core functionality for CodeLapse CLI and VS Code extension
 */

// Types
export * from './types/snapshot';
export * from './types/config';

// Storage
export { SnapshotStorage } from './storage/snapshotStorage';
export { SnapshotManager } from './storage/snapshotManager';
export * from './storage/snapshotStoreSize';

// Configuration
export { ConfigManager } from './config/configManager';

// Utilities
export { GitignoreParser } from './utils/gitignoreParser';
export * from './utils/diffUtils';
export * from './utils/asyncUtils';
export {
  ensureWithinDirectory,
  validateSnapshotId,
  assertNoSymlinkPath,
} from './utils/pathSecurity';

// Validation and security
export * from './validation/configValidation';
export * from './validation/snapshotValidation';
export * from './security/limits';

// Git Integration
export { GitIntegration } from './git/gitIntegration';
