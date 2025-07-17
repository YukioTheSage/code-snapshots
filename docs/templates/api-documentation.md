# [API method name]

Brief description of what this API method does and its primary use case.

## Syntax

```typescript
methodName(parameter1: Type, parameter2?: OptionalType): Promise<ReturnType>
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `parameter1` | `Type` | Yes | Detailed description of what this parameter does |
| `parameter2` | `OptionalType` | No | Description of optional parameter and default behavior |

### Parameter Details

#### `parameter1: Type`
- **Purpose**: What this parameter is used for
- **Validation**: Any validation rules or constraints
- **Examples**: `"example-value"`, `123`, `{ option: true }`

#### `parameter2?: OptionalType`
- **Purpose**: What this optional parameter controls
- **Default**: What happens when not provided
- **Examples**: `{ timeout: 5000 }`, `undefined`

## Return Value

Returns a `Promise<ReturnType>` that resolves to:

```typescript
interface ReturnType {
  success: boolean;
  data?: DataType;
  error?: string;
  metadata?: {
    timestamp: string;
    operation: string;
  };
}
```

### Return Properties

| Property | Type | Description |
|----------|------|-------------|
| `success` | `boolean` | Indicates if the operation completed successfully |
| `data` | `DataType` | The main result data (present on success) |
| `error` | `string` | Error message (present on failure) |
| `metadata` | `object` | Additional operation information |

## Examples

### Basic Usage

```typescript
// Simple method call
const result = await methodName("basic-parameter");

if (result.success) {
  console.log("Operation successful:", result.data);
} else {
  console.error("Operation failed:", result.error);
}
```

### Advanced Usage

```typescript
// Method call with optional parameters
const result = await methodName("parameter-value", {
  timeout: 10000,
  retries: 3,
  verbose: true
});

// Handle different result types
switch (result.data?.type) {
  case 'type1':
    // Handle type 1 result
    break;
  case 'type2':
    // Handle type 2 result
    break;
  default:
    // Handle unknown type
}
```

### Error Handling

```typescript
try {
  const result = await methodName("parameter");
  
  if (!result.success) {
    throw new Error(result.error);
  }
  
  // Process successful result
  return result.data;
  
} catch (error) {
  console.error("Method call failed:", error.message);
  // Implement fallback logic
}
```

## CLI Usage

This API method is also available through the CLI:

```bash
# Basic CLI usage
codelapse method-name "parameter-value"

# With options
codelapse method-name "parameter-value" --option value --json --silent

# Expected JSON output
{
  "success": true,
  "data": {
    "result": "example"
  },
  "metadata": {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "operation": "method-name"
  }
}
```

## Error Handling

### Common Errors

| Error Code | Description | Cause | Solution |
|------------|-------------|-------|----------|
| `INVALID_PARAMETER` | Parameter validation failed | Invalid input format | Check parameter format and try again |
| `OPERATION_TIMEOUT` | Operation exceeded timeout | Network or processing delay | Increase timeout or retry |
| `RESOURCE_NOT_FOUND` | Referenced resource doesn't exist | Invalid ID or deleted resource | Verify resource exists |

### Error Response Format

```json
{
  "success": false,
  "error": "Detailed error message explaining what went wrong",
  "errorCode": "ERROR_CODE",
  "details": {
    "parameter": "problematic-value",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "context": {}
  }
}
```

## Performance Considerations

- **Execution Time**: Typical execution time and factors that affect it
- **Resource Usage**: Memory, CPU, or network resources consumed
- **Scalability**: How performance changes with different parameter values
- **Optimization Tips**: Best practices for optimal performance

## Security Considerations

- **Data Privacy**: What data is processed and how it's handled
- **Authentication**: Any authentication requirements
- **Permissions**: Required permissions or access levels
- **Sensitive Data**: Warnings about sensitive parameter values

## Related Methods

- [`relatedMethod1()`](related-method-1.md) - Brief description of relationship
- [`relatedMethod2()`](related-method-2.md) - Brief description of relationship
- [`parentMethod()`](parent-method.md) - Method that often calls this one

## Version History

| Version | Changes |
|---------|---------|
| 1.2.0 | Added optional parameter2 support |
| 1.1.0 | Improved error handling and validation |
| 1.0.0 | Initial implementation |

---

*Last updated: [Date] | API Version: [Version Number]*