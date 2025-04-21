# Code Snapshots Roadmap - Simple Snapshot Management

This document outlines the future plans for the Code Snapshots extension, emphasizing **dead simple snapshot creation and management** that complements Git.

## Core Principles: Keeping it Simple

- **Simplicity First**: Easy to use, minimal setup.
- **Low Mental Overhead**: No complex workflows to learn.
- **Git-Friendly**: Enhances Git, doesn't replace it.
- **Immediate Value**: Features provide instant benefit to your coding.
- **Fast Performance**: Quick operations that don't slow you down.

## Current Status (v0.9.0 Features) - Feature Checklist

Code Snapshots already offers a robust set of features, categorized as follows:

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

#### Context & Organization:

- [x] Enhanced snapshot context: Tags, Notes, Task References, Favorites
- [x] Editing snapshot context via Tree View context menu
- [x] Filtering by Date, Tags, Favorites, File Path (View Title icons)
- [x] Filter Status Bar indicator
- [x] `.gitignore` / `.snapshotignore` support for file exclusion

#### Git Integration:

- [x] Storing branch/commit info (`git.addCommitInfo`)
- [x] Create Git Commit from Snapshot command (`git.commitFromSnapshotEnabled`)
- [x] Auto-snapshot before pull/merge/rebase (`git.autoSnapshotBeforeOperation`)

#### Getting Started:

- [x] Welcome Experience / Tour / Getting Started command

## Roadmap Ahead

We're planning improvements across three phases:

### Short-Term: v1.0.0 - Production Ready & Polished

- **Target Release:** Next stable release
- **Focus:** Stability, bug fixes, performance, documentation, and minor UX tweaks.

#### Documentation Improvements:

- [ ] Finalize User Guide (`USER_GUIDE`)
- [ ] Finalize Developer Guide (`DEVELOPER_GUIDE`)
- [ ] Finalize Git Companion Guide (`GIT_COMPANION`)
- [ ] Add more examples and screenshots to guides
- [ ] Refine README

#### Stability & Testing:

- [ ] Address known bugs from issue tracker
- [ ] Increase test coverage (storage, manager logic)
- [ ] Thoroughly test with large workspaces and diverse file types

#### Performance Tuning:

- [ ] Profile snapshot creation and restoration
- [ ] Optimize file filtering and diff application

#### UX Refinements:

- [ ] Improve clarity of notifications and prompts
- [ ] Enhance tooltips for better context
- [ ] Minor adjustments to Tree View appearance

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

- [ ] Search snapshots by description, notes, tags, task reference
- [ ] Search snapshots by file content changes

#### Improved Auto-Snapshot Triggers:

- [ ] Trigger auto-snapshot on Git branch switch
- [ ] Trigger based on change thresholds (e.g., X lines changed)

#### Basic Export/Import Features:

- [ ] Export a single snapshot (metadata + files) to an archive/file
- [ ] Import an exported snapshot

#### Configuration Enhancements:

- [ ] More granular control over ignored files/directories beyond gitignore
- [ ] Workspace-level configuration overrides

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

To keep Code Snapshots simple and Git-friendly, we will **not** build features like:

1.  **Complex Branching/Merging**: No Git-style branching or merge conflict resolution.
2.  **Full Team Collaboration**: No push/pull, locking, or real-time sync. Sharing is limited to export/import.
3.  **History Rewriting**: No rebasing, squashing, or amending snapshots. Snapshots are immutable.
4.  **Complex Git Operations**: No replication of advanced Git commands. Focus is on leveraging Git info and convenient transitions (like commit creation).
5.  **External Database Backend**: Storage will remain file-system based for simplicity and portability.

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
- **Help Others Discover Code Snapshots:** VS Code Marketplace Reviews & Ratings

We're dedicated to making Code Snapshots the perfect, simple companion to Git. Your suggestions that align with this vision are highly welcome!

---

**Key improvements with Categorized Checklists:**

- **Clear Categories:** Each roadmap phase is broken down into logical categories (e.g., "Documentation Improvements," "Stability & Testing"). This makes it much easier to see the focus areas within each phase.
- **Checklist Format:** The use of markdown task lists (`[ ]` and `[x]`) maintains the checklist feel and makes it easy to track progress.
- **Improved Scanability:** The categorized structure and checklists make the document much more scannable and digestible. You can quickly jump to a category of interest within a phase.
- **"Current Status" Adaptation:** The "Current Status" section is now also structured as a checklist of features within categories, providing a clear overview of existing functionality.

This structure should be significantly easier to read and understand. Let me know what you think of this version! If you have any more tweaks or adjustments in mind, just let me know.
