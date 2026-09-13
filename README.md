# CodeLapse - Your Development Time Machine ⏰

**Stop losing code. Start exploring fearlessly.**

CodeLapse is the missing link between your IDE's autosave and Git's formal commits. Create instant, zero-friction snapshots of your work and navigate through your development journey like never before.

🚀 **One keystroke. Instant backup. Zero mental overhead.**

## 🛠️ Two Powerful Tools, One Seamless Experience

**🎯 VS Code Extension**: Visual, interactive snapshot management right in your editor
**⚡ CLI Tool**: Automation-ready command-line interface that works **standalone** or connected to VS Code

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/YukioTheSage.vscode-snapshots)](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/YukioTheSage.vscode-snapshots)](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/YukioTheSage.vscode-snapshots)](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)

<details>
<summary><strong>📑 Table of Contents</strong></summary>

- [🎯 Why CodeLapse?](#-why-codelapse)
- [🚀 Quick Start](#-quick-start)
- [✨ Features at a Glance](#-features-at-a-glance)
- [🖥️ CLI Tool - Automation & Integration Ready](#️-cli-tool---automation--integration-ready)
- [📚 Documentation & Support](#-documentation--support)
- [⚙️ Configuration](#️-configuration)
- [📋 System Requirements](#-system-requirements)

</details>

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

> 💡 **Note**: The CLI can now run independently in **Standalone Mode**! The VS Code extension is optional but recommended for AI features and visual management.

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
- **🤝 Perfect Harmony**: Works alongside Git without conflicts

> **Not implemented:** taking a snapshot *automatically* before `git pull`,
> `git merge` or `git rebase` run from the VS Code Git UI. No such setting exists
> (the previous `git.autoSnapshotBeforeOperation` did nothing and was removed),
> and VS Code exposes no pre-operation hook. Take the snapshot explicitly with
> Ctrl+Alt+S or `codelapse git auto-commit <operation>` before a destructive Git
> operation. See the [open issues](https://github.com/YukioTheSage/code-snapshots/issues).

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

- **🎯 Standalone Mode**: Run independently without the VS Code extension
- **🔄 Complete Snapshot Management**: Create, list, restore, delete, and compare snapshots
- **🤝 Git Integration**: Native commands to manage commits, branches, and compare with Git history
- **⚙️ Configuration Management**: Unified settings shared with the extension
- **🔍 Semantic Search**: Natural language code search across all snapshots _(Experimental, Requires Extension)_
- **📊 Code Analysis & Chunking**: Evaluate code quality and extract context for AI agents
- **🤖 AI-Friendly**: JSON output, silent mode, structured error handling, and batch operations
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
codelapse search index                              # Build search index

# Git Integration & Workspace
codelapse git commit snapshot-123 -m "My commit"    # Create Git commit
codelapse git compare snapshot-123                  # Compare vs Git
codelapse workspace files --changed                 # Show changed files
codelapse filter favorite                           # Show favorite snapshots

# Configuration & Utilities
codelapse config set maxSnapshots 100               # Set configuration
codelapse chunk file src/main.ts                    # Create code chunks
codelapse utility export snap-123 --format zip      # Export snapshot
codelapse batch commands.json --json --silent       # Batch operations
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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
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
FROM node:20-alpine

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
| 🚀 [Quick Start](#-quick-start)               | ⚙️ [Configuration](#️-configuration)           | 🗺️ [Roadmap](docs/ROADMAP.md)                           |
| ⚡ [CLI Guide](cli/README.md)                  | 🔬 [Semantic Search](docs/SEMANTIC_ROADMAP.md) | 🤝 [Contributing](docs/DEVELOPER_GUIDE.md#contributing-to-codelapse) |
| 🏗️ [Standalone Mode](STANDALONE_MODE.md)     | 🤖 [AI Guidelines](cli/AI_GUIDE.md)            | 📦 [NPM Package](https://www.npmjs.com/package/codelapse-cli) |
| ❓ [Troubleshooting](docs/TROUBLESHOOTING.md) | 📦 [Core Package](shared/README.md)           | 💬 [Issues](https://github.com/YukioTheSage/code-snapshots/issues) |
| 🛡️ [Security](SECURITY.md)       |                                                |                                                         |

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

> There is no setting for taking a snapshot *before* a Git operation. The previous
> `git.autoSnapshotBeforeOperation` was removed because nothing ever invoked the
> interception it configured. See the [open issues](https://github.com/YukioTheSage/code-snapshots/issues).

</details>

<details>
<summary><strong>📚 All Settings Reference</strong></summary>

| Setting | Type | Default | Purpose |
| ------- | ---- | ------- | ------- |
| `vscode-snapshots.snapshotLocation` | string | `.snapshots` | Where snapshots are stored, relative to the workspace root |
| `vscode-snapshots.maxSnapshots` | number | `50` | Maximum number of snapshots to keep |
| `vscode-snapshots.maxSnapshotStoreBytes` | number | `0` | Maximum bytes the snapshot store may occupy; `0` disables the limit and the oldest snapshots are pruned first |
| `vscode-snapshots.autoSnapshotInterval` | number | `0` | Interval for automatic snapshots in minutes (`0` disables) |
| `vscode-snapshots.loggingEnabled` | boolean | `true` | Enable detailed logging |
| `vscode-snapshots.verboseLogging` | boolean | `false` | Enable more detailed verbose logging |
| `vscode-snapshots.git.addCommitInfo` | boolean | `true` | Store Git branch and commit hash with each snapshot |
| `vscode-snapshots.git.commitFromSnapshotEnabled` | boolean | `true` | Enable "Create Git Commit from Snapshot" |
| `vscode-snapshots.autoSnapshot.rules` | array | `[]` | Rules for file-specific auto-snapshots |
| `vscode-snapshots.showOnlyChangedFiles` | boolean | `true` | Show only changed files in the snapshot view |
| `vscode-snapshots.ux.showWelcomeOnStartup` | boolean | `true` | Show the welcome message for first-time users |
| `vscode-snapshots.ux.showKeyboardShortcutHints` | boolean | `true` | Show keyboard shortcut hints |
| `vscode-snapshots.ux.useAnimations` | boolean | `true` | Show the gutter direction indicator while navigating snapshots |
| `vscode-snapshots.ux.confirmRestoreOperations` | boolean | `true` | Ask before restoring a snapshot (does not control the unsaved-change prompt) |
| `vscode-snapshots.semanticSearch.enabled` | boolean | `true` | Enable semantic search (requires Gemini and Pinecone keys) |
| `vscode-snapshots.semanticSearch.chunkSize` | number | `200` | Maximum lines per code chunk |
| `vscode-snapshots.semanticSearch.chunkOverlap` | number | `50` | Overlap between adjacent chunks, clamped to `chunkSize - 5` |
| `vscode-snapshots.semanticSearch.autoIndex` | boolean | `false` | Index snapshots in the background automatically |
| `vscode-snapshots.semanticSearch.embedding.model` | string | `gemini-embedding-2` | Embedding model id; Google retires model ids on a published schedule |
| `vscode-snapshots.semanticSearch.embedding.dimension` | number | `3072` | Vector dimension; must match the dimension the index was created with |

</details>

<details>
<summary><strong>🔬 Semantic Search Settings (Experimental)</strong></summary>

> ⚠️ **EXPERIMENTAL FEATURE - SECURITY RISKS**: See the [experimental feature warning](#-why-codelapse) above - network exposure and API quota costs apply, and it is **not recommended** for proprietary, sensitive, or confidential codebases.

**Basic Settings:**

- `vscode-snapshots.semanticSearch.enabled`: Enable semantic code search (default: `true`)
- `vscode-snapshots.semanticSearch.chunkSize`: Maximum number of **lines** per code chunk (default: `200`)
- `vscode-snapshots.semanticSearch.chunkOverlap`: Overlap between adjacent chunks, in **lines** (default: `50`, clamped to `chunkSize - 5`)
- `vscode-snapshots.semanticSearch.autoIndex`: Auto-index snapshots in background (default: `false`)
- `vscode-snapshots.semanticSearch.embedding.model` / `.dimension`: Embedding model id and vector dimension (defaults: `gemini-embedding-2`, `3072`)

> **There is no offline mode.** Semantic search needs *both* a Gemini API key
> (embeddings) and a Pinecone API key (vector store). Indexing prompts for a
> missing key and fails if you decline the prompt; it never falls back to a
> local index.

**🔑 API Key Management & Security:**

- **Secure Storage**: API keys are stored using VS Code's SecretStorage (encrypted)
- **Access Control**: Keys are never logged or displayed in plain text
- **Configuration**: Manage keys via Settings view in Snapshot Explorer
- **Required Services**:
  - **Pinecone API Key**: For vector database storage and retrieval
  - **Gemini API Key**: For semantic code analysis and embeddings

> ⚠️ **Not everything is in SecretStorage.** The API keys are. The CLI connection
> file is not: on every activation the extension writes
> `.vscode/codelapse-connection.json` inside your workspace, containing the IPC
> auth token and socket path for the running session. It is listed in
> `.gitignore`, so do not remove that entry, and treat any committed copy as a
> leaked credential. The token is regenerated on every activation, so a stale
> copy is inert.

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

- **VS Code**: version 1.85.0 or higher (declared as `engines.vscode: ^1.85.0`)
- **Platform**: Windows, macOS, or Linux
- **CLI only**: Node.js 18.15.0 or higher
- **Optional**: Gemini and Pinecone API keys for semantic search

---

**🎉 Happy coding with CodeLapse! Remember: Code fearlessly, snapshot frequently.**
