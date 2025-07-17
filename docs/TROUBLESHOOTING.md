# CodeLapse Troubleshooting Guide

This comprehensive troubleshooting guide helps you resolve common issues with both the CodeLapse VS Code extension and CLI. Issues are organized by category with step-by-step solutions, diagnostic procedures, and escalation paths.

## Quick Diagnostic Checklist

Before diving into specific issues, run these quick checks:

1. **Extension Status**: Ensure CodeLapse extension is installed and enabled
2. **Workspace**: Verify a folder/workspace is open in VS Code
3. **Permissions**: Check file system permissions for the workspace
4. **Storage**: Confirm adequate disk space for snapshots
5. **Version**: Ensure you're running compatible versions

### Quick Diagnostic Commands

```bash
# Extension diagnostics (keyboard shortcut)
# Windows/Linux: Ctrl+Alt+D
# Mac: Cmd+Alt+D

# CLI diagnostics
codelapse status --verbose --json --silent
codelapse --version
```

---

## Extension Issues

### Installation and Activation

#### Problem: Extension not appearing in VS Code
**Symptoms**: CodeLapse not visible in Extensions panel or Activity Bar

**Solutions**:
1. **Verify Installation**:
   - Open Extensions panel (`Ctrl+Shift+X`)
   - Search for "CodeLapse" 
   - Ensure it shows "Installed" status
   - If not found, install from VS Code Marketplace

2. **Check Extension Status**:
   - Look for any error badges on the extension
   - Click on CodeLapse extension to view details
   - Check if it requires VS Code restart

3. **Manual Activation**:
   - Open Command Palette (`Ctrl+Shift+P`)
   - Run "Developer: Reload Window"
   - Try running "Snapshots: Getting Started"

4. **Compatibility Check**:
   - Verify VS Code version ≥ 1.60.0
   - Check system requirements (Windows/macOS/Linux)

#### Problem: Extension installed but not working
**Symptoms**: Extension visible but commands don't work, no Activity Bar icon

**Solutions**:
1. **Workspace Requirement**:
   - Open a folder in VS Code (File → Open Folder)
   - Extension requires an active workspace to function
   - Verify folder contains files (not empty)

2. **Reload Extension**:
   - Command Palette → "Developer: Reload Window"
   - Or restart VS Code completely

3. **Check Extension Host**:
   - Command Palette → "Developer: Show Running Extensions"
   - Verify CodeLapse is listed and running
   - Look for any error messages

4. **Reset Extension**:
   - Disable CodeLapse extension
   - Restart VS Code
   - Re-enable extension

### Snapshot Creation Issues

#### Problem: "Take Snapshot" command not working
**Symptoms**: Command appears but nothing happens, no progress notification

**Solutions**:
1. **Check File Changes**:
   - Ensure files have been modified since last snapshot
   - Save any unsaved changes (`Ctrl+S`)
   - Verify workspace contains files

2. **Permissions Check**:
   ```bash
   # Check workspace permissions
   ls -la /path/to/workspace
   
   # Check .snapshots directory
   ls -la /path/to/workspace/.snapshots
   ```

3. **Storage Space**:
   - Verify adequate disk space (at least 100MB recommended)
   - Check if `.snapshots` directory is writable

4. **File Exclusions**:
   - Review `.gitignore` and `.snapshotignore` files
   - Ensure not all files are being excluded
   - Temporarily rename ignore files to test

**Diagnostic Steps**:
1. Run "Snapshots: Run Diagnostics" (`Ctrl+Alt+D`)
2. Check Output panel → "CodeLapse" channel
3. Enable verbose logging in settings
4. Attempt snapshot creation again

#### Problem: Snapshots created but files missing
**Symptoms**: Snapshot appears in list but doesn't include expected files

**Solutions**:
1. **Check File Exclusions**:
   - Review `.gitignore` patterns
   - Check `.snapshotignore` for snapshot-specific exclusions
   - Verify file extensions aren't in binary exclusion list

2. **Binary File Handling**:
   - CodeLapse excludes binary files by default
   - Common excluded extensions: `.exe`, `.dll`, `.so`, `.dylib`, `.zip`, `.tar`, `.gz`
   - Images: `.jpg`, `.png`, `.gif`, `.bmp`, `.svg`

3. **Large File Limits**:
   - Files over certain size may be skipped
   - Check logs for "file too large" messages

4. **Selective Snapshot Verification**:
   - If using selective snapshots, verify correct files were selected
   - Check snapshot details in Snapshot Explorer

### Snapshot Restoration Issues

#### Problem: Restore operation fails
**Symptoms**: Error messages during restore, files not updated

**Solutions**:
1. **File Lock Check**:
   - Close files that might be locked by other applications
   - Ensure VS Code isn't preventing file writes
   - Check for running processes using workspace files

2. **Permissions Verification**:
   ```bash
   # Check file permissions
   ls -la /path/to/workspace/problematic-file
   
   # Fix permissions if needed (Unix/Mac)
   chmod 644 /path/to/workspace/problematic-file
   ```

3. **Disk Space**:
   - Ensure adequate space for file restoration
   - Clean up temporary files if needed

4. **Conflict Resolution**:
   - Handle unsaved changes before restore
   - Use "Take Snapshot & Restore" option when prompted
   - Or save/discard changes manually first

**Recovery Steps**:
1. Create backup snapshot before attempting restore
2. Try restoring individual files instead of entire snapshot
3. Use file comparison to verify expected changes
4. Check Output panel for detailed error messages

#### Problem: Restored files don't match expected content
**Symptoms**: Files restored but content is incorrect or outdated

**Solutions**:
1. **Snapshot Verification**:
   - Use "Compare File with Workspace" to verify snapshot content
   - Check snapshot timestamp and description
   - Ensure restoring correct snapshot ID

2. **Differential Storage Issues**:
   - Run "Snapshots: Run Diagnostics" to check storage integrity
   - Look for corruption warnings in logs
   - Consider re-creating snapshots if corruption detected

3. **File Encoding**:
   - Check for encoding issues (UTF-8 vs other formats)
   - Verify line ending consistency (LF vs CRLF)

### Navigation and UI Issues

#### Problem: Snapshot Explorer not showing snapshots
**Symptoms**: Empty Snapshot Explorer despite having snapshots

**Solutions**:
1. **Refresh Views**:
   - Click refresh icon in Snapshot Explorer title bar
   - Or run "Snapshots: Focus My Snapshots View"

2. **Filter Check**:
   - Look for active filters in view title bars
   - Click "Clear All Filters" (`$(clear-all)`) icon
   - Check Filter Status Bar item

3. **Storage Location**:
   - Verify `.snapshots` directory exists in workspace root
   - Check if custom snapshot location is configured correctly
   - Ensure `index.json` file exists and is readable

4. **View Expansion**:
   - Expand collapsed time groups (Today, Yesterday, etc.)
   - Check if snapshots exist in expected time ranges

#### Problem: Keyboard shortcuts not working
**Symptoms**: `Ctrl+Alt+S`, `Ctrl+Alt+B`, `Ctrl+Alt+N` don't respond

**Solutions**:
1. **Shortcut Conflicts**:
   - Check for conflicting keybindings in VS Code
   - File → Preferences → Keyboard Shortcuts
   - Search for "snapshot" to see current bindings

2. **Focus Issues**:
   - Ensure VS Code window has focus
   - Try clicking in editor area first
   - Some shortcuts require editor focus

3. **Platform Differences**:
   - Mac: Use `Cmd` instead of `Ctrl`
   - Linux: Verify window manager doesn't intercept shortcuts

4. **Custom Keybindings**:
   - Set custom shortcuts if defaults don't work
   - File → Preferences → Keyboard Shortcuts
   - Search for "Snapshots:" commands

### Performance Issues

#### Problem: Extension running slowly
**Symptoms**: Long delays for snapshot operations, UI lag

**Solutions**:
1. **Snapshot Cleanup**:
   - Reduce `maxSnapshots` setting (default: 50)
   - Delete old/unnecessary snapshots manually
   - Check total snapshot storage size

2. **File Exclusions**:
   - Ensure `node_modules/`, `.git/`, build directories are excluded
   - Add large directories to `.snapshotignore`
   - Review and optimize ignore patterns

3. **System Resources**:
   - Check available RAM and CPU usage
   - Close unnecessary VS Code extensions
   - Restart VS Code to clear memory

4. **Storage Optimization**:
   - Move `.snapshots` to faster storage (SSD vs HDD)
   - Ensure adequate free disk space
   - Consider workspace location (local vs network drive)

---

## CLI Issues

### Installation and Connection

#### Problem: CLI not found or command not recognized
**Symptoms**: `codelapse: command not found` or similar errors

**Solutions**:
1. **Installation Verification**:
   ```bash
   # Check if installed globally
   npm list -g codelapse-cli
   
   # Install if missing
   npm install -g codelapse-cli
   
   # Verify installation
   codelapse --version
   ```

2. **PATH Issues**:
   ```bash
   # Check npm global path
   npm config get prefix
   
   # Add to PATH if needed (Unix/Mac)
   export PATH=$PATH:$(npm config get prefix)/bin
   
   # Windows
   set PATH=%PATH%;%APPDATA%\npm
   ```

3. **Node.js Version**:
   - Ensure Node.js version ≥ 14.0.0
   - Update Node.js if needed
   - Verify npm is working: `npm --version`

#### Problem: "Failed to connect to CodeLapse extension"
**Symptoms**: CLI commands fail with connection errors

**Solutions**:
1. **Extension Status**:
   - Ensure VS Code is running
   - Verify CodeLapse extension is installed and enabled
   - Open a workspace folder in VS Code

2. **Connection Diagnostics**:
   ```bash
   # Test basic connectivity
   codelapse status --verbose
   
   # Extended timeout test
   codelapse status --timeout 15000 --json --silent
   
   # Check workspace info
   codelapse workspace info --json --silent
   ```

3. **Port/Socket Issues**:
   - Restart VS Code to reset connection
   - Check for firewall blocking local connections
   - Verify no other applications using same port

4. **Multiple VS Code Instances**:
   - Ensure connecting to correct VS Code window
   - Close unnecessary VS Code instances
   - Focus the workspace window you want to use

### Command Execution Issues

#### Problem: Commands hang or timeout
**Symptoms**: CLI commands don't complete, timeout after 5 seconds

**Solutions**:
1. **Increase Timeout**:
   ```bash
   # Use longer timeout for slow operations
   codelapse snapshot create "Test" --timeout 30000 --json --silent
   
   # Set global timeout
   codelapse --timeout 15000 status
   ```

2. **System Performance**:
   - Check CPU and memory usage
   - Close resource-intensive applications
   - Ensure adequate system resources

3. **Large Workspace Handling**:
   ```bash
   # Use selective operations for large workspaces
   codelapse snapshot create "Selective" --files "src/,tests/" --json --silent
   
   # Limit result sets
   codelapse snapshot list --limit 10 --json --silent
   ```

#### Problem: JSON parsing errors in automation
**Symptoms**: Scripts fail with "Invalid JSON" errors

**Solutions**:
1. **Proper Flag Usage**:
   ```bash
   # Always use --json --silent for automation
   codelapse snapshot list --json --silent
   
   # Validate JSON before parsing
   RESULT=$(codelapse status --json --silent)
   if echo "$RESULT" | jq empty 2>/dev/null; then
     echo "Valid JSON"
   else
     echo "Invalid JSON: $RESULT"
   fi
   ```

2. **Error Handling**:
   ```bash
   # Robust error handling
   RESULT=$(codelapse snapshot create "Test" --json --silent 2>/dev/null || echo '{"success":false,"error":"Command failed"}')
   SUCCESS=$(echo "$RESULT" | jq -r '.success')
   
   if [ "$SUCCESS" = "true" ]; then
     echo "Success"
   else
     ERROR=$(echo "$RESULT" | jq -r '.error')
     echo "Failed: $ERROR"
   fi
   ```

### Semantic Search Issues ⚠️ **(Experimental - Security Risks)**

> ⚠️ **CRITICAL SECURITY WARNING**: Before troubleshooting semantic search issues, understand the security implications:
> - **Data Exposure**: Your code content is transmitted to external AI services (Pinecone, Gemini)
> - **API Key Risks**: Third-party services require API keys with potential security implications
> - **Privacy Concerns**: Code is processed by external providers over the internet
> - **Compliance Issues**: May violate organizational security policies
> - **Cost Impact**: API usage may result in unexpected charges
> - **NOT RECOMMENDED** for proprietary, sensitive, or confidential codebases

#### Problem: "API key not configured" errors
**Symptoms**: Search commands fail with API key errors, semantic search features unavailable

**Solutions**:
1. **Configure API Keys Securely**:
   - Use Settings view in VS Code Snapshot Explorer → API Keys section
   - Click on "Pinecone API Key" or "Gemini API Key" to configure
   - Enter keys in secure input dialog (keys will be masked)
   - Verify keys are stored by checking they appear as masked in UI

2. **Validate API Key Security**:
   - Ensure API keys have minimal required permissions
   - Use dedicated keys for CodeLapse (not shared with other applications)
   - Monitor API usage and costs after configuration
   - Review API provider terms of service and privacy policies

3. **Key Validation and Testing**:
   ```bash
   # Test API connectivity with caution (uses real API calls)
   codelapse search index --json --silent
   ```

4. **Alternative: Disable Semantic Search**:
   - If security concerns outweigh benefits, disable the feature
   - Settings view → Semantic Search → Set "Enable" to "No"
   - Or set `vscode-snapshots.semanticSearch.enabled` to `false`

5. **Network and Connectivity**:
   - Verify internet connectivity to external AI services
   - Check firewall settings that might block API calls
   - Test API connectivity with minimal, non-sensitive data first

#### Problem: "Search index not found" errors
**Symptoms**: Search queries return no results, index errors, or "index not available" messages

**Solutions**:
1. **Build Search Index (Security Warning)**:
   ```bash
   # CLI: Index all snapshots (CAUTION: sends code to external services)
   codelapse search index --all --json --silent
   
   # CLI: Index specific snapshots only (more secure approach)
   codelapse search index --snapshots "snapshot-123,snapshot-124" --json --silent
   ```
   
   - **VS Code**: Use "Snapshots: Index All Snapshots for Search" command
   - **WARNING**: Indexing sends your code content to external AI services
   - Monitor indexing progress in Output panel
   - Verify adequate disk space for index files

2. **Index Validation and Troubleshooting**:
   - Check `.snapshots` directory for index-related files
   - Verify snapshots exist before attempting to index
   - Monitor API usage during indexing process
   - Check Output panel for indexing errors or warnings

3. **Selective Indexing for Security**:
   - Index only non-sensitive snapshots
   - Use snapshot tags to identify safe-to-index snapshots
   - Consider creating separate workspace for experimental features

#### Problem: "API rate limits exceeded" or "API quota exhausted"
**Symptoms**: Search operations fail with rate limit or quota errors, unexpected API charges

**Solutions**:
1. **Monitor and Control API Usage**:
   - Check API provider dashboards for usage statistics
   - Set up usage alerts and spending limits
   - Review API pricing and quota limits

2. **Optimize Search Usage**:
   - Reduce search frequency and batch operations
   - Use more specific search queries to reduce processing
   - Disable auto-indexing (`semanticSearch.autoIndex: false`)
   - Index selectively rather than all snapshots

3. **Emergency Procedures**:
   - Immediately disable semantic search if costs are excessive
   - Review and revoke API keys if necessary
   - Contact API providers to understand usage patterns

#### Problem: "Network errors" or "API service unavailable"
**Symptoms**: Intermittent failures, timeout errors, service connectivity issues

**Solutions**:
1. **Network Diagnostics**:
   - Verify internet connectivity
   - Check corporate firewall/proxy settings
   - Test connectivity to API endpoints directly
   - Review network security policies

2. **Retry and Fallback Strategies**:
   - Wait and retry operations (services may be temporarily unavailable)
   - Check API provider status pages for service outages
   - Consider disabling feature during network issues

3. **Security Considerations**:
   - Verify network traffic is properly encrypted (HTTPS)
   - Review network logs for any security concerns
   - Ensure compliance with organizational network policies

#### Complete Disable Procedures

If security concerns outweigh benefits, completely disable semantic search:

1. **Disable in Settings**:
   - Settings view → Semantic Search → Set "Enable" to "No"
   - Or set `vscode-snapshots.semanticSearch.enabled` to `false`

2. **Remove API Keys**:
   - Settings view → API Keys → Clear both Pinecone and Gemini keys
   - Verify keys are removed from VS Code SecretStorage

3. **Clean Up Index Files**:
   - Remove any local index files from `.snapshots` directory
   - Clear any cached search data

4. **Verify Disablement**:
   - Confirm semantic search commands are no longer available
   - Check that no API calls are being made
   - Monitor for any residual network activity

---

## Configuration Issues

### Settings Not Applying

#### Problem: Changed settings don't take effect
**Symptoms**: Modified settings appear to be ignored

**Solutions**:
1. **Settings Scope**:
   - Check if setting is workspace vs user-level
   - Workspace settings override user settings
   - Verify correct `settings.json` file

2. **Setting Format**:
   ```json
   // Correct format in settings.json
   {
     "vscode-snapshots.maxSnapshots": 100,
     "vscode-snapshots.autoSnapshotInterval": 30,
     "vscode-snapshots.snapshotLocation": ".snapshots"
   }
   ```

3. **Reload Required**:
   - Some settings require VS Code restart
   - Use "Developer: Reload Window" command
   - Check if setting description mentions restart requirement

#### Problem: Auto-snapshot rules not working
**Symptoms**: Rule-based auto-snapshots not triggering

**Solutions**:
1. **Rule Configuration**:
   ```json
   // Example auto-snapshot rules
   {
     "vscode-snapshots.autoSnapshot.rules": [
       {
         "pattern": "src/**/*.ts",
         "intervalMinutes": 15
       },
       {
         "pattern": "config/*.json",
         "intervalMinutes": 30
       }
     ]
   }
   ```

2. **Pattern Verification**:
   - Test glob patterns with file matching
   - Ensure patterns match intended files
   - Check for typos in file extensions

3. **Timing Issues**:
   - Verify interval has elapsed since last auto-snapshot
   - Check Output panel for rule processing logs
   - Enable verbose logging for detailed rule execution

---

## Storage and File System Issues

### Snapshot Storage Problems

#### Problem: ".snapshots directory not writable"
**Symptoms**: Permission errors when creating snapshots

**Solutions**:
1. **Permission Fix (Unix/Mac)**:
   ```bash
   # Fix directory permissions
   chmod 755 /path/to/workspace/.snapshots
   
   # Fix file permissions
   find /path/to/workspace/.snapshots -type f -exec chmod 644 {} \;
   ```

2. **Windows Permissions**:
   - Right-click `.snapshots` folder → Properties → Security
   - Ensure current user has "Full Control"
   - Check if folder is read-only

3. **Ownership Issues**:
   ```bash
   # Fix ownership (Unix/Mac)
   sudo chown -R $USER:$USER /path/to/workspace/.snapshots
   ```

#### Problem: Snapshot corruption or invalid data
**Symptoms**: Snapshots appear but can't be restored, data integrity errors

**Solutions**:
1. **Integrity Check**:
   ```bash
   # CLI integrity validation
   codelapse utility validate snapshot-123 --json --silent
   ```

2. **Manual Verification**:
   - Check `.snapshots/index.json` for valid JSON
   - Verify individual snapshot directories exist
   - Look for incomplete or corrupted snapshot files

3. **Recovery Options**:
   - Restore from backup if available
   - Re-create snapshots from Git history
   - Clean up corrupted snapshots and start fresh

### Disk Space Issues

#### Problem: "Insufficient disk space" errors
**Symptoms**: Snapshot creation fails due to space limitations

**Solutions**:
1. **Space Analysis**:
   ```bash
   # Check available space
   df -h /path/to/workspace
   
   # Check snapshot directory size
   du -sh /path/to/workspace/.snapshots
   ```

2. **Cleanup Strategies**:
   - Reduce `maxSnapshots` setting
   - Delete old snapshots manually
   - Clean up large binary files from snapshots
   - Move workspace to drive with more space

3. **Storage Optimization**:
   - Review `.snapshotignore` to exclude unnecessary files
   - Consider external storage for `.snapshots` directory
   - Implement regular cleanup procedures

---

## Integration Issues

### Git Integration Problems

#### Problem: "Create Git Commit from Snapshot" not working
**Symptoms**: Command fails or doesn't appear in context menu

**Solutions**:
1. **Feature Enablement**:
   - Verify `vscode-snapshots.git.commitFromSnapshotEnabled` is `true`
   - Check if Git is installed and accessible
   - Ensure workspace is a Git repository

2. **Git Status Check**:
   ```bash
   # Verify Git repository
   git status
   
   # Check Git configuration
   git config --list
   ```

3. **Staging Issues**:
   - Ensure Git working directory is clean
   - Handle any merge conflicts first
   - Check for uncommitted changes

#### Problem: Auto-snapshot before Git operations not working
**Symptoms**: No snapshots created before Git pull/merge/rebase

**Solutions**:
1. **Setting Verification**:
   - Enable `vscode-snapshots.git.autoSnapshotBeforeOperation`
   - Ensure Git operations are performed through VS Code
   - External Git commands won't trigger auto-snapshots

2. **Git Extension Compatibility**:
   - Verify VS Code Git extension is enabled
   - Check for conflicts with other Git extensions
   - Update VS Code and Git extension to latest versions

### CI/CD Integration Issues

#### Problem: CLI fails in automated environments
**Symptoms**: Scripts work locally but fail in CI/CD pipelines

**Solutions**:
1. **Environment Setup**:
   ```yaml
   # GitHub Actions example
   - name: Setup Node.js
     uses: actions/setup-node@v3
     with:
       node-version: '18'
   
   - name: Install CodeLapse CLI
     run: npm install -g codelapse-cli
   
   - name: Verify installation
     run: codelapse --version
   ```

2. **Headless Operation**:
   - Use `--json --silent` flags consistently
   - Avoid interactive prompts
   - Handle timeouts appropriately

3. **Permission Issues**:
   ```bash
   # Fix npm permissions in CI
   npm config set prefix ~/.npm-global
   export PATH=~/.npm-global/bin:$PATH
   ```

---

## Diagnostic Procedures

### Extension Diagnostics

#### Comprehensive Health Check
1. **Run Built-in Diagnostics**:
   - Command: `Ctrl+Alt+D` (or `Cmd+Alt+D` on Mac)
   - Review all diagnostic results
   - Note any warnings or errors

2. **Log Analysis**:
   - Open Output panel (`Ctrl+Shift+U`)
   - Select "CodeLapse" from dropdown
   - Enable verbose logging if needed
   - Look for error patterns or warnings

3. **Settings Verification**:
   - Check all CodeLapse settings for invalid values
   - Verify file paths exist and are accessible
   - Test with default settings if issues persist

#### Performance Diagnostics
1. **Resource Usage**:
   - Monitor VS Code memory usage
   - Check CPU usage during snapshot operations
   - Measure snapshot creation/restoration times

2. **Storage Analysis**:
   ```bash
   # Analyze snapshot storage
   du -sh .snapshots/
   find .snapshots/ -name "*.json" | wc -l
   ls -la .snapshots/index.json
   ```

### CLI Diagnostics

#### Connection Testing
```bash
# Basic connectivity
codelapse status --verbose

# Extended diagnostics
codelapse status --timeout 30000 --json --silent

# Workspace verification
codelapse workspace info --json --silent

# API method testing
codelapse api getSnapshots --data '{"limit": 1}' --json --silent
```

#### Performance Testing
```bash
# Measure command execution time
time codelapse snapshot list --json --silent

# Test with different timeouts
codelapse snapshot create "Performance test" --timeout 10000 --json --silent

# Batch operation testing
echo '[{"method": "getSnapshots", "data": {"limit": 5}}]' | codelapse batch --json --silent
```

---

## Self-Help Procedures

### Quick Fixes Checklist

Before seeking help, try these common solutions:

1. **Restart VS Code**: Solves many temporary issues
2. **Reload Window**: `Ctrl+Shift+P` → "Developer: Reload Window"
3. **Check Workspace**: Ensure folder is open and contains files
4. **Verify Permissions**: Check file system permissions
5. **Clear Filters**: Remove any active snapshot filters
6. **Update Extension**: Ensure latest version is installed
7. **Check Settings**: Verify configuration values are correct

### Information Gathering

When issues persist, collect this information:

#### System Information
```bash
# Operating system and version
uname -a  # Unix/Mac
systeminfo  # Windows

# VS Code version
code --version

# Extension version
# Check in VS Code Extensions panel

# Node.js and npm versions (for CLI)
node --version
npm --version
```

#### Extension Information
- Run "Snapshots: Run Diagnostics" and save output
- Check Output panel → "CodeLapse" for recent logs
- Note any error messages or warnings
- Document steps to reproduce the issue

#### CLI Information
```bash
# CLI version and status
codelapse --version
codelapse status --verbose --json --silent

# Environment details
echo $PATH  # Unix/Mac
echo %PATH%  # Windows

# Workspace information
codelapse workspace info --json --silent
```

---

## Escalation Paths

### Community Support

1. **Documentation Review**:
   - [User Guide](USER_GUIDE.md) - Comprehensive usage instructions
   - [Git Integration Guide](GIT_COMPANION.md) - Git integration workflows
   - [Developer Guide](DEVELOPER_GUIDE.md) - Technical details and contribution info

2. **GitHub Repository**:
   - Search existing issues for similar problems
   - Review closed issues for solutions
   - Check project wiki and documentation

### Bug Reporting

When reporting issues, include:

#### Required Information
- **Environment**: OS, VS Code version, extension version
- **Steps to Reproduce**: Exact sequence that causes the issue
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Error Messages**: Complete error text and stack traces
- **Diagnostic Output**: Results from diagnostic commands

#### Issue Template
```markdown
**Environment:**
- OS: [Windows 10/macOS 12.0/Ubuntu 20.04]
- VS Code: [version]
- CodeLapse Extension: [version]
- CodeLapse CLI: [version if applicable]

**Description:**
[Clear description of the issue]

**Steps to Reproduce:**
1. [First step]
2. [Second step]
3. [Third step]

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**Error Messages:**
```
[Complete error messages]
```

**Diagnostic Information:**
```
[Output from diagnostic commands]
```

**Additional Context:**
[Any other relevant information]
```

### Feature Requests

For feature requests:
1. Check existing feature requests to avoid duplicates
2. Provide clear use case and business justification
3. Include mockups or examples if applicable
4. Consider implementation complexity and maintenance burden

### Emergency Procedures

#### Data Recovery
If snapshots are corrupted or lost:

1. **Immediate Actions**:
   - Stop using the extension to prevent further data loss
   - Create backup of current `.snapshots` directory
   - Document what was lost and when

2. **Recovery Attempts**:
   ```bash
   # Check for backup files
   find .snapshots/ -name "*.backup" -o -name "*.bak"
   
   # Verify index integrity
   jq . .snapshots/index.json
   
   # List all snapshot directories
   ls -la .snapshots/snapshot-*/
   ```

3. **Alternative Recovery**:
   - Check Git history for recoverable states
   - Look for temporary files or editor backups
   - Consider file system recovery tools if necessary

#### Critical System Issues
For system-wide problems:

1. **Isolation Testing**:
   - Test with minimal VS Code setup (disable other extensions)
   - Try different workspace/project
   - Test on different user account if possible

2. **Safe Mode**:
   - Start VS Code with `code --disable-extensions`
   - Enable only CodeLapse extension
   - Test basic functionality

3. **Clean Installation**:
   - Uninstall CodeLapse extension completely
   - Clear extension data and settings
   - Reinstall from marketplace
   - Reconfigure with minimal settings

---

## Prevention and Best Practices

### Proactive Maintenance

1. **Regular Cleanup**:
   - Review and delete old snapshots monthly
   - Monitor `.snapshots` directory size
   - Update ignore files as project evolves

2. **Configuration Management**:
   - Document custom settings and their purposes
   - Back up workspace settings
   - Test setting changes in non-critical environments

3. **Monitoring**:
   - Enable logging for early issue detection
   - Monitor extension performance regularly
   - Watch for VS Code and extension updates

### Risk Mitigation

1. **Backup Strategies**:
   - Regular Git commits for important changes
   - External backup of `.snapshots` directory
   - Document critical snapshots and their purposes

2. **Testing Procedures**:
   - Test new extension versions in development environments
   - Validate critical workflows after updates
   - Maintain rollback procedures for configuration changes

3. **Team Coordination**:
   - Share troubleshooting knowledge with team members
   - Document common issues and solutions
   - Establish escalation procedures for critical issues

---

## Additional Resources

### Documentation Links
- [User Guide](USER_GUIDE.md) - Complete usage documentation
- [Git Companion Guide](GIT_COMPANION.md) - Git integration workflows
- [Developer Guide](DEVELOPER_GUIDE.md) - Technical implementation details
- [CLI README](../cli/README.md) - Command-line interface documentation

### External Resources
- VS Code Extension Development Documentation
- Node.js and npm troubleshooting guides
- Git documentation and troubleshooting
- File system permission guides for your operating system

### Community
- GitHub Issues for bug reports and feature requests
- Extension marketplace reviews and ratings
- Developer community forums and discussions

---

*This troubleshooting guide is regularly updated based on user feedback and common issues. If you encounter problems not covered here, please report them so we can improve this documentation.*