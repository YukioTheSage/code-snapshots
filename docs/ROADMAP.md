# CodeLapse Roadmap - Simple Snapshot Management

This document outlines the future plans for the CodeLapse extension, emphasizing **dead simple snapshot creation and management** that complements Git.

## Core Principles: Keeping it Simple

- **Simplicity First**: Easy to use, minimal setup.
- **Low Mental Overhead**: No complex workflows to learn.
- **Git-Friendly**: Enhances Git, doesn't replace it.
- **Immediate Value**: Features provide instant benefit to your coding.
- **Fast Performance**: Quick operations that don't slow you down.

## Current Status (v0.9.4 Features) - Feature Checklist

CodeLapse has evolved into a comprehensive snapshot management system with the following capabilities:

#### Snapshot Basics:

- [x] One-key snapshot creation (`Ctrl+Alt+S`)
- [x] Snapshot navigation (forward/backward: `Ctrl+Alt+N`/`Ctrl+Alt+B`)
- [x] Time-based grouping in "My Snapshots" & "Auto Snapshots" Explorer views
- [x] Status bar indicator (time since last snapshot, current index)

#### Working with Snapshots:

- [x] File comparison (Diff View) between snapshots and current workspace
- [x] Single file restoration
- [x] Selective snapshots (choose specific files)

#### Automation & Efficiency:

- [x] Basic time-based auto-snapshots (`autoSnapshotInterval`)
- [x] Rule-based auto-snapshots for specific file patterns (`autoSnapshot.rules`)
- [x] UI for managing auto-snapshot rules
- [x] Editor Gutter Indicators for changed lines since last snapshot
- [x] Efficient differential storage for text files
- [x] Content Caching for faster diffs and restores
- [x] Asynchronous file I/O for improved performance
- [x] Smart code chunking for semantic search indexing ⚠️ **(Experimental)**

#### Context & Organization:

- [x] Enhanced snapshot context: Tags, Notes, Task References, Favorites
- [x] Editing snapshot context via Tree View context menu
- [x] Filtering by Date, Tags, Favorites, File Path (View Title icons)
- [x] Filter Status Bar indicator
- [x] `.gitignore` / `.snapshotignore` support for file exclusion
- [x] Semantic search across snapshots with natural language queries ⚠️ **(Experimental)**

#### Git Integration:

- [x] Storing branch/commit info (`git.addCommitInfo`)
- [x] Create Git Commit from Snapshot command (`git.commitFromSnapshotEnabled`)
- [x] Auto-snapshot before pull/merge/rebase (`git.autoSnapshotBeforeOperation`)

#### Getting Started:

- [x] Welcome Experience / Tour / Getting Started command

#### Security & Privacy:

- [x] Secure API key storage using VS Code's SecretStorage API
- [x] Credentials manager for handling API keys and sensitive data
- [x] User prompts for required API credentials

#### CLI & Automation:

- [x] Comprehensive CLI tool (`codelapse-cli`) for terminal access
- [x] JSON output mode for automation and AI agents
- [x] Batch operations support
- [x] Real-time event streaming (`codelapse watch`)
- [x] Direct API access for maximum flexibility
- [x] Safety protocols and error handling for AI agents
- [x] CI/CD integration examples and templates

#### Developer Experience:

- [x] Comprehensive documentation suite (User Guide, Developer Guide, Git Companion)
- [x] AI agent integration guide with safety protocols
- [x] Troubleshooting guide with common scenarios
- [x] Style guide for consistent documentation
- [x] API reference documentation
- [x] Multiple integration examples (GitHub Actions, Jenkins, etc.)

## Roadmap Ahead

We're planning improvements across four phases:

### Immediate: v1.0.0 - Production Ready & Polished (IN PROGRESS)

- **Target Release:** Next stable release
- **Focus:** Stability, bug fixes, performance, documentation, and minor UX tweaks.

#### Documentation Improvements:

- [x] Finalize User Guide (`USER_GUIDE`)
- [x] Finalize Developer Guide (`DEVELOPER_GUIDE`)
- [x] Finalize Git Companion Guide (`GIT_COMPANION`)
- [x] Add more examples and screenshots to guides
- [x] Refine README
- [x] Add Semantic Roadmap (`SEMANTIC_ROADMAP`)

#### Stability & Testing:

- [ ] Address known bugs from issue tracker
- [ ] Fix semantic search webview "Compare with Current" functionality
- [ ] Resolve TODO items in codebase (file filtering logic extraction, editor refresh optimization)
- [ ] Fix BUGFIX items in snapshot deletion detection logic
- [ ] Increase test coverage (storage, manager logic)
- [ ] Thoroughly test with large workspaces and diverse file types
- [ ] Add comprehensive CLI testing suite

#### Performance Tuning:

- [ ] Profile snapshot creation and restoration
- [ ] Optimize file filtering and diff application
- [ ] Improve semantic search indexing performance
- [ ] Optimize memory usage during large workspace operations

#### UX Refinements:

- [x] Improve clarity of notifications and prompts
- [x] Enhance tooltips for better context: added total change summaries on groups, truncated notes and diff line counts in snapshot/file tooltips
- [x] Minor adjustments to Tree View appearance: introduced filter-count badges, updated icons for manual/auto contexts, and refined indent/padding

#### Filter Persistence:

- [ ] Save active filter settings per workspace
- [ ] Restore filters when reopening a workspace

### Medium-Term: v1.x - Enhanced Functionality

- **Target Release:** 3-6 months post-v1.0
- **Focus:** Enhancing snapshot capabilities without adding unnecessary complexity.

#### Enhanced Comparison Features:

- [ ] Compare _any two_ snapshots directly
- [ ] Compare a snapshot with a specific Git commit (if Git available)

#### Snapshot Search Features:

- [x] Search snapshots by description, notes, tags, task reference
- [x] Search snapshots by file content changes
- [x] Semantic code search using natural language queries (Phase 1-3 complete) ⚠️ **(Experimental)**
- [ ] Semantic search optimization and advanced features (Phase 4) ⚠️ **(Experimental)**

#### Improved Auto-Snapshot Triggers:

- [ ] Trigger auto-snapshot on Git branch switch
- [ ] Trigger based on change thresholds (e.g., X lines changed)

#### Basic Export/Import Features:

- [ ] Export a single snapshot (metadata + files) to an archive/file
- [ ] Import an exported snapshot

#### Configuration Enhancements:

- [ ] More granular control over ignored files/directories beyond gitignore
- [ ] Workspace-level configuration overrides

### Near-Term: v1.1 - CLI & Integration Maturity

- **Target Release:** 1-2 months post-v1.0
- **Focus:** Mature the CLI ecosystem and improve integrations.

#### CLI Enhancements:

- [ ] Add comprehensive test suite for CLI
- [ ] Improve error handling and recovery mechanisms
- [ ] Add more batch operation templates
- [ ] Enhance real-time monitoring capabilities
- [ ] Add CLI configuration management
- [ ] Improve performance for large workspaces

#### Integration Improvements:

- [ ] Add more CI/CD platform examples (Azure DevOps, GitLab CI, etc.)
- [ ] Create VS Code extension pack for common workflows
- [ ] Improve Git hooks integration
- [ ] Add webhook support for external integrations
- [ ] Create Docker container for CLI usage

#### AI Agent Ecosystem:

- [ ] Expand AI agent safety protocols
- [ ] Add more automation templates
- [ ] Create agent certification/validation tools
- [ ] Improve batch operation error recovery
- [ ] Add agent usage analytics and monitoring

### Long-Term: v2.0+ - Advanced Features (Optional & Simple)

- **Target Release:** 6+ months post-v1.0
- **Focus:** Exploring advanced features while maintaining simplicity and optionality.

#### Visual Timeline View:

- [ ] Implement an alternative graphical representation of snapshot history
- [ ] Make visualization of changes over time easier

#### Cloud Backup/Sync (Optional & Simple):

- [ ] Option to back up `.snapshots` to user-configured cloud storage (Gist, S3, Dropbox)
- [ ] Implement basic synchronization for personal use across machines (not team collaboration)

#### Intelligent Snapshot Suggestions:

- [ ] Analyze activity to suggest potentially meaningful moments to snapshot

#### Refined Storage Options:

- [ ] Options for snapshot compression
- [ ] More advanced retention policies (e.g., daily, weekly)

## What We Won't Build: Staying Focused on Simplicity

To keep CodeLapse simple and Git-friendly, we will **not** build features like:

1.  **Complex Branching/Merging**: No Git-style branching or merge conflict resolution.
2.  **Full Team Collaboration**: No push/pull, locking, or real-time sync. Sharing is limited to export/import.
3.  **History Rewriting**: No rebasing, squashing, or amending snapshots. Snapshots are immutable.
4.  **Complex Git Operations**: No replication of advanced Git commands. Focus is on leveraging Git info and convenient transitions (like commit creation).
5.  **External Database Backend**: Storage will remain file-system based for simplicity and portability.

## Current Challenges & Technical Debt

Based on code analysis, these areas need attention:

#### Code Quality & Maintenance:

- [ ] Extract repeated file filtering logic into reusable methods
- [ ] Optimize editor refresh mechanisms (currently marked as TODO)
- [ ] Resolve debug logging scattered throughout codebase
- [ ] Clean up experimental feature flags and warnings
- [ ] Standardize error handling patterns across services

#### Semantic Search Stability ⚠️ **(Experimental)**:

- [ ] Fix webview comparison functionality
- [ ] Improve API key validation and error messages
- [ ] Add comprehensive fallback mechanisms for service outages
- [ ] Optimize vector database query performance
- [ ] Add proper cleanup for failed indexing operations

#### CLI Robustness:

- [ ] Add comprehensive error recovery for batch operations
- [ ] Improve connection stability and retry mechanisms
- [ ] Add validation for all JSON responses
- [ ] Enhance timeout handling for large operations
- [ ] Add proper cleanup for interrupted processes

## Emerging Priorities

New priorities identified through usage and feedback:

#### Enterprise & Security:

- [ ] Add audit logging for compliance requirements
- [ ] Implement workspace-level security policies
- [ ] Add support for corporate proxy configurations
- [ ] Create enterprise deployment guides
- [ ] Add GDPR compliance documentation

#### Developer Productivity:

- [ ] Add snapshot templates for common scenarios
- [ ] Implement smart snapshot naming suggestions
- [ ] Add bulk operations for snapshot management
- [ ] Create snapshot analytics and insights
- [ ] Add integration with popular task management tools

#### Performance & Scalability:

- [ ] Add progressive loading for large snapshot lists
- [ ] Implement background cleanup of old snapshots
- [ ] Add compression options for storage optimization
- [ ] Optimize diff calculation for large files
- [ ] Add memory usage monitoring and alerts

## Open Source & Community Driven

We are committed to an open and collaborative approach:

#### Community Focus:

- [ ] Clear contribution guidelines
- [ ] Issue templates
- [ ] PR templates
- [ ] Public roadmap
- [ ] Issue tracking
- [ ] Discussion forums (GitHub Discussions)
- [ ] Actively incorporate community feedback

#### Quality Focus:

- [ ] Rigorous testing for stability and reliability
- [ ] Comprehensive and up-to-date documentation
- [ ] Transparent development process

## Give Us Your Feedback!

Your input is valuable! Let us know what you think:

- **Bug Reports & Feature Requests:** GitHub Issues
- **General Feedback, Ideas, Questions:** GitHub Discussions (if enabled)
- **Help Others Discover CodeLapse:** VS Code Marketplace Reviews & Ratings

We're dedicated to making CodeLapse the perfect, simple companion to Git. Your suggestions that align with this vision are highly welcome!

---

**Key improvements with Categorized Checklists:**

- **Clear Categories:** Each roadmap phase is broken down into logical categories (e.g., "Documentation Improvements," "Stability & Testing"). This makes it much easier to see the focus areas within each phase.
- **Checklist Format:** The use of markdown task lists (`[ ]` and `[x]`) maintains the checklist feel and makes it easy to track progress.
- **Improved Scanability:** The categorized structure and checklists make the document much more scannable and digestible. You can quickly jump to a category of interest within a phase.
- **"Current Status" Adaptation:** The "Current Status" section is now also structured as a checklist of features within categories, providing a clear overview of existing functionality.

This structure should be significantly easier to read and understand. Let me know what you think of this version! If you have any more tweaks or adjustments in mind, just let me know.
