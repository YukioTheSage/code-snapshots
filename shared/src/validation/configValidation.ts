import { CodelapseConfig, DEFAULT_CONFIG } from '../types/config';
import {
  assertBoolean,
  assertNumber,
  assertString,
  isObjectRecord,
} from './common';

export interface ConfigSchemaEntry {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  default: unknown;
  description: string;
}

export type ConfigSchemaMap = Record<string, ConfigSchemaEntry>;

const CONFIG_SCHEMA_TEMPLATE: Record<string, unknown> = {
  ...DEFAULT_CONFIG,
  semanticSearch: {
    ...(DEFAULT_CONFIG.semanticSearch || {}),
    provider: '',
    apiKey: '',
  },
};

function inferType(value: unknown): ConfigSchemaEntry['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

function flattenSchema(
  value: unknown,
  prefix: string,
  schema: ConfigSchemaMap,
): void {
  const key = prefix;
  schema[key] = {
    type: inferType(value),
    default: value,
    description: `Configuration for ${key}`,
  };

  if (isObjectRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      const nestedKey = `${prefix}.${childKey}`;
      flattenSchema(childValue, nestedKey, schema);
    }
  }
}

export function buildConfigSchema(): ConfigSchemaMap {
  const schema: ConfigSchemaMap = {};
  for (const [key, value] of Object.entries(CONFIG_SCHEMA_TEMPLATE)) {
    flattenSchema(value, key, schema);
  }
  return schema;
}

export function getAvailableConfigKeyPaths(): string[] {
  return Object.keys(buildConfigSchema()).sort();
}

export function isValidConfigKeyPath(keyPath: string): boolean {
  if (!keyPath || typeof keyPath !== 'string') {
    return false;
  }
  return getAvailableConfigKeyPaths().includes(keyPath);
}

export function getSchemaEntry(
  keyPath: string,
): ConfigSchemaEntry | undefined {
  return buildConfigSchema()[keyPath];
}

export function validatePartialCodelapseConfig(
  value: unknown,
  context: string,
): asserts value is Partial<CodelapseConfig> {
  if (!isObjectRecord(value)) {
    throw new Error(`${context} must be an object`);
  }

  if ('snapshotLocation' in value && value.snapshotLocation !== undefined) {
    assertString(value.snapshotLocation, `${context}.snapshotLocation`);
  }

  if ('maxSnapshots' in value && value.maxSnapshots !== undefined) {
    assertNumber(value.maxSnapshots, `${context}.maxSnapshots`);
    if (value.maxSnapshots < 1) {
      throw new Error(`${context}.maxSnapshots must be at least 1`);
    }
  }

  if (
    'maxSnapshotStoreBytes' in value &&
    value.maxSnapshotStoreBytes !== undefined
  ) {
    assertNumber(
      value.maxSnapshotStoreBytes,
      context + '.maxSnapshotStoreBytes',
    );
    if (value.maxSnapshotStoreBytes < 0) {
      throw new Error(context + '.maxSnapshotStoreBytes must not be negative');
    }
  }

  if ('git' in value && value.git !== undefined) {
    if (!isObjectRecord(value.git)) {
      throw new Error(`${context}.git must be an object`);
    }
    if ('addCommitInfo' in value.git && value.git.addCommitInfo !== undefined) {
      assertBoolean(value.git.addCommitInfo, `${context}.git.addCommitInfo`);
    }
  }

  if ('autoSnapshot' in value && value.autoSnapshot !== undefined) {
    if (!isObjectRecord(value.autoSnapshot)) {
      throw new Error(`${context}.autoSnapshot must be an object`);
    }
    if (
      'rules' in value.autoSnapshot &&
      value.autoSnapshot.rules !== undefined
    ) {
      if (!Array.isArray(value.autoSnapshot.rules)) {
        throw new Error(`${context}.autoSnapshot.rules must be an array`);
      }
      for (const [index, rule] of value.autoSnapshot.rules.entries()) {
        if (!isObjectRecord(rule)) {
          throw new Error(
            `${context}.autoSnapshot.rules[${index}] must be an object`,
          );
        }
        assertString(
          rule.pattern,
          `${context}.autoSnapshot.rules[${index}].pattern`,
        );
        assertNumber(
          rule.intervalMinutes,
          `${context}.autoSnapshot.rules[${index}].intervalMinutes`,
        );
        if (rule.intervalMinutes < 1) {
          throw new Error(
            `${context}.autoSnapshot.rules[${index}].intervalMinutes must be at least 1`,
          );
        }
        if (rule.enabled !== undefined) {
          assertBoolean(
            rule.enabled,
            `${context}.autoSnapshot.rules[${index}].enabled`,
          );
        }
      }
    }
  }

  if ('semanticSearch' in value && value.semanticSearch !== undefined) {
    if (!isObjectRecord(value.semanticSearch)) {
      throw new Error(`${context}.semanticSearch must be an object`);
    }
    if (
      'enabled' in value.semanticSearch &&
      value.semanticSearch.enabled !== undefined
    ) {
      assertBoolean(value.semanticSearch.enabled, `${context}.semanticSearch.enabled`);
    }
    if (
      'provider' in value.semanticSearch &&
      value.semanticSearch.provider !== undefined
    ) {
      assertString(
        value.semanticSearch.provider,
        `${context}.semanticSearch.provider`,
        { allowEmpty: true },
      );
    }
    if (
      'apiKey' in value.semanticSearch &&
      value.semanticSearch.apiKey !== undefined
    ) {
      assertString(
        value.semanticSearch.apiKey,
        `${context}.semanticSearch.apiKey`,
        { allowEmpty: true },
      );
    }
    if (
      'chunkSize' in value.semanticSearch &&
      value.semanticSearch.chunkSize !== undefined
    ) {
      assertNumber(value.semanticSearch.chunkSize, `${context}.semanticSearch.chunkSize`);
    }
    if (
      'autoIndex' in value.semanticSearch &&
      value.semanticSearch.autoIndex !== undefined
    ) {
      assertBoolean(
        value.semanticSearch.autoIndex,
        `${context}.semanticSearch.autoIndex`,
      );
    }
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (!isObjectRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/apiKey|token|secret/i.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = redactSensitive(child);
  }
  return output;
}

export function sanitizeConfigForExport(
  config: CodelapseConfig,
): Record<string, unknown> {
  const cloned = deepClone(config);
  if (cloned.semanticSearch && 'apiKey' in cloned.semanticSearch) {
    delete cloned.semanticSearch.apiKey;
  }
  return redactSensitive(cloned) as Record<string, unknown>;
}

