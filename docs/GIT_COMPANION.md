# Code Snapshots and Git: Perfect Companions

This guide explains how to effectively use Code Snapshots alongside Git for an optimal development workflow.

## Two Tools, Different Purposes

Code Snapshots and Git serve different but complementary purposes in your development workflow:

**Git** is designed for:

- Formal version control with logical commits
- Team collaboration
- Code sharing and distribution
- Long-term project history
- Branching and merging features
- Remote backups and synchronization

**Code Snapshots** is designed for:

- Personal development workflow
- Rapid experimentation & quick reverts
- Work-in-progress protection ("micro-commits")
- Moment-in-time captures without polluting Git history
- Quick navigation between recent development states
- Minimal-overhead versioning for individual workstreams
- Capturing state _before_ complex Git operations

## When to Use Each Tool

### Use Code Snapshots When:

- **Experimenting with code** - Take quick snapshots as you try different approaches (`Ctrl+Alt+S`).
- **Between Git commits** - Create frequent checkpoints as you work toward your next commit.
- **Learning or exploring unfamiliar code** - Snapshot before making changes to understand behavior.
- **Before risky operations** - **Strongly Recommended**: Snapshot _before_ Git operations like `merge`, `rebase`, or `pull` (see automatic option below).
- **During debugging sessions** - Capture states as you track down bugs.
- **When you need a quick safety net** - One keystroke for peace of mind.
- **For personal "save points"** - Create personal checkpoints that don't belong in the formal Git history.
- **Refactoring** - Take snapshots before and after significant refactoring steps.

### Use Git When:

- **Completing a logical feature or fix** - Commit when you've finished a meaningful, testable change.
- **Sharing code with teammates** - Push your commits to share with others.
- **Creating release versions** - Tag important milestones.
- **Working on multiple features** - Use branches for parallel development.
- **Contributing to open source** - Create pull requests from your commits.
- **Documenting project history** - Leave well-crafted commit messages explaining the "why".
- **Backing up your project reliably** - Push to remote repositories.

## Ideal Combined Workflow

1. **Start with Git** - Clone your repository and check out the appropriate branch.
2. **Snapshot before changes** - Take an initial snapshot (`Ctrl+Alt+S`) of the clean state. Add a description like "Clean state from git pull".
3. **Work and snapshot frequently** - Take snapshots as you make progress (every 15-30 minutes, or before/after significant changes, or before trying something risky). Use quick descriptions.
4. **Commit to Git when ready** - Once you have a complete, working change that passes tests, stage the relevant files and commit them to Git with a clear message.
5. **Snapshot before Git Network Ops** - **Crucially**, take a snapshot _before_ running `git pull`, `git fetch` followed by `merge`/`rebase`. Consider enabling the auto-snapshot setting for this (see below).
6. **Sync with Git** - Pull changes from teammates, resolve any conflicts.
7. **Repeat** - Continue this cycle throughout development.

## Real-World Scenarios

### Scenario 1: Experimental Feature Development

1. Check out a new Git branch: `git checkout -b feature/new-widget`.
2. Take a Code Snapshot: `Ctrl+Alt+S`, Description: "Start feature/new-widget".
3. Implement approach A, taking snapshots: `Ctrl+Alt+S` "Approach A - step 1", `Ctrl+Alt+S` "Approach A - working but complex".
4. Decide against Approach A. Restore to the "Start feature/new-widget" snapshot (via Tree View or Quick Pick).
5. Implement Approach B, taking snapshots: `Ctrl+Alt+S` "Approach B - simpler logic", `Ctrl+Alt+S` "Approach B - needs tests".
6. Finish Approach B, add tests. Take final snapshot: `Ctrl+Alt+S` "Approach B - complete with tests".
7. Stage files: `git add .`
8. Create a proper Git commit: `git commit -m "feat: implement new widget using Approach B"`.
9. Push your branch: `git push origin feature/new-widget`. Create PR.

### Scenario 2: Bug Fixing

1. Check out the relevant Git commit/branch.
2. Take a Code Snapshot: `Ctrl+Alt+S`, Description: "Buggy state for issue #123".
3. Add debug logging, run code, take snapshot: `Ctrl+Alt+S` "Added logging for bug #123".
4. Try a potential fix, run code, take snapshot: `Ctrl+Alt+S` "Attempted fix 1 for #123 (failed)".
5. Restore to the "Added logging..." snapshot.
6. Try another fix, run code, take snapshot: `Ctrl+Alt+S` "Attempted fix 2 for #123 (works!)".
7. Restore to the "Buggy state..." snapshot.
8. Implement _only_ the correct fix (without the debug logging).
9. Stage the fixed file(s): `git add <fixed_file>`.
10. Commit the focused fix to Git: `git commit -m "fix: resolve null pointer exception in calculation\n\nCloses #123"`.
11. Push your fix.

### Scenario 3: Code Review Changes

1. Ensure your Git branch is up-to-date.
2. Take a Code Snapshot: `Ctrl+Alt+S`, Description: "Before addressing PR #45 feedback".
3. Implement the first requested change. Take snapshot: `Ctrl+Alt+S` "Applied feedback item 1 (rename variable)".
4. Implement the second requested change. Take snapshot: `Ctrl+Alt+S` "Applied feedback item 2 (add validation)".
5. If you make a mistake, restore to the previous snapshot (`Ctrl+Alt+B`) and redo the change.
6. Once all changes are complete, stage them: `git add .`
7. Commit the changes to Git: `git commit --amend` (if amending the original PR commit) or `git commit -m "chore: address code review feedback for PR #45"`.
8. Push the review changes: `git push --force-with-lease` (if amended).

### Scenario 4: Promoting a Snapshot to a Commit

Sometimes, a snapshot represents a stable state you want to formally add to your Git history:

1. Identify the snapshot in the Snapshot Explorer that represents the desired state (e.g., "Approach B - complete with tests").
2. Right-click the snapshot item and select **Create Git Commit from Snapshot**. _(Ensure this command is enabled in settings: `vscode-snapshots.git.commitFromSnapshotEnabled`)_.
3. **Enter Commit Message**: An input box appears, pre-filled with a message derived from the snapshot (e.g., `Snapshot: Approach B - complete with tests`). Modify this to be a proper Git commit message (e.g., `feat: implement new widget using Approach B`). Press Enter.
4. **Restore Process**: The extension will now trigger the restore process for the selected snapshot:

- You'll see the **Snapshot Preview** quick pick listing changes. Select **Restore Snapshot**.
- If there are unsaved changes, you'll see the **Conflict Resolution** dialog. Choose how to proceed (e.g., "Restore (Overwrite Unsaved)" or "Take Snapshot & Restore").
- The extension restores your workspace files to match the snapshot.

5. **Staging & Committing**: If the restore was successful (not cancelled), the extension will automatically:

- Stage all changes in your workspace (`git add .`).
- Create a Git commit using the message you provided earlier (`git commit -m "..."`).

6. **Result**: You now have a Git commit representing the exact state of that snapshot. You can proceed to push it.
7. This allows you to easily transition a good working state captured in a snapshot into a formal Git commit without manual checkout, staging, and committing.

## Tips for Integration

1. **Use meaningful descriptions** for snapshots that reference Git context (e.g., "Before merging PR #42", "Clean state after pull").
2. **Take snapshots _before_ Git operations** that modify your working directory (pull, merge, rebase, stash apply, checkout with changes).

- **Automate This!** Enable the setting `vscode-snapshots.git.autoSnapshotBeforeOperation` (default is `false`). When enabled, the extension will automatically take a snapshot (with a description like "Auto-snapshot before git.pull") _before_ you run `git pull`, `git merge`, or `git rebase` using the VS Code Git UI or commands. This provides a crucial safety net. If the snapshot fails, a warning is shown, but the Git operation proceeds.

3. **Use Rule-Based Auto-Snapshots**: Configure rules (via `vscode-snapshots.autoSnapshot.rules` setting or the "Manage Auto-Snapshot Rules" command) to automatically snapshot important files (e.g., configuration files, core modules) at specific intervals when they change.
4. **Clean up old snapshots** periodically after related changes are safely committed to Git to save space (Right-click -> Delete in Tree View).
5. **Use Git for team communication** (commits, PRs) and Code Snapshots for your personal development safety net and exploration.
6. **Leverage Snapshot Context**: Use tags (e.g., `#refactor`, `#bugfix`), task references, and notes in your snapshots alongside your Git commit messages for different levels of detail.

## Conclusion

Git and Code Snapshots are not competitors but companions that serve different purposes in your development workflow. Git provides the formal version control and collaboration capabilities, while Code Snapshots offers a frictionless, personal safety net for your day-to-day coding, experimentation, and navigation through recent states.

By using both tools appropriately, you get the best of both worlds: the robust version control and collaboration capabilities of Git, combined with the lightweight, instant save points and rapid navigation of Code Snapshots.
