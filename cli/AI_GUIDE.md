# CodeLapse CLI Instructions for AI Agents

You are an AI agent working with the `codelapse-cli` to safely modify code in a developer's workspace. This guide provides mandatory safety protocols, comprehensive error handling patterns, and workflow templates for safe automation.

> ⚠️ **CRITICAL SECURITY WARNING - SEMANTIC SEARCH**:
>
> - **NEVER** use semantic search commands (`codelapse search`) with sensitive, proprietary, or confidential code
> - **Data Exposure Risk**: Semantic search transmits code content to external AI services (Pinecone, Gemini)
> - **API Key Security**: Third-party services require API keys with potential access implications
> - **Privacy Violation**: Code is processed by external providers over the internet
> - **Compliance Issues**: May violate organizational security policies and data protection regulations
> - **Cost Impact**: API usage may result in unexpected charges on user accounts
> - **Experimental Status**: Features may change, break, or be removed without notice
> - **ALWAYS** verify with users before enabling or using semantic search features
> - **RECOMMEND** disabling semantic search for any sensitive work environments

## ⚠️ MANDATORY SAFETY PROTOCOLS

### Critical Safety Rules (NON-NEGOTIABLE)

1. **ALWAYS** use `--json --silent` flags on every command
2. **ALWAYS** check `success: true` in JSON response before proceeding
3. **NEVER** make changes without creating a backup snapshot first
4. **ALWAYS** parse JSON output, never assume success
5. **NEVER** proceed if any command returns `success: false`
6. **ALWAYS** restore backup if any operation fails
7. **NEVER** execute batch operations without individual validation
8. **ALWAYS** create recovery snapshots at critical checkpoints
9. **NEVER** ignore error messages or warnings
10. **ALWAYS** document all changes with detailed snapshots

### Pre-Operation Safety Checklist

Before starting ANY operation, verify:

- [ ] CodeLapse connection is active (`codelapse status`)
- [ ] Workspace is in a clean state
- [ ] No pending changes that could be lost
- [ ] Backup snapshot created with descriptive notes
- [ ] Recovery plan established
- [ ] User notification prepared for any failures

## Required Command Format

```bash
codelapse <command> --json --silent
```

## Essential Commands

### Check Connection

```bash
codelapse status --json --silent
```

**Must run first.** If `success: false`, stop and report connection error.

### Create Backup (Before ANY Changes)

```bash
codelapse snapshot create "Backup before [your operation]" --tags "backup" --notes "Detailed reason for backup, e.g., 'About to refactor X module' or 'Before attempting Y experimental change.'" --json --silent
```

**Save the returned `snapshot.id` for emergency restore.**

### Using Snapshot Notes (`--notes`)

The `--notes` flag allows you to add a detailed description to your snapshots, beyond the main description. This is useful for:

- Documenting specific changes made (e.g., "Added feature X", "Fixed bug Y").
- Explaining the rationale behind changes.
- Listing pending tasks or considerations related to the snapshot.
- Providing context for future review or collaboration.

**Example:**

```bash
codelapse snapshot create "Refactored user authentication" --notes "Implemented OAuth2 for improved security. Removed deprecated local authentication methods. Pending: Add unit tests for new OAuth flow." --json --silent
```

### Get Current State

```bash
codelapse workspace state --json --silent
```

### Emergency Restore

```bash
codelapse snapshot restore [snapshot-id] --backup --json --silent
```

### Final Documentation

```bash
codelapse snapshot create "Completed: [description of changes]" --tags "complete" --favorite --notes "[Detailed notes about what was done, features added, bugs fixed, etc.]" --json --silent
```

## Standard Workflow

```bash
# 1. VERIFY CONNECTION
status_result=$(codelapse status --json --silent)
# Parse: check success=true, connected=true

# 2. CREATE SAFETY BACKUP
backup_result=$(codelapse snapshot create "Backup before [task]" --tags "backup" --json --silent)
backup_id=$(echo "$backup_result" | jq -r '.snapshot.id')

# 3. GATHER CONTEXT (if needed)
codelapse workspace state --json --silent

# 4. MAKE YOUR CHANGES
# (your file operations here)

# 5. VERIFY SUCCESS
# (test your changes)

# 6. DOCUMENT COMPLETION
codelapse snapshot create "Completed: [what you did]" --tags "complete" --favorite --json --silent
```

## 🛡️ COMPREHENSIVE ERROR HANDLING PATTERNS

### Standard Error Handling Template

```bash
# Execute command with error handling
execute_safe_command() {
    local cmd="$1"
    local operation_name="$2"
    local backup_id="$3"

    echo "Executing: $operation_name"
    result=$(eval "$cmd")

    if ! echo "$result" | jq -e '.success' > /dev/null; then
        error_msg=$(echo "$result" | jq -r '.error // "Unknown error"')
        error_code=$(echo "$result" | jq -r '.code // "UNKNOWN"')

        echo "❌ OPERATION FAILED: $operation_name"
        echo "Error: $error_msg (Code: $error_code)"

        # Attempt recovery if backup exists
        if [[ -n "$backup_id" ]]; then
            echo "🔄 Attempting recovery from backup: $backup_id"
            restore_result=$(codelapse snapshot restore "$backup_id" --backup --json --silent)

            if echo "$restore_result" | jq -e '.success' > /dev/null; then
                echo "✅ Successfully restored from backup"
            else
                echo "❌ CRITICAL: Backup restore failed!"
                echo "Manual intervention required immediately"
            fi
        fi

        return 1
    fi

    echo "✅ $operation_name completed successfully"
    return 0
}
```

### Error Recovery Procedures

#### Connection Failures

```bash
handle_connection_error() {
    echo "❌ CodeLapse connection failed"
    echo "Recovery steps:"
    echo "1. Verify CodeLapse extension is running"
    echo "2. Check workspace is open in VS Code"
    echo "3. Restart VS Code if necessary"
    echo "4. Verify CLI installation: codelapse --version"

    # Attempt reconnection
    for i in {1..3}; do
        echo "Reconnection attempt $i/3..."
        sleep 2
        result=$(codelapse status --json --silent 2>/dev/null)
        if echo "$result" | jq -e '.success' > /dev/null; then
            echo "✅ Reconnection successful"
            return 0
        fi
    done

    echo "❌ Unable to reconnect. Manual intervention required."
    return 1
}
```

#### Snapshot Operation Failures

```bash
handle_snapshot_error() {
    local operation="$1"
    local error_msg="$2"

    echo "❌ Snapshot operation failed: $operation"
    echo "Error: $error_msg"

    case "$operation" in
        "create")
            echo "Recovery: Check disk space and permissions"
            echo "Fallback: Create manual backup of critical files"
            ;;
        "restore")
            echo "CRITICAL: Snapshot restore failed!"
            echo "1. Do not make further changes"
            echo "2. List available snapshots: codelapse snapshot list"
            echo "3. Try alternative snapshot if available"
            echo "4. Contact user immediately"
            ;;
        "list")
            echo "Recovery: Check workspace integrity"
            echo "Fallback: Use git status to verify current state"
            ;;
    esac
}
```

### Validation Patterns

```bash
# Validate JSON response structure
validate_response() {
    local response="$1"
    local expected_fields="$2"  # comma-separated list

    if ! echo "$response" | jq empty 2>/dev/null; then
        echo "❌ Invalid JSON response"
        return 1
    fi

    if ! echo "$response" | jq -e '.success' > /dev/null; then
        echo "❌ Operation unsuccessful"
        return 1
    fi

    # Check for expected fields
    IFS=',' read -ra FIELDS <<< "$expected_fields"
    for field in "${FIELDS[@]}"; do
        if ! echo "$response" | jq -e ".$field" > /dev/null; then
            echo "❌ Missing expected field: $field"
            return 1
        fi
    done

    return 0
}
```

## 📋 WORKFLOW TEMPLATES FOR COMMON OPERATIONS

### Template 1: Single File Modification

```bash
#!/bin/bash
# Safe single file modification template

OPERATION_NAME="Modify specific file"
TARGET_FILE="path/to/file.js"

# 1. Connection check
if ! execute_safe_command "codelapse status --json --silent" "Connection check"; then
    handle_connection_error
    exit 1
fi

# 2. Create backup
backup_result=$(codelapse snapshot create "Backup before modifying $TARGET_FILE" --tags "backup,file-mod" --notes "About to modify $TARGET_FILE for $OPERATION_NAME" --json --silent)
if ! validate_response "$backup_result" "snapshot"; then
    echo "❌ Failed to create backup. Aborting operation."
    exit 1
fi
backup_id=$(echo "$backup_result" | jq -r '.snapshot.id')

# 3. Verify file exists and get current state
if [[ ! -f "$TARGET_FILE" ]]; then
    echo "❌ Target file does not exist: $TARGET_FILE"
    exit 1
fi

# 4. Make your changes here
# ... your file modification logic ...

# 5. Verify changes were successful
if [[ $? -eq 0 ]]; then
    # 6. Create completion snapshot
    codelapse snapshot create "Completed: $OPERATION_NAME" --tags "complete,file-mod" --favorite --notes "Successfully modified $TARGET_FILE. Changes: [describe changes]" --json --silent
    echo "✅ Operation completed successfully"
else
    echo "❌ File modification failed, restoring backup"
    codelapse snapshot restore "$backup_id" --backup --json --silent
    exit 1
fi
```

### Template 2: Multi-File Refactoring

```bash
#!/bin/bash
# Safe multi-file refactoring template

OPERATION_NAME="Multi-file refactoring"
declare -a TARGET_FILES=("file1.js" "file2.js" "file3.js")

# 1. Connection and initial backup
if ! execute_safe_command "codelapse status --json --silent" "Connection check"; then
    exit 1
fi

backup_result=$(codelapse snapshot create "Backup before $OPERATION_NAME" --tags "backup,refactor" --notes "Multi-file refactoring operation starting. Files: ${TARGET_FILES[*]}" --json --silent)
backup_id=$(echo "$backup_result" | jq -r '.snapshot.id')

# 2. Validate all target files exist
for file in "${TARGET_FILES[@]}"; do
    if [[ ! -f "$file" ]]; then
        echo "❌ Target file missing: $file"
        exit 1
    fi
done

# 3. Create checkpoint before each major change
checkpoint_count=0
for file in "${TARGET_FILES[@]}"; do
    echo "Processing file: $file"

    # Create checkpoint
    ((checkpoint_count++))
    checkpoint_result=$(codelapse snapshot create "Checkpoint $checkpoint_count: Before modifying $file" --tags "checkpoint" --json --silent)
    checkpoint_id=$(echo "$checkpoint_result" | jq -r '.snapshot.id')

    # Make changes to file
    # ... your modification logic for $file ...

    if [[ $? -ne 0 ]]; then
        echo "❌ Failed to modify $file, restoring from backup"
        codelapse snapshot restore "$backup_id" --backup --json --silent
        exit 1
    fi

    echo "✅ Successfully modified $file"
done

# 4. Final verification and completion
codelapse snapshot create "Completed: $OPERATION_NAME" --tags "complete,refactor" --favorite --notes "Successfully refactored ${#TARGET_FILES[@]} files: ${TARGET_FILES[*]}" --json --silent
echo "✅ Multi-file refactoring completed successfully"
```

### Template 3: Experimental Feature Implementation

```bash
#!/bin/bash
# Template for implementing experimental features with extra safety

OPERATION_NAME="Experimental feature implementation"
FEATURE_NAME="new-experimental-feature"

# 1. Enhanced safety checks for experimental work
echo "🧪 Starting experimental feature implementation"
echo "⚠️  Extra safety protocols enabled"

# Connection check
if ! execute_safe_command "codelapse status --json --silent" "Connection check"; then
    exit 1
fi

# 2. Create multiple backup layers
echo "Creating primary backup..."
primary_backup=$(codelapse snapshot create "PRIMARY: Backup before $FEATURE_NAME" --tags "backup,experimental,primary" --notes "Primary backup before implementing experimental feature: $FEATURE_NAME" --json --silent)
primary_backup_id=$(echo "$primary_backup" | jq -r '.snapshot.id')

echo "Creating secondary backup..."
secondary_backup=$(codelapse snapshot create "SECONDARY: Backup before $FEATURE_NAME" --tags "backup,experimental,secondary" --notes "Secondary backup for extra safety during experimental work" --json --silent)
secondary_backup_id=$(echo "$secondary_backup" | jq -r '.snapshot.id')

# 3. Implement feature in small, safe increments
declare -a IMPLEMENTATION_STEPS=(
    "Create basic structure"
    "Implement core functionality"
    "Add error handling"
    "Add tests"
    "Integration"
)

for i in "${!IMPLEMENTATION_STEPS[@]}"; do
    step="${IMPLEMENTATION_STEPS[$i]}"
    step_num=$((i + 1))

    echo "Step $step_num: $step"

    # Create step checkpoint
    step_backup=$(codelapse snapshot create "Step $step_num: $step" --tags "checkpoint,experimental" --notes "Checkpoint before: $step" --json --silent)
    step_backup_id=$(echo "$step_backup" | jq -r '.snapshot.id')

    # Implement step
    # ... your implementation logic for this step ...

    if [[ $? -ne 0 ]]; then
        echo "❌ Step $step_num failed, restoring from step checkpoint"
        codelapse snapshot restore "$step_backup_id" --backup --json --silent
        echo "Consider breaking this step into smaller parts"
        exit 1
    fi

    echo "✅ Step $step_num completed"
done

# 4. Final experimental feature documentation
codelapse snapshot create "🧪 EXPERIMENTAL: Completed $FEATURE_NAME" --tags "complete,experimental" --favorite --notes "Experimental feature '$FEATURE_NAME' implemented successfully. Steps completed: ${IMPLEMENTATION_STEPS[*]}. Requires testing and validation." --json --silent
echo "✅ Experimental feature implementation completed"
echo "⚠️  Remember: This is experimental and requires thorough testing"
```

## 🔄 BATCH OPERATION GUIDELINES

### Batch Safety Protocols

```bash
# Safe batch operation template
execute_batch_operation() {
    local operation_name="$1"
    local -n items_array=$2  # Array of items to process
    local max_failures=3    # Maximum allowed failures
    local failure_count=0

    echo "🔄 Starting batch operation: $operation_name"
    echo "Items to process: ${#items_array[@]}"

    # Create batch backup
    batch_backup=$(codelapse snapshot create "BATCH: Backup before $operation_name" --tags "backup,batch" --notes "Batch operation starting. Processing ${#items_array[@]} items." --json --silent)
    batch_backup_id=$(echo "$batch_backup" | jq -r '.snapshot.id')

    # Process each item with individual safety checks
    for i in "${!items_array[@]}"; do
        item="${items_array[$i]}"
        item_num=$((i + 1))

        echo "Processing item $item_num/${#items_array[@]}: $item"

        # Create item checkpoint
        item_backup=$(codelapse snapshot create "Batch item $item_num: $item" --tags "checkpoint,batch" --json --silent)
        item_backup_id=$(echo "$item_backup" | jq -r '.snapshot.id')

        # Process individual item
        if ! process_single_item "$item"; then
            ((failure_count++))
            echo "❌ Failed to process item: $item (Failure $failure_count/$max_failures)"

            # Restore from item checkpoint
            codelapse snapshot restore "$item_backup_id" --backup --json --silent

            # Check if we've exceeded failure threshold
            if [[ $failure_count -ge $max_failures ]]; then
                echo "❌ BATCH OPERATION ABORTED: Too many failures ($failure_count/$max_failures)"
                echo "🔄 Restoring from batch backup"
                codelapse snapshot restore "$batch_backup_id" --backup --json --silent
                return 1
            fi

            echo "⚠️  Continuing with remaining items..."
            continue
        fi

        echo "✅ Successfully processed: $item"
    done

    # Create batch completion snapshot
    successful_items=$((${#items_array[@]} - failure_count))
    codelapse snapshot create "BATCH COMPLETE: $operation_name" --tags "complete,batch" --favorite --notes "Batch operation completed. Successful: $successful_items/${#items_array[@]}, Failed: $failure_count" --json --silent

    echo "✅ Batch operation completed: $successful_items/${#items_array[@]} successful"
    return 0
}
```

### Batch Operation Best Practices

1. **Always process items individually** - Never bulk process without individual validation
2. **Set failure thresholds** - Define maximum acceptable failures before aborting
3. **Create checkpoints** - Snapshot before each item in the batch
4. **Implement rollback strategy** - Plan for partial or complete rollback
5. **Monitor progress** - Provide clear progress indicators
6. **Document failures** - Log which items failed and why

## 🤖 AUTOMATION SCENARIO EXAMPLES

### Scenario 1: Automated Code Review Fixes

```bash
#!/bin/bash
# Automated code review fix implementation

REVIEW_FIXES=(
    "Fix linting errors in utils.js"
    "Update deprecated API calls in api.js"
    "Add missing error handling in service.js"
)

echo "🔍 Starting automated code review fixes"

# Safety setup
if ! execute_safe_command "codelapse status --json --silent" "Connection check"; then
    exit 1
fi

review_backup=$(codelapse snapshot create "Code review fixes batch" --tags "backup,review,automated" --notes "Automated fixes for code review comments: ${REVIEW_FIXES[*]}" --json --silent)
review_backup_id=$(echo "$review_backup" | jq -r '.snapshot.id')

# Process each fix
for fix in "${REVIEW_FIXES[@]}"; do
    echo "Applying fix: $fix"

    # Create fix checkpoint
    fix_backup=$(codelapse snapshot create "Fix checkpoint: $fix" --tags "checkpoint,review" --json --silent)
    fix_backup_id=$(echo "$fix_backup" | jq -r '.snapshot.id')

    # Apply the fix (implement your fix logic here)
    case "$fix" in
        *"linting errors"*)
            # Run linter fixes
            if ! npm run lint:fix; then
                echo "❌ Linting fix failed"
                codelapse snapshot restore "$fix_backup_id" --backup --json --silent
                continue
            fi
            ;;
        *"deprecated API"*)
            # Update API calls
            # ... your API update logic ...
            ;;
        *"error handling"*)
            # Add error handling
            # ... your error handling logic ...
            ;;
    esac

    echo "✅ Applied fix: $fix"
done

codelapse snapshot create "Automated code review fixes completed" --tags "complete,review,automated" --favorite --json --silent
echo "✅ All code review fixes applied successfully"
```

### Scenario 2: Dependency Update Automation

```bash
#!/bin/bash
# Safe dependency update automation

DEPENDENCIES_TO_UPDATE=("lodash" "axios" "moment")

echo "📦 Starting automated dependency updates"

# Enhanced safety for dependency updates
deps_backup=$(codelapse snapshot create "DEPS: Before dependency updates" --tags "backup,dependencies,automated" --notes "Automated dependency updates for: ${DEPENDENCIES_TO_UPDATE[*]}" --json --silent)
deps_backup_id=$(echo "$deps_backup" | jq -r '.snapshot.id')

# Update each dependency individually
for dep in "${DEPENDENCIES_TO_UPDATE[@]}"; do
    echo "Updating dependency: $dep"

    # Create dependency checkpoint
    dep_backup=$(codelapse snapshot create "DEP: Before updating $dep" --tags "checkpoint,dependency" --json --silent)
    dep_backup_id=$(echo "$dep_backup" | jq -r '.snapshot.id')

    # Update dependency
    if npm update "$dep"; then
        # Run tests to verify update didn't break anything
        if npm test; then
            echo "✅ Successfully updated $dep"
        else
            echo "❌ Tests failed after updating $dep, rolling back"
            codelapse snapshot restore "$dep_backup_id" --backup --json --silent
        fi
    else
        echo "❌ Failed to update $dep"
        codelapse snapshot restore "$dep_backup_id" --backup --json --silent
    fi
done

codelapse snapshot create "Dependency updates completed" --tags "complete,dependencies,automated" --favorite --json --silent
echo "✅ Dependency update automation completed"
```

### Scenario 3: Automated Testing and Documentation

```bash
#!/bin/bash
# Automated testing and documentation generation

echo "🧪 Starting automated testing and documentation"

# Safety setup
test_backup=$(codelapse snapshot create "TEST: Before automated testing" --tags "backup,testing,automated" --notes "Automated testing and documentation generation" --json --silent)
test_backup_id=$(echo "$test_backup" | jq -r '.snapshot.id')

# Run comprehensive test suite
echo "Running test suite..."
if npm run test:full; then
    echo "✅ All tests passed"

    # Generate documentation
    echo "Generating documentation..."
    if npm run docs:generate; then
        echo "✅ Documentation generated successfully"

        # Create completion snapshot
        codelapse snapshot create "Automated testing and docs completed" --tags "complete,testing,docs,automated" --favorite --notes "All tests passed and documentation generated successfully" --json --silent
    else
        echo "❌ Documentation generation failed"
        codelapse snapshot restore "$test_backup_id" --backup --json --silent
        exit 1
    fi
else
    echo "❌ Tests failed, not proceeding with documentation"
    codelapse snapshot restore "$test_backup_id" --backup --json --silent
    exit 1
fi

echo "✅ Automated testing and documentation completed successfully"
```

## Quick Reference

| Task        | Command Template                                                                           |
| ----------- | ------------------------------------------------------------------------------------------ |
| Start       | `codelapse status --json --silent`                                                         |
| Backup      | `codelapse snapshot create "Backup before X" --tags "backup" --json --silent`              |
| Restore     | `codelapse snapshot restore [id] --backup --json --silent`                                 |
| Finish      | `codelapse snapshot create "Completed: X" --favorite --json --silent`                      |
| Batch Start | `codelapse snapshot create "BATCH: Backup before X" --tags "backup,batch" --json --silent` |
| Checkpoint  | `codelapse snapshot create "Checkpoint: X" --tags "checkpoint" --json --silent`            |
| Emergency   | `codelapse snapshot restore [backup-id] --backup --json --silent`                          |

## Critical Safety Rules

- **NEVER** skip the backup step
- **NEVER** ignore `success: false` in responses
- **NEVER** make destructive changes without user confirmation
- **ALWAYS** restore backup if operations fail
- **ALWAYS** inform user of any failures
- **ALWAYS** create final snapshot documenting changes

## Response Format

When executing commands, always:

1. Show the command you're running
2. Parse and report the success/failure
3. Extract relevant data from JSON response
4. Take appropriate action based on result

## Example Usage

```bash
# Starting a refactoring task
echo "Checking CodeLapse connection..."
result=$(codelapse status --json --silent)
if echo "$result" | jq -e '.success'; then
    echo "✓ Connected to workspace: $(echo "$result" | jq -r '.workspace')"
else
    echo "✗ Connection failed: $(echo "$result" | jq -r '.error')"
    exit 1
fi

echo "Creating backup snapshot..."
backup=$(codelapse snapshot create "Backup before refactoring auth module" --tags "backup" --notes "Initial state before starting authentication module refactor. Focus on migrating from old API to new secure endpoints." --json --silent)
backup_id=$(echo "$backup" | jq -r '.snapshot.id')
echo "✓ Backup created: $backup_id"

# ... perform your changes ...

echo "Creating completion snapshot..."
codelapse snapshot create "Refactored auth module for better error handling" --tags "refactor,complete" --favorite --json --silent
echo "✓ Task completed and documented"
```

Remember: When in doubt, create a snapshot. Better to have too many backups than lose user's work.
