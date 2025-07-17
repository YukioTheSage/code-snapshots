# CodeLapse - Your Development Time Machine ⏰

**Stop losing code. Start exploring fearlessly.**

CodeLapse is the missing link between your IDE's autosave and Git's formal commits. Create instant, zero-friction snapshots of your work and navigate through your development journey like never before.

🚀 **One keystroke. Instant backup. Zero mental overhead.**

## 🛠️ Two Powerful Tools, One Seamless Experience

**🎯 VS Code Extension**: Visual, interactive snapshot management right in your editor
**⚡ CLI Tool**: Automation-ready command-line interface for developers, AI agents, and CI/CD pipelines

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/YukioTheSage.vscode-snapshots)](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/YukioTheSage.vscode-snapshots)](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/YukioTheSage.vscode-snapshots)](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)

---

## 🎯 Why CodeLapse?

**The Problem**: You're deep in a coding session. You want to try a risky refactor, but you're afraid of breaking what's working. Git feels too heavy for quick experiments, and you end up either:

- Not trying the idea (missed opportunity)
- Trying it and losing your progress (frustration)
- Creating messy WIP commits (polluted history)

**The Solution**: CodeLapse gives you the confidence to explore. One keystroke creates a perfect snapshot. Try anything. Break everything. Restore instantly.

### 🔥 Core Benefits

- **🎯 Fearless Development**: Experiment without anxiety
- **⚡ Zero Friction**: One key press, no forms, no decisions
- **🧠 Mental Freedom**: No commit message fatigue
- **🔄 Instant Recovery**: Jump between any point in time
- **🤝 Git Harmony**: Works alongside, never conflicts with Git
- **🔍 Smart Search**: Find any code across your entire history _(Experimental)_

> ⚠️ **EXPERIMENTAL FEATURE WARNING**: Semantic search is currently experimental with potential risks:
>
> - **API Key Security**: Requires third-party API keys that may expose code to external services
> - **Data Privacy**: Code content is processed by external AI services (Pinecone, Gemini)
> - **Functionality Changes**: Features may change or be removed without notice
> - **Performance Impact**: May affect extension performance and consume API quotas
> - **Use at your own risk** and avoid on sensitive/proprietary codebases

---

## 📊 CodeLapse vs Git - Better Together

| **Scenario**                 | **CodeLapse**                  | **Git**                          | **Best Choice** |
| ---------------------------- | ------------------------------ | -------------------------------- | --------------- |
| 🧪 **Quick Experiments**     | ✅ One keystroke, try anything | ❌ Too formal, requires planning | **CodeLapse**   |
| 💾 **Save Work-in-Progress** | ✅ Instant, no commit message  | ❌ Messy WIP commits             | **CodeLapse**   |
| 🔄 **Multiple Save Points**  | ✅ Perfect for rapid iteration | ❌ Clutters history              | **CodeLapse**   |
| 👥 **Team Collaboration**    | ❌ Local only                  | ✅ Built for sharing             | **Git**         |
| 📚 **Project History**       | ❌ Personal snapshots          | ✅ Formal version control        | **Git**         |
| 🎯 **Feature Development**   | ❌ Not structured              | ✅ Logical commits               | **Git**         |
| 🛡️ **Safety Net**            | ✅ Zero overhead protection    | ✅ Formal protection             | **Both!**       |

**The Magic**: Use both tools together. Git for your formal commits, CodeLapse for your personal development flow.

---

## 🚀 Quick Start

### VS Code Extension Installation

1. **From VS Code Marketplace**:

   - Open VS Code
   - Go to Extensions (`Ctrl+Shift+X`)
   - Search for "CodeLapse"
   - Click "Install"

2. **From Command Line**:
   ```bash
   code --install-extension YukioTheSage.vscode-snapshots
   ```

### CLI Tool Installation

> ⚠️ **Prerequisites**: The CLI requires the VS Code extension to be installed and running to function properly.

```bash
# Install globally via npm
npm install -g codelapse-cli

# Or use npx for one-time usage
npx codelapse-cli --help

# Verify installation and connection
codelapse status --json --silent
```

### First steps

1. **📁 Open your project** in VS Code
2. **⌨️ Take your first snapshot**: Press `Ctrl+Alt+S` (or `Cmd+Alt+S` on Mac)
3. **🎯 Choose snapshot type**:
   - **Quick Snapshot**: Instant, no questions asked
   - **Detailed Snapshot**: Add tags, notes, and context
4. **🧪 Make some changes** to your code
5. **🔄 Navigate snapshots**: Use `Ctrl+Alt+B` (back) / `Ctrl+Alt+N` (next)
6. **👀 Browse visually**: Check the **Snapshots** panel in the Activity Bar

**🎉 That's it!** You're now protected by CodeLapse. Experiment fearlessly!

---

## ✨ Features at a Glance

<details>
<summary><strong>🎯 Core Snapshot Features</strong></summary>

- **⚡ One-Key Snapshots**: `Ctrl+Alt+S` - instant backup
- **🔄 Time Navigation**: Jump between any point in your development
- **📊 Visual Timeline**: See your progress in the Snapshots panel
- **📈 Status Tracking**: Status bar shows time since last snapshot
- **🔍 Smart Search**: Find code across all snapshots _(Experimental)_

</details>

<details>
<summary><strong>🛠️ Advanced Snapshot Management</strong></summary>

- **📝 Rich Context**: Add tags, notes, and task references
- **⭐ Favorites**: Mark important snapshots
- **🔍 Powerful Filtering**: By date, tags, files, or favorites
- **📋 Selective Snapshots**: Choose specific files to include
- **🔄 File Restoration**: Restore individual files or entire snapshots

</details>

<details>
<summary><strong>🤖 Automation & Efficiency</strong></summary>

- **⏰ Auto-Snapshots**: Time-based automatic backups
- **📋 Smart Rules**: Auto-snapshot specific file patterns
- **📊 Visual Indicators**: See changed lines in editor gutters
- **⚡ Performance**: Efficient storage with differential compression
- **🚫 Smart Exclusion**: Respects `.gitignore` and `.snapshotignore`

</details>

<details>
<summary><strong>🤝 Git Integration</strong></summary>

- **📝 Branch Context**: Store Git branch/commit info with snapshots
- **🔄 Git Commands**: Create commits directly from snapshots
- **🛡️ Safety Net**: Auto-snapshot before Git operations
- **🤝 Perfect Harmony**: Works alongside Git without conflicts

</details>

---

## 🖥️ CLI Tool - Automation & Integration Ready

The **CodeLapse CLI** (`codelapse-cli`) brings the power of CodeLapse to your terminal, automation scripts, and CI/CD pipelines. Perfect for developers, AI agents, and DevOps workflows.

### 🎯 Who Uses the CLI?

<details>
<summary><strong>👨‍💻 For Developers</strong></summary>

**Interactive Development Workflow**
```bash
# Create checkpoint before risky changes
codelapse snapshot create "Before refactoring auth system" --tags "checkpoint,auth"

# Work on your code...

# Create snapshot after major milestone
codelapse snapshot create "Auth refactor complete" --tags "feature,auth" --favorite

# Compare changes between snapshots
codelapse snapshot compare snapshot-123 snapshot-124

# Navigate through your development timeline
codelapse snapshot navigate next
```

**Code Review & Collaboration**
```bash
# Export snapshot for sharing with team
codelapse utility export snapshot-123 --format zip --output ./auth-feature.zip

# Validate snapshot integrity before sharing
codelapse utility validate snapshot-123

# Show detailed snapshot with specific file content
codelapse snapshot show snapshot-123 --files --content src/auth.ts
```

</details>

<details>
<summary><strong>🤖 For AI Agents & Automation</strong></summary>

**Safety-First AI Operations**
```bash
# 1. ALWAYS create backup before AI operations
BACKUP_ID=$(codelapse snapshot create "AI: Pre-operation backup" --tags "backup,ai" --json --silent | jq -r '.snapshot.id')

# 2. Execute AI operations with error handling
if codelapse snapshot restore snapshot-123 --backup --json --silent; then
  echo "✅ Operation successful"
else
  echo "❌ Operation failed, restoring backup"
  codelapse snapshot restore "$BACKUP_ID" --json --silent
fi

# 3. Document completed work
codelapse snapshot create "AI: Completed refactoring task" --tags "complete,ai" --favorite --json --silent
```

**Batch Processing & Real-time Monitoring**
```bash
# Execute multiple operations from JSON file
cat > ai-workflow.json << EOF
[
  { "method": "takeSnapshot", "data": { "description": "Pre-operation backup", "tags": ["backup"] } },
  { "method": "getSnapshots", "data": { "tags": ["feature"], "limit": 5 } },
  { "method": "takeSnapshot", "data": { "description": "Post-operation state", "tags": ["complete"] } }
]
EOF

codelapse batch ai-workflow.json --json --silent

# Monitor workspace changes for reactive workflows
codelapse watch --events snapshots,workspace --json | while read -r event; do
  echo "Processing event: $event"
  # Add your AI logic here
done
```

</details>

<details>
<summary><strong>🔧 For DevOps & CI/CD</strong></summary>

**CI/CD Pipeline Integration**
```bash
# Pre-deployment snapshot with Git context
codelapse snapshot create "Pre-deployment: $(git rev-parse --short HEAD)" \
  --tags "deployment,$(git branch --show-current)" --json --silent

# Validate workspace state before deployment
codelapse workspace state --json --silent

# Create release snapshot with version tagging
codelapse snapshot create "Release v$(cat package.json | jq -r .version)" \
  --tags "release,production" --favorite --json --silent
```

**Automated Testing Workflows**
```bash
# Create test checkpoint
codelapse snapshot create "Before test run" --tags "test,checkpoint" --json --silent

# Run tests and capture results
if npm test; then
  codelapse snapshot create "Tests passed: $(date)" --tags "test,success" --json --silent
else
  codelapse snapshot create "Tests failed: $(date)" --tags "test,failure" --json --silent
  # Optionally restore to last known good state
  codelapse snapshot restore last-good-snapshot --backup --json --silent
fi
```

</details>

### 🚀 Key CLI Features

- **🔄 Complete Snapshot Management**: Create, list, restore, delete, and compare snapshots
- **🔍 Semantic Search**: Natural language code search across all snapshots _(Experimental)_
- **📊 Workspace Monitoring**: Real-time workspace state and file change tracking
- **🤖 AI-Friendly**: JSON output, silent mode, and structured error handling
- **⚡ Batch Operations**: Execute multiple commands from configuration files
- **🛡️ Safety Features**: Automatic backups, validation, and rollback capabilities
- **📈 Real-time Events**: Stream workspace and snapshot events for reactive workflows

### 📖 CLI Quick Reference

```bash
# Connection & Status
codelapse status --json --silent                    # Check extension connection

# Snapshot Operations
codelapse snapshot create "My changes" --tags "wip" # Create snapshot
codelapse snapshot list --tags "feature" --limit 10 # List with filters
codelapse snapshot restore snapshot-123 --backup    # Restore with backup
codelapse snapshot compare snap-1 snap-2 --files    # Compare snapshots

# Semantic Search (Experimental)
codelapse search query "authentication code" --limit 5
codelapse search index --all                        # Build search index

# Workspace Management
codelapse workspace info --json --silent            # Workspace information
codelapse workspace files --changed                 # Show changed files

# Utilities
codelapse utility validate snapshot-123             # Validate snapshot
codelapse utility export snap-123 --format zip     # Export snapshot
codelapse batch commands.json --json --silent      # Batch operations
```

### 🔗 Integration Examples

<details>
<summary><strong>GitHub Actions Integration</strong></summary>

```yaml
name: CodeLapse Integration
on: [push, pull_request]

jobs:
  test-with-codelapse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install CodeLapse CLI
        run: npm install -g codelapse-cli
      
      - name: Create pre-test snapshot
        run: codelapse snapshot create "CI: Pre-test snapshot" --tags "ci,test" --json --silent
      
      - name: Run tests
        run: npm test
      
      - name: Create post-test snapshot
        run: codelapse snapshot create "CI: Post-test snapshot" --tags "ci,success" --json --silent
```

</details>

<details>
<summary><strong>Docker Integration</strong></summary>

```dockerfile
FROM node:18-alpine

# Install CodeLapse CLI
RUN npm install -g codelapse-cli

# Copy application
COPY . /app
WORKDIR /app

# Create deployment snapshot
RUN codelapse snapshot create "Docker: Pre-build snapshot" --tags "docker,build" --json --silent || true

# Build application
RUN npm install && npm run build

# Create post-build snapshot
RUN codelapse snapshot create "Docker: Post-build snapshot" --tags "docker,complete" --json --silent || true
```

</details>

---

## 📚 Documentation & Support

| **Getting Started**                           | **Advanced Usage**                             | **Development**                                         |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| 📖 [User Guide](docs/USER_GUIDE.md)           | 🤝 [Git Integration](docs/GIT_COMPANION.md)    | 🔧 [Developer Guide](docs/DEVELOPER_GUIDE.md)           |
| 🚀 [Quick Start](#-quick-start)               | ⚙️ [Configuration](#-configuration)            | 🗺️ [Roadmap](docs/ROADMAP.md)                           |
| ⚡ [CLI Guide](cli/README.md)                  | 🔬 [Semantic Search](docs/SEMANTIC_ROADMAP.md) | 🤝 [Contributing](docs/DEVELOPER_GUIDE.md#contributing) |
| ❓ [Troubleshooting](docs/TROUBLESHOOTING.md) | 🤖 [AI Agent Guidelines](cli/README.md#ai-agent-guidelines) | 📦 [NPM Package](https://www.npmjs.com/package/codelapse-cli) |

---

## ⚙️ Configuration

<details>
<summary><strong>📋 Core Settings</strong></summary>

- `vscode-snapshots.snapshotLocation`: Where to store snapshot data (default: `.snapshots`)
- `vscode-snapshots.maxSnapshots`: Maximum number of snapshots to keep (default: `50`)
- `vscode-snapshots.autoSnapshotInterval`: Interval for automatic snapshots in minutes (default: `0` - disabled)
- `vscode-snapshots.loggingEnabled`: Enable detailed logging (default: `true`)

</details>

<details>
<summary><strong>🤝 Git Integration Settings</strong></summary>

- `vscode-snapshots.git.addCommitInfo`: Store Git branch/commit with snapshots (default: `true`)
- `vscode-snapshots.git.commitFromSnapshotEnabled`: Enable "Create Git Commit from Snapshot" command (default: `true`)
- `vscode-snapshots.git.autoSnapshotBeforeOperation`: Auto-snapshot before Git pull/merge/rebase (default: `false`)

</details>

<details>
<summary><strong>🔬 Semantic Search Settings (Experimental)</strong></summary>

> ⚠️ **EXPERIMENTAL FEATURE - SECURITY RISKS**:
>
> - **Data Privacy**: Your code is sent to external AI services (Pinecone, Gemini)
> - **API Key Security**: Third-party services require API keys with potential access risks
> - **Network Exposure**: Code content transmitted over internet to external providers
> - **Quota Costs**: API usage may incur charges on your accounts
> - **Functionality Changes**: Features may change or be removed without notice
> - **NOT RECOMMENDED** for proprietary, sensitive, or confidential codebases

**Basic Settings:**

- `vscode-snapshots.semanticSearch.enabled`: Enable semantic code search (default: `true`)
- `vscode-snapshots.semanticSearch.chunkSize`: Maximum token size for code chunks (default: `200`)
- `vscode-snapshots.semanticSearch.chunkOverlap`: Overlap between chunks in tokens (default: `50`)
- `vscode-snapshots.semanticSearch.autoIndex`: Auto-index snapshots in background (default: `false`)

**🔑 API Key Management & Security:**

- **Secure Storage**: API keys are stored using VS Code's SecretStorage (encrypted)
- **Access Control**: Keys are never logged or displayed in plain text
- **Configuration**: Manage keys via Settings view in Snapshot Explorer
- **Required Services**:
  - **Pinecone API Key**: For vector database storage and retrieval
  - **Gemini API Key**: For semantic code analysis and embeddings

**🛡️ Security Best Practices:**

- Use dedicated API keys with minimal permissions
- Monitor API usage and costs regularly
- Disable feature when working with sensitive code
- Review API provider terms of service
- Consider network security implications

**🚫 How to Disable:**

1. Set `vscode-snapshots.semanticSearch.enabled` to `false`, OR
2. Use Settings view in Snapshot Explorer → Semantic Search → Disable

</details>

---

## 💡 Next Steps

Ready to dive deeper? Here's where to go next:

- **🎓 Learn More**: Check out the [User Guide](docs/USER_GUIDE.md) for detailed tutorials
- **🤝 Git Workflow**: See how CodeLapse works with Git in the [Git Companion Guide](docs/GIT_COMPANION.md)
- **🔧 Contribute**: Want to help improve CodeLapse? See the [Developer Guide](docs/DEVELOPER_GUIDE.md)
- **🗺️ Future Plans**: Curious about what's coming? Check the [Roadmap](docs/ROADMAP.md)

---

## 📋 System Requirements

- **VS Code**: Version 1.60.0 or higher
- **Platform**: Windows, macOS, or Linux
- **Optional**: API keys for semantic search features

---

**🎉 Happy coding with CodeLapse! Remember: Code fearlessly, snapshot frequently.**
