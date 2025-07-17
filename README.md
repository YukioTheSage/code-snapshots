# CodeLapse - Your Development Time Machine ⏰

**Stop losing code. Start exploring fearlessly.**

CodeLapse is the missing link between your IDE's autosave and Git's formal commits. Create instant, zero-friction snapshots of your work and navigate through your development journey like never before.

🚀 **One keystroke. Instant backup. Zero mental overhead.**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/your-publisher.codelapse)](https://marketplace.visualstudio.com/items?itemName=your-publisher.codelapse)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/your-publisher.codelapse)](https://marketplace.visualstudio.com/items?itemName=your-publisher.codelapse)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/your-publisher.codelapse)](https://marketplace.visualstudio.com/items?itemName=your-publisher.codelapse)

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
- **🔍 Smart Search**: Find any code across your entire history *(Experimental)*

> ⚠️ **EXPERIMENTAL FEATURE WARNING**: Semantic search is currently experimental with potential risks:
> - **API Key Security**: Requires third-party API keys that may expose code to external services
> - **Data Privacy**: Code content is processed by external AI services (Pinecone, Gemini)
> - **Functionality Changes**: Features may change or be removed without notice
> - **Performance Impact**: May affect extension performance and consume API quotas
> - **Use at your own risk** and avoid on sensitive/proprietary codebases

---

## 📊 CodeLapse vs Git - Better Together

| **Scenario** | **CodeLapse** | **Git** | **Best Choice** |
|--------------|---------------|---------|-----------------|
| 🧪 **Quick Experiments** | ✅ One keystroke, try anything | ❌ Too formal, requires planning | **CodeLapse** |
| 💾 **Save Work-in-Progress** | ✅ Instant, no commit message | ❌ Messy WIP commits | **CodeLapse** |
| 🔄 **Multiple Save Points** | ✅ Perfect for rapid iteration | ❌ Clutters history | **CodeLapse** |
| 👥 **Team Collaboration** | ❌ Local only | ✅ Built for sharing | **Git** |
| 📚 **Project History** | ❌ Personal snapshots | ✅ Formal version control | **Git** |
| 🎯 **Feature Development** | ❌ Not structured | ✅ Logical commits | **Git** |
| 🛡️ **Safety Net** | ✅ Zero overhead protection | ✅ Formal protection | **Both!** |

**The Magic**: Use both tools together. Git for your formal commits, CodeLapse for your personal development flow.

---

## 🚀 Quick Start

### Installation

1. **From VS Code Marketplace**:
   - Open VS Code
   - Go to Extensions (`Ctrl+Shift+X`)
   - Search for "CodeLapse"
   - Click "Install"

2. **From Command Line**:
   ```bash
   code --install-extension your-publisher.codelapse
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
- **🔍 Smart Search**: Find code across all snapshots *(Experimental)*

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

## 📚 Documentation & Support

| **Getting Started** | **Advanced Usage** | **Development** |
|---------------------|-------------------|-----------------|
| 📖 [User Guide](docs/USER_GUIDE.md) | 🤝 [Git Integration](docs/GIT_COMPANION.md) | 🔧 [Developer Guide](docs/DEVELOPER_GUIDE.md) |
| 🚀 [Quick Start](#-quick-start) | ⚙️ [Configuration](#-configuration) | 🗺️ [Roadmap](docs/ROADMAP.md) |
| ❓ [Troubleshooting](docs/TROUBLESHOOTING.md) | 🔬 [Semantic Search](docs/SEMANTIC_ROADMAP.md) | 🤝 [Contributing](docs/DEVELOPER_GUIDE.md#contributing) |

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
