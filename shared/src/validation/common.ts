export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertString(
  value: unknown,
  fieldName: string,
  options: { allowEmpty?: boolean } = {},
): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (!options.allowEmpty && value.trim() === '') {
    throw new Error(`${fieldName} cannot be empty`);
  }
}

export function assertBoolean(
  value: unknown,
  fieldName: string,
): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
}

export function assertNumber(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
}

export function assertStringArray(
  value: unknown,
  fieldName: string,
): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`${fieldName}[${index}] must be a string`);
    }
  });
}
