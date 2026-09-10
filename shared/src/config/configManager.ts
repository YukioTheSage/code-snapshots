import * as fs from 'fs';
import * as path from 'path';
import { CodelapseConfig, DEFAULT_CONFIG, ENV_VARS } from '../types/config';
import {
  buildConfigSchema,
  ConfigSchemaMap,
  sanitizeConfigForExport,
  validatePartialCodelapseConfig,
} from '../validation/configValidation';
import {
  assertBufferSizeWithinLimit,
  assertSufficientDiskSpace,
  MAX_JSON_PAYLOAD_BYTES,
} from '../security/limits';
import { assertNoSymlinkPath } from '../utils/pathSecurity';

/**
 * Configuration manager that supports multiple sources:
 * 1. .vscode/codelapse.json (shared by CLI and extension)
 * 2. Environment variables
 * 3. Default values
 */
export class ConfigManager {
  private workspaceRoot: string;
  private configCache: CodelapseConfig | null = null;
  private configFilePath: string;
  private readonly configSchema: ConfigSchemaMap = buildConfigSchema();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.configFilePath = path.join(workspaceRoot, '.vscode', 'codelapse.json');
  }

  /**
   * Get the full configuration with fallback chain:
   * config file -> environment variables -> defaults
   */
  public getConfig(): CodelapseConfig {
    if (this.configCache) {
      return this.configCache;
    }

    // Start with defaults
    let config: CodelapseConfig = { ...DEFAULT_CONFIG };

    // Override with file config if exists
    const fileConfig = this.loadConfigFile();
    if (fileConfig) {
      config = this.mergeConfig(config, fileConfig);
    }

    // Override with environment variables
    config = this.applyEnvironmentVariables(config);

    this.configCache = config;
    return config;
  }

  /**
   * Get a specific configuration value
   */
  public get<K extends keyof CodelapseConfig>(key: K): CodelapseConfig[K] {
    return this.getConfig()[key];
  }

  /**
   * Set a configuration value and save to file
   */
  public async set<K extends keyof CodelapseConfig>(
    key: K,
    value: CodelapseConfig[K],
  ): Promise<void> {
    const config = this.getConfig();
    config[key] = value;
    await this.saveConfigFile(config);
    this.configCache = config;
  }

  /**
   * Update nested configuration value
   */
  public async setNested(keyPath: string, value: any): Promise<void> {
    this.assertValidKeyPath(keyPath);
    this.assertValueMatchesSchema(keyPath, value);

    const config = this.getConfig();
    const keys = keyPath.split('.');
    let current: any = config;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
    await this.saveConfigFile(config);
    this.configCache = config;
  }

  /**
   * Get nested configuration value
   * @param keyPath - Dot-separated key path (e.g., "git.addCommitInfo")
   * @returns The value at the specified path, or undefined if not found
   */
  public getNested(keyPath: string): any {
    // Return undefined for empty or invalid key paths
    if (!keyPath || typeof keyPath !== 'string') {
      return undefined;
    }

    const config = this.getConfig();
    const keys = keyPath.split('.');
    let current: any = config;

    for (const key of keys) {
      if (current === undefined || current === null) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Get default value for a nested configuration key
   * @param keyPath - Dot-separated key path (e.g., "git.addCommitInfo")
   * @returns The default value at the specified path, or undefined if not found
   */
  public getDefaultNested(keyPath: string): any {
    if (!keyPath || typeof keyPath !== 'string') {
      return undefined;
    }

    const entry = this.configSchema[keyPath];
    if (!entry) {
      return undefined;
    }
    return deepClone(entry.default);
  }

  /**
   * Reset a specific configuration key to its default value
   * @param keyPath - Dot-separated key path (e.g., "git.addCommitInfo")
   */
  public async resetNested(keyPath: string): Promise<void> {
    this.assertValidKeyPath(keyPath);
    const defaultValue = this.getDefaultNested(keyPath);
    if (defaultValue === undefined) {
      throw new Error(`No default value found for key: ${keyPath}`);
    }
    await this.setNested(keyPath, defaultValue);
  }

  /**
   * Reset configuration to defaults
   */
  public async reset(): Promise<void> {
    await this.saveConfigFile(DEFAULT_CONFIG);
    this.configCache = null;
  }

  /**
   * Clear cache to force reload
   */
  public clearCache(): void {
    this.configCache = null;
  }

  /**
   * Get canonical config schema derived from defaults.
   */
  public getConfigSchema(): ConfigSchemaMap {
    return { ...this.configSchema };
  }

  /**
   * List all allowed config key paths.
   */
  public getAvailableKeyPaths(): string[] {
    return Object.keys(this.configSchema).sort();
  }

  /**
   * Check if a key path is valid for set/reset operations.
   */
  public isValidKeyPath(keyPath: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.configSchema, keyPath);
  }

  /**
   * Load configuration from file
   */
  private loadConfigFile(): Partial<CodelapseConfig> | null {
    try {
      if (fs.existsSync(this.configFilePath)) {
        assertNoSymlinkPath(this.workspaceRoot, this.configFilePath);
        const stats = fs.lstatSync(this.configFilePath);
        if (stats.isSymbolicLink()) {
          throw new Error(`Refusing to load config from symlink: ${this.configFilePath}`);
        }
        if (stats.size > MAX_JSON_PAYLOAD_BYTES) {
          throw new Error(
            `Config file is too large: ${stats.size} bytes > ${MAX_JSON_PAYLOAD_BYTES} bytes`,
          );
        }
        const content = fs.readFileSync(this.configFilePath, 'utf8');
        assertBufferSizeWithinLimit(
          content,
          this.configFilePath,
          MAX_JSON_PAYLOAD_BYTES,
        );
        const parsed = JSON.parse(content) as unknown;
        validatePartialCodelapseConfig(parsed, 'configFile');
        return parsed as Partial<CodelapseConfig>;
      }
    } catch (error) {
      console.error('Error loading config file:', error);
      this.quarantineConfigFile(
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }

  /**
   * Save configuration to file
   */
  private async saveConfigFile(config: CodelapseConfig): Promise<void> {
    try {
      // Ensure .vscode directory exists
      const vscodePath = path.dirname(this.configFilePath);
      assertNoSymlinkPath(this.workspaceRoot, vscodePath);
      if (!fs.existsSync(vscodePath)) {
        fs.mkdirSync(vscodePath, { recursive: true });
      }
      assertNoSymlinkPath(this.workspaceRoot, this.configFilePath);

      // Write config file
      const serialized = JSON.stringify(config, null, 2);
      assertBufferSizeWithinLimit(serialized, this.configFilePath);
      await assertSufficientDiskSpace(this.configFilePath);
      fs.writeFileSync(
        this.configFilePath,
        serialized,
        'utf8',
      );
    } catch (error) {
      throw new Error(`Failed to save config file: ${error}`);
    }
  }

  /**
   * Merge two configuration objects
   */
  private mergeConfig(
    base: CodelapseConfig,
    override: Partial<CodelapseConfig>,
  ): CodelapseConfig {
    const result: CodelapseConfig = {
      ...base,
      ...override,
      git: {
        ...base.git,
        ...(override.git || {}),
      },
    };

    if (base.semanticSearch || override.semanticSearch) {
      result.semanticSearch = {
        enabled: base.semanticSearch?.enabled ?? false,
        ...(base.semanticSearch || {}),
        ...(override.semanticSearch || {}),
      };
    }

    return result;
  }

  /**
   * Apply environment variables to configuration
   */
  private applyEnvironmentVariables(config: CodelapseConfig): CodelapseConfig {
    // Snapshot location
    if (process.env[ENV_VARS.SNAPSHOT_LOCATION]) {
      config.snapshotLocation = process.env[ENV_VARS.SNAPSHOT_LOCATION]!;
    }

    // Max snapshots
    if (process.env[ENV_VARS.MAX_SNAPSHOTS]) {
      const maxSnapshots = parseInt(process.env[ENV_VARS.MAX_SNAPSHOTS]!, 10);
      if (!isNaN(maxSnapshots)) {
        config.maxSnapshots = maxSnapshots;
      }
    }

    // API keys for semantic search
    if (config.semanticSearch) {
      if (process.env[ENV_VARS.GEMINI_API_KEY]) {
        config.semanticSearch.apiKey = process.env[ENV_VARS.GEMINI_API_KEY];
      }
    }

    return config;
  }

  /**
   * Export configuration to JSON string
   */
  public exportConfig(): string {
    return JSON.stringify(sanitizeConfigForExport(this.getConfig()), null, 2);
  }

  /**
   * Import configuration from JSON string
   */
  public async importConfig(json: string): Promise<void> {
    try {
      assertBufferSizeWithinLimit(json, 'importConfig payload');
      const parsed = JSON.parse(json) as unknown;
      validatePartialCodelapseConfig(parsed, 'importConfig');

      const merged = this.mergeConfig(
        deepClone(DEFAULT_CONFIG),
        parsed as Partial<CodelapseConfig>,
      );
      await this.saveConfigFile(merged);
      this.configCache = merged;
    } catch (error) {
      throw new Error(`Failed to import config: ${error}`);
    }
  }

  /**
   * Validate configuration
   */
  public validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.getConfig();

    // Validate snapshot location
    if (!config.snapshotLocation || config.snapshotLocation.trim() === '') {
      errors.push('snapshotLocation cannot be empty');
    }

    // Validate max snapshots
    if (config.maxSnapshots < 1) {
      errors.push('maxSnapshots must be at least 1');
    }

    // Validate semantic search config
    if (config.semanticSearch) {
      if (
        config.semanticSearch.chunkSize &&
        config.semanticSearch.chunkSize < 50
      ) {
        errors.push('semanticSearch.chunkSize must be at least 50');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private quarantineConfigFile(reason: string): void {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const quarantinePath = `${this.configFilePath}.quarantine-${timestamp}.json`;
      fs.renameSync(this.configFilePath, quarantinePath);
      console.error(
        `Quarantined invalid config file due to "${reason}": ${quarantinePath}`,
      );
    } catch (error) {
      console.error('Failed to quarantine invalid config file:', error);
    }
  }

  private assertValidKeyPath(keyPath: string): void {
    if (!this.isValidKeyPath(keyPath)) {
      throw new Error(
        `Invalid configuration key path "${keyPath}". Use "config list" to see valid keys.`,
      );
    }
  }

  private assertValueMatchesSchema(keyPath: string, value: unknown): void {
    const schemaEntry = this.configSchema[keyPath];
    if (!schemaEntry) {
      return;
    }

    const expectedType = schemaEntry.type;
    if (expectedType === 'null') {
      if (value !== null) {
        throw new Error(`Configuration key "${keyPath}" only accepts null`);
      }
      return;
    }
    if (expectedType === 'array') {
      if (!Array.isArray(value)) {
        throw new Error(`Configuration key "${keyPath}" expects an array`);
      }
      return;
    }
    if (expectedType === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Configuration key "${keyPath}" expects an object`);
      }
      return;
    }
    if (typeof value !== expectedType) {
      throw new Error(
        `Configuration key "${keyPath}" expects ${expectedType}, received ${typeof value}`,
      );
    }
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
