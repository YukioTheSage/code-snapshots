import * as vscode from 'vscode';
import * as path from 'path';

import { SnapshotManager, Snapshot } from '../snapshotManager';
import { getShowOnlyChangedFiles } from '../config';
import { log, logVerbose } from '../logger';
import { pathMatchesPattern } from '../utils';

// --- Helper Functions for Grouping ---

/**
 * Determines the relative date group (Today, Yesterday, etc.) for a timestamp.
 * @param timestamp The timestamp to group.
 * @returns The name of the date group.
 */
function getRelativeDateGroup(timestamp: number): string {
  const now = new Date();
  const snapshotDate = new Date(timestamp);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(todayStart.getDate() - 1);
  const thisWeekStart = new Date(todayStart);
  thisWeekStart.setDate(todayStart.getDate() - now.getDay()); // Assuming Sunday is the start of the week (0)
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  if (snapshotDate >= todayStart) {
    return 'Today';
  } else if (snapshotDate >= yesterdayStart) {
    return 'Yesterday';
  } else if (snapshotDate >= thisWeekStart) {
    return 'This Week';
  } else if (snapshotDate >= lastWeekStart) {
    return 'Last Week';
  } else {
    return 'Older';
  }
}

// Define the order of groups for display
const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Last Week', 'Older'];

/**
 * Enum defining the types of snapshots a view can display.
 */
export enum SnapshotType {
  MANUAL = 'manual',
  AUTO = 'auto',
  ALL = 'all', // Should not typically be used for a specific view instance
}

// --- TreeDataProvider Implementation ---

/**
 * Provides data for the Snapshot Tree Views (Manual and Auto).
 * Manages filtering and grouping of snapshots.
 */
export class SnapshotTreeDataProvider
  implements vscode.TreeDataProvider<SnapshotTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    SnapshotTreeItem | undefined | null | void
  > = new vscode.EventEmitter<SnapshotTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    SnapshotTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  // --- Filter State (Specific to this instance) ---
  private filterStartDate: number | null = null;
  private filterEndDate: number | null = null;
  private filterTags: string[] = [];
  private filterFavoritesOnly = false;
  private filterFilePattern: string | null = null;
  private showOnlyChangedFiles = true; // Config setting

  private snapshotTypeFilter: SnapshotType; // Type of snapshots this provider shows (MANUAL or AUTO)
  private viewName: string; // For logging ("Manual" or "Auto")

  /**
   * Creates an instance of SnapshotTreeDataProvider.
   * @param snapshotManager The central manager for snapshot data.
   * @param snapshotType The type of snapshots this provider instance should display (MANUAL or AUTO).
   */
  constructor(
    private snapshotManager: SnapshotManager,
    snapshotType: SnapshotType, // Must be MANUAL or AUTO for view instances
  ) {
    if (snapshotType === SnapshotType.ALL) {
      // This provider instance should represent either Manual or Auto view, not All.
      // Defaulting to MANUAL, but this indicates a potential setup issue.
      log(
        'Warning: SnapshotTreeDataProvider initialized with SnapshotType.ALL. Defaulting to MANUAL.',
      );
      this.snapshotTypeFilter = SnapshotType.MANUAL;
    } else {
      this.snapshotTypeFilter = snapshotType;
    }

    // Assign view name based on type for logging
    this.viewName =
      this.snapshotTypeFilter === SnapshotType.MANUAL ? 'Manual' : 'Auto';
    log(`Initializing TreeDataProvider for ${this.viewName} view.`);

    // Listen for changes in the snapshot manager to refresh the tree
    snapshotManager.onDidChangeSnapshots(() => {
      logVerbose(
        `(${this.viewName} View) Snapshots changed event received, refreshing tree.`,
      );
      this.refresh();
    });

    // Listen for configuration changes relevant to this view
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vscode-snapshots.showOnlyChangedFiles')) {
        this.showOnlyChangedFiles = getShowOnlyChangedFiles();
        logVerbose(
          `(${this.viewName} View) showOnlyChangedFiles config changed to ${this.showOnlyChangedFiles}, refreshing tree.`,
        );
        this.refresh();
      }
      // Add listener for other config changes if needed in the future
    });

    // Initialize with current configuration value
    this.showOnlyChangedFiles = getShowOnlyChangedFiles();
  }

  /**
   * Triggers a refresh of the tree view.
   */
  refresh(): void {
    logVerbose(`(${this.viewName} View) Refresh triggered.`);
    this._onDidChangeTreeData.fire();
  }

  /**
   * Checks if a snapshot is considered an "auto" snapshot based on tags/description.
   * @param snapshot The snapshot to check.
   * @returns True if it's an auto snapshot, false otherwise.
   */
  private isAutoSnapshot(snapshot: Snapshot): boolean {
    // Check for specific tags used by auto-snapshot features
    const autoTags = [
      'auto',
      'timed',
      'scheduled',
      'rule-based',
      'time-triggered',
      'save-triggered',
    ];
    if (snapshot.tags?.some((tag) => autoTags.includes(tag))) {
      return true;
    }
    // Fallback check on description (less reliable)
    if (snapshot.description?.toLowerCase().includes('auto-snapshot')) {
      return true;
    }
    return false;
  }

  /**
   * Updates the filter state for this specific tree view instance.
   * @param options An object containing filter properties to update.
   */
  setFilter(options: {
    startDate?: number | null;
    endDate?: number | null;
    tags?: string[];
    favoritesOnly?: boolean;
    filePattern?: string | null;
  }): void {
    let changed = false;
    // Check each filter property for actual changes before updating and setting flag
    if (
      options.startDate !== undefined &&
      this.filterStartDate !== options.startDate
    ) {
      this.filterStartDate = options.startDate;
      changed = true;
    }
    if (
      options.endDate !== undefined &&
      this.filterEndDate !== options.endDate
    ) {
      this.filterEndDate = options.endDate;
      changed = true;
    }
    // Compare arrays properly for tags (simple stringify is sufficient here)
    if (
      options.tags !== undefined &&
      JSON.stringify(this.filterTags) !== JSON.stringify(options.tags)
    ) {
      this.filterTags = [...options.tags]; // Store a copy
      changed = true;
    }
    if (
      options.favoritesOnly !== undefined &&
      this.filterFavoritesOnly !== options.favoritesOnly
    ) {
      this.filterFavoritesOnly = options.favoritesOnly;
      changed = true;
    }
    if (
      options.filePattern !== undefined &&
      this.filterFilePattern !== options.filePattern
    ) {
      this.filterFilePattern = options.filePattern;
      changed = true;
    }

    if (changed) {
      log(
        `(${
          this.viewName
        } View) Filter state updated: ${this.getActiveFiltersDescription()}`,
      );
      this.refresh(); // Refresh the view only if filter actually changed
    } else {
      logVerbose(
        `(${this.viewName} View) setFilter called but no changes detected.`,
      );
    }
  }

  // --- Filter Getter Methods ---
  public getFilterStartDate(): number | null {
    return this.filterStartDate;
  }
  public getFilterEndDate(): number | null {
    return this.filterEndDate;
  }
  public getFilterTags(): string[] {
    return [...this.filterTags];
  } // Return copy
  public getFilterFavoritesOnly(): boolean {
    return this.filterFavoritesOnly;
  }
  public getFilterFilePattern(): string | null {
    return this.filterFilePattern;
  }
  public isTagSelected(tag: string): boolean {
    return this.filterTags.includes(tag);
  }

  /**
   * Calculates the number of active filters applied to this view.
   * @returns The count of active filters.
   */
  public getActiveFilterCount(): number {
    let count = 0;
    if (this.filterStartDate !== null || this.filterEndDate !== null) count++; // Count date range as one filter
    if (this.filterTags.length > 0) count++;
    if (this.filterFavoritesOnly) count++;
    if (this.filterFilePattern !== null && this.filterFilePattern !== '')
      count++;
    return count;
  }

  /**
   * Generates a human-readable description of the active filters for this view instance.
   * @returns A string describing the active filters, or an empty string if none are active.
   */
  public getActiveFiltersDescription(): string {
    const activeFilters = [];
    if (this.filterStartDate !== null || this.filterEndDate !== null) {
      // More descriptive date filter text could be added here
      activeFilters.push('Date');
    }
    if (this.filterTags.length > 0) {
      activeFilters.push(`Tags (${this.filterTags.length})`);
    }
    if (this.filterFavoritesOnly) {
      activeFilters.push('Favorites');
    }
    if (this.filterFilePattern !== null && this.filterFilePattern !== '') {
      activeFilters.push(`File ('${this.filterFilePattern}')`);
    }
    // Return empty string if no filters, otherwise format the string
    return activeFilters.length > 0
      ? `Filtered by: ${activeFilters.join(', ')}`
      : '';
  }

  /**
   * Checks if a snapshot contains files matching the current file pattern filter for this view.
   * @param snapshot The snapshot to check.
   * @returns True if the snapshot matches the file pattern, false otherwise.
   */
  private snapshotMatchesFilePattern(snapshot: Snapshot): boolean {
    const pattern = this.filterFilePattern;
    if (!pattern) {
      return true;
    }

    // For selective snapshots, check only the selected files list
    if (snapshot.isSelective && snapshot.selectedFiles) {
      return snapshot.selectedFiles.some((filePath) =>
        this.pathMatchesPattern(filePath, pattern),
      );
    }

    // For regular (non-selective) snapshots, check all files tracked in the snapshot
    // This includes files that might be just references (baseSnapshotId) or deleted markers
    return Object.keys(snapshot.files).some((filePath) =>
      this.pathMatchesPattern(filePath, pattern),
    );
  }

  /**
   * Helper to match file paths against patterns using the utility function.
   * @param filePath The file path to check.
   * @param pattern The pattern (glob or simple string).
   * @returns True if the path matches the pattern.
   */
  private pathMatchesPattern(filePath: string, pattern: string): boolean {
    // Use substring matching for file filters for broader results
    return pathMatchesPattern(filePath, pattern, { allowSubstring: true });
  }

  /**
   * Returns the tree item representation for the given element.
   * @param element The snapshot tree item.
   * @returns The VS Code TreeItem.
   */
  getTreeItem(element: SnapshotTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Returns the children for the given element or root elements if no element is provided.
   * @param element The parent element or undefined for the root.
   * @returns A promise resolving to an array of child SnapshotTreeItems.
   */
  getChildren(element?: SnapshotTreeItem): Thenable<SnapshotTreeItem[]> {
    const currentLogPrefix = `(${this.viewName} View)`;
    logVerbose(
      `${currentLogPrefix} getChildren called for element: ${
        element?.label ?? 'root'
      }`,
    );

    if (element) {
      // --- Get Children of a Snapshot Item (Files) ---
      if (element.contextValue === 'snapshotItem' && element.snapshot) {
        const snapshot = element.snapshot;
        const allSnapshots = this.snapshotManager.getSnapshots();
        const currentIndex = allSnapshots.findIndex(
          (s) => s.id === snapshot.id,
        );
        const previousSnapshot =
          currentIndex > 0 ? allSnapshots[currentIndex - 1] : null;

        const allFileEntries = Object.entries(snapshot.files || {});
        const fileItems: SnapshotTreeItem[] = [];
        const initialFileCount = allFileEntries.length;

        logVerbose(
          `${currentLogPrefix} Processing ${initialFileCount} file entries for snapshot ${snapshot.id}. showOnlyChangedFiles=${this.showOnlyChangedFiles}`,
        );

        for (const [relativePath, fileData] of allFileEntries) {
          let changeType: 'added' | 'modified' | 'deleted' | undefined;
          let includeItem = false;

          // Determine the change type relative to the previous snapshot
          const wasDeletedInPrevious =
            previousSnapshot?.files[relativePath]?.deleted ?? false;
          const existedInPrevious =
            previousSnapshot?.files[relativePath] !== undefined &&
            !wasDeletedInPrevious;

          if (fileData.deleted) {
            // File is marked deleted in *this* snapshot
            if (!wasDeletedInPrevious) {
              // It was deleted *in this specific snapshot*
              changeType = 'deleted';
            } else {
              // It was already deleted before, ignore unless showing all (handled below)
              changeType = undefined; // Not a change *in this* snapshot
            }
          } else if (fileData.diff) {
            // File was modified in this snapshot
            changeType = 'modified';
          } else if (!existedInPrevious) {
            // File exists now but didn't exist (or was deleted) previously
            changeType = 'added';
          } else {
            // File existed previously and has no diff -> Unchanged
            changeType = undefined;
          }

          // Decide whether to include this file in the tree view
          if (this.showOnlyChangedFiles) {
            // Include only if it was added, modified, or deleted *in this snapshot*
            includeItem = changeType !== undefined;
          } else {
            // Include if it's NOT marked deleted in this snapshot OR if it was deleted *in this snapshot*
            includeItem = !fileData.deleted || changeType === 'deleted';
          }

          if (includeItem) {
            fileItems.push(
              new SnapshotTreeItem(
                snapshot,
                element.isCurrent,
                this.snapshotManager,
                relativePath,
                undefined, // groupName
                undefined, // groupSnapshots
                undefined, // filterInfo
                changeType, // Pass calculated change type
              ),
            );
          }
        }

        logVerbose(
          `${currentLogPrefix} Included ${fileItems.length} file items (from ${initialFileCount} entries) for snapshot ${snapshot.id}`,
        );

        // Sort files: added, modified, deleted, then alphabetically
        fileItems.sort((a, b) => {
          const typeOrder = { added: 0, modified: 1, deleted: 2, undefined: 3 };
          const aType = a.changeType;
          const bType = b.changeType;
          const aOrder = typeOrder[aType ?? 'undefined'];
          const bOrder = typeOrder[bType ?? 'undefined'];

          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }
          // Compare labels robustly, handling both string and TreeItemLabel
          return (
            typeof a.label === 'string' ? a.label : a.label?.label ?? ''
          ).localeCompare(
            typeof b.label === 'string' ? b.label : b.label?.label ?? '',
          );
        });

        return Promise.resolve(fileItems);
      }

      // --- Get Children of a Group Item (Snapshots) ---
      if (element.contextValue === 'snapshotGroup' && element.groupSnapshots) {
        const currentIndex = this.snapshotManager.getCurrentSnapshotIndex();
        // Snapshots within the group are already filtered, just need to sort and map
        const sortedSnapshots = [...element.groupSnapshots].sort(
          (a, b) => b.timestamp - a.timestamp, // Newest first within group
        );

        const snapshotItems = sortedSnapshots.map((snapshot) => {
          const index = this.snapshotManager
            .getSnapshots()
            .findIndex((s) => s.id === snapshot.id);
          return new SnapshotTreeItem(
            snapshot,
            index === currentIndex, // Check if this snapshot is the globally current one
            this.snapshotManager,
          );
        });
        logVerbose(
          `${currentLogPrefix} Returning ${snapshotItems.length} snapshot children for group ${element.groupName}`,
        );
        return Promise.resolve(snapshotItems);
      }

      // --- No Children for File Items or Unknown ---
      logVerbose(
        `${currentLogPrefix} Element is a file or unknown type, returning no children.`,
      );
      return Promise.resolve([]);
    } else {
      // --- Get Root Elements (Groups) ---
      let snapshots = this.snapshotManager.getSnapshots();
      logVerbose(
        `${currentLogPrefix} Getting root children. Total snapshots from manager: ${snapshots.length}`,
      );

      // 1. Filter by Snapshot Type (Manual/Auto) for this specific view instance
      const initialCount = snapshots.length;
      if (this.snapshotTypeFilter === SnapshotType.MANUAL) {
        snapshots = snapshots.filter(
          (snapshot) => !this.isAutoSnapshot(snapshot),
        );
        logVerbose(
          `${currentLogPrefix} Filtered to ${snapshots.length} manual snapshots (from ${initialCount}).`,
        );
      } else if (this.snapshotTypeFilter === SnapshotType.AUTO) {
        snapshots = snapshots.filter((snapshot) =>
          this.isAutoSnapshot(snapshot),
        );
        logVerbose(
          `${currentLogPrefix} Filtered to ${snapshots.length} auto snapshots (from ${initialCount}).`,
        );
      } else {
        logVerbose(
          `${currentLogPrefix} No type filter applied (should not happen for view instances).`,
        );
      }

      // 2. Apply user-defined filters (Date, Tags, Favorites, File Pattern) stored in this instance
      const countBeforeUserFilters = snapshots.length;
      snapshots = snapshots.filter((snapshot) => {
        // Date filtering
        const timestamp = snapshot.timestamp;
        const afterStart =
          this.filterStartDate === null || timestamp >= this.filterStartDate;
        const beforeEnd =
          this.filterEndDate === null || timestamp <= this.filterEndDate;
        if (!afterStart || !beforeEnd) return false;

        // Tag filtering - Use 'every' for AND logic if multiple tags selected
        const matchesTags =
          this.filterTags.length === 0 ||
          (snapshot.tags &&
            this.filterTags.every((tag) => snapshot.tags?.includes(tag)));
        if (!matchesTags) return false;

        // Favorite filtering
        const matchesFavorite =
          !this.filterFavoritesOnly || snapshot.isFavorite === true;
        if (!matchesFavorite) return false;

        // File pattern filtering
        const matchesFilePattern = this.snapshotMatchesFilePattern(snapshot);
        if (!matchesFilePattern) return false;

        return true; // Passed all filters for this provider instance
      });
      logVerbose(
        `${currentLogPrefix} Filtered to ${snapshots.length} snapshots after user filters (from ${countBeforeUserFilters}).`,
      );

      // 3. Group the final filtered list of snapshots
      const groupedSnapshots: { [key: string]: Snapshot[] } = {};
      snapshots.forEach((snapshot) => {
        const groupName = getRelativeDateGroup(snapshot.timestamp);
        if (!groupedSnapshots[groupName]) {
          groupedSnapshots[groupName] = [];
        }
        groupedSnapshots[groupName].push(snapshot);
      });

      // 4. Create group tree items according to the defined order
      const filterDesc = this.getActiveFiltersDescription(); // Get description once for all groups in this view
      const groupItems = GROUP_ORDER.map((groupName) => {
        const snapshotsInGroup = groupedSnapshots[groupName] || [];
        if (snapshotsInGroup.length > 0) {
          // Pass filter description specific to this provider's state
          return new SnapshotTreeItem(
            undefined, // No snapshot for group item
            false, // Group is never 'current'
            this.snapshotManager,
            undefined, // No relativePath
            groupName, // Set groupName
            snapshotsInGroup, // Pass the snapshots belonging to this group
            filterDesc, // Pass the filter description
          );
        }
        return null;
      }).filter((item): item is SnapshotTreeItem => item !== null); // Filter out nulls (empty groups)

      logVerbose(
        `${currentLogPrefix} Returning ${groupItems.length} top-level group items.`,
      );
      return Promise.resolve(groupItems);
    }
  }
}

// --- TreeItem Implementation ---

/**
 * Represents an item in the Snapshot Tree View (can be a Group, a Snapshot, or a File within a snapshot).
 */
export class SnapshotTreeItem extends vscode.TreeItem {
  // Declare properties explicitly for clarity
  public readonly snapshot?: Snapshot; // Undefined for group items
  public readonly isCurrent: boolean; // True if this snapshot is the currently restored one
  private snapshotManager: SnapshotManager; // Reference to the manager for context actions
  public readonly relativePath?: string; // Undefined for group/snapshot items
  public readonly groupName?: string; // Undefined for snapshot/file items
  public readonly groupSnapshots?: Snapshot[]; // Undefined for snapshot/file items
  public snapshotId?: string; // Undefined for group items
  public snapshotTimestamp?: number; // Undefined for group items
  public readonly changeType?: 'added' | 'modified' | 'deleted'; // Undefined for group/snapshot items

  /**
   * Creates an instance of SnapshotTreeItem.
   * The constructor determines the type of item (Group, Snapshot, File) based on the arguments provided.
   */
  constructor(
    snapshot: Snapshot | undefined,
    isCurrent: boolean,
    snapshotManager: SnapshotManager,
    relativePath?: string,
    groupName?: string,
    groupSnapshots?: Snapshot[],
    filterInfo?: string, // Passed for group items to display filter status
    changeType?: 'added' | 'modified' | 'deleted',
  ) {
    // --- Variable Declaration ---
    let label: string;
    let collapsibleState: vscode.TreeItemCollapsibleState;
    let contextValue: string;
    let description: string | undefined;
    let tooltip: string | vscode.MarkdownString = '';
    let command: vscode.Command | undefined;
    let resourceUri: vscode.Uri | undefined;
    let iconPath:
      | string
      | vscode.Uri
      | { light: vscode.Uri; dark: vscode.Uri }
      | vscode.ThemeIcon
      | undefined;
    let id: string;

    // --- Determine properties based on type ---

    // GROUP ITEM
    if (groupName && groupSnapshots) {
      label = groupName;
      description = `(${groupSnapshots.length} snapshot${
        groupSnapshots.length !== 1 ? 's' : ''
      })${filterInfo ? ` ${filterInfo}` : ''}`; // Append filter info to description
      collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      contextValue = 'snapshotGroup';
      iconPath = new vscode.ThemeIcon('calendar');
      id = `group_${groupName.replace(/\s+/g, '_')}`; // Create a unique ID for the group

      const groupTooltip = new vscode.MarkdownString('', true);
      groupTooltip.supportThemeIcons = true;
      groupTooltip.appendMarkdown(`### $(calendar) ${groupName}\n\n`);
      groupTooltip.appendMarkdown(
        `Contains **${groupSnapshots.length}** snapshots.\n`,
      );
      if (filterInfo) {
        groupTooltip.appendMarkdown(`\n**Filters Active:** ${filterInfo}\n`);
      }
      // Summarize total changes across all snapshots in this group
      const totalSummary = groupSnapshots.reduce(
        (acc, snap) => {
          const s = snapshotManager.getSnapshotChangeSummary(snap.id);
          acc.added += s.added;
          acc.modified += s.modified;
          acc.deleted += s.deleted;
          return acc;
        },
        {
          added: 0,
          modified: 0,
          deleted: 0,
        },
      );
      groupTooltip.appendMarkdown(
        `\n**Total Changes:** $(diff-added) ${totalSummary.added} $(diff-modified) ${totalSummary.modified} $(diff-removed) ${totalSummary.deleted}\n\n`,
      );
      tooltip = groupTooltip;
      command = undefined;
      resourceUri = undefined;

      // FILE ITEM
    } else if (snapshot && relativePath) {
      label = path.basename(relativePath);
      collapsibleState = vscode.TreeItemCollapsibleState.None;
      contextValue = 'snapshotFile';
      id = `${snapshot.id}_${relativePath}`; // Unique ID for file within snapshot

      const dir = path.dirname(relativePath);
      // Display directory path in description, handle root case (".")
      const dirDisplay = dir === '.' ? '' : dir;

      // Set icon and description based on the calculated changeType
      switch (changeType) {
        case 'added':
          description = `${dirDisplay} $(diff-added)`; // Use standard icons
          iconPath = new vscode.ThemeIcon('diff-added');
          break;
        case 'modified':
          description = `${dirDisplay} $(diff-modified)`;
          iconPath = new vscode.ThemeIcon('diff-modified');
          break;
        case 'deleted':
          description = `${dirDisplay} $(diff-removed)`;
          iconPath = new vscode.ThemeIcon('diff-removed');
          break;
        default: // Undefined changeType means unchanged relative to previous
          description = dirDisplay;
          iconPath = vscode.ThemeIcon.File;
      }

      // Set resourceUri for file-specific actions (like revealing in explorer)
      const workspaceRoot = snapshotManager.getWorkspaceRoot();
      if (workspaceRoot) {
        resourceUri = vscode.Uri.joinPath(
          vscode.Uri.file(workspaceRoot),
          relativePath,
        );
      } else {
        // Fallback if workspace root isn't available (less likely for file items)
        resourceUri = vscode.Uri.file(relativePath);
      }

      // Create detailed tooltip for file items
      const fileTooltip = new vscode.MarkdownString('', true);
      fileTooltip.supportThemeIcons = true;
      fileTooltip.appendMarkdown(`**File:** \`${relativePath}\`\n\n`);
      fileTooltip.appendMarkdown(
        `**Snapshot:** ${
          snapshot.description || snapshot.id.substring(0, 8)
        }\n`,
      );
      fileTooltip.appendMarkdown(
        `*(Taken: ${new Date(snapshot.timestamp).toLocaleString()})*\n\n`,
      );
      // Add diff summary if available
      const diffText = snapshot.files[relativePath]?.diff;
      if (diffText) {
        const plusCount = diffText
          .split('\n')
          .filter((l) => /^\+[^+]/.test(l)).length;
        const minusCount = diffText
          .split('\n')
          .filter((l) => /^-[^-]/.test(l)).length;
        fileTooltip.appendMarkdown(
          `**Diff:** +${plusCount}/-${minusCount} lines\n\n`,
        );
      }
      // Display change status clearly
      if (changeType === 'added')
        fileTooltip.appendMarkdown(
          `$(diff-added) **Added** in this snapshot\n\n`,
        );
      else if (changeType === 'modified')
        fileTooltip.appendMarkdown(
          `$(diff-modified) **Modified** in this snapshot\n\n`,
        );
      else if (changeType === 'deleted')
        fileTooltip.appendMarkdown(
          `$(diff-removed) **Deleted** in this snapshot\n\n`,
        );
      else
        fileTooltip.appendMarkdown(
          `$(circle-outline) Unchanged from previous\n\n`,
        ); // Clarify unchanged status
      fileTooltip.appendMarkdown(
        `**Actions:** Click to compare, Right-click for more.`,
      );
      tooltip = fileTooltip;

      // Set command to trigger comparison when the file item is clicked
      command = {
        command: 'vscode-snapshots.compareFileWithWorkspace',
        title: 'Compare File with Workspace Version',
        arguments: [
          // Pass necessary arguments for the command handler
          {
            snapshotId: snapshot.id,
            relativePath: relativePath,
            snapshotTimestamp: snapshot.timestamp, // For potential use in diff title
            label: label, // Pass label if needed by command
            contextValue: 'snapshotFile', // Identify item type
          },
        ],
      };

      // SNAPSHOT ITEM
    } else if (snapshot) {
      const date = new Date(snapshot.timestamp);
      const formattedTime = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      collapsibleState = vscode.TreeItemCollapsibleState.Collapsed; // Snapshots can be expanded to show files
      contextValue = 'snapshotItem';
      id = snapshot.id; // Use snapshot ID as the tree item ID

      // Build label with favorite and selective indicators
      let labelPrefix = '';
      if (snapshot.isFavorite) labelPrefix += '$(star-full) ';
      label = `${labelPrefix}${formattedTime}`;
      if (snapshot.isSelective) label += ' (Selective)';

      // Build description string with various context pieces
      const descParts: string[] = [];
      let baseDescription =
        snapshot.description || `ID: ${snapshot.id.substring(0, 8)}`;
      if (snapshot.taskReference)
        baseDescription = `[${snapshot.taskReference}] ${baseDescription}`;
      descParts.push(baseDescription);
      if (snapshot.tags && snapshot.tags.length > 0) {
        descParts.push(`$(tag) ${snapshot.tags.length}`); // Show tag count
      }
      if (snapshot.gitBranch) {
        descParts.push(`$(git-branch) ${snapshot.gitBranch}`);
      }
      // Join parts with a separator for readability
      description = descParts.join('  |  ');

      // Create rich markdown tooltip
      const snapshotTooltip = new vscode.MarkdownString('', true);
      snapshotTooltip.supportThemeIcons = true;
      let title = snapshot.description
        ? `"${snapshot.description}"`
        : `Snapshot ${snapshot.id.substring(0, 8)}`;
      if (snapshot.isFavorite) title = `$(star-full) ${title}`;
      if (isCurrent) title = `$(debug-step-back) ${title} (Current)`; // Use step-back icon for current
      snapshotTooltip.appendMarkdown(`### ${title}\n\n`);
      snapshotTooltip.appendMarkdown(`**Taken:** ${date.toLocaleString()}\n\n`);
      if (snapshot.taskReference)
        snapshotTooltip.appendMarkdown(
          `**Task:** \`${snapshot.taskReference}\`\n\n`,
        );
      // Combine Git info onto one line if both exist
      let fullGitInfo = '';
      if (snapshot.gitBranch)
        fullGitInfo += `$(git-branch) ${snapshot.gitBranch}`;
      if (snapshot.gitCommitHash)
        fullGitInfo += `${
          fullGitInfo ? ' ' : '' // Add space if branch was already added
        }$(git-commit) \`${snapshot.gitCommitHash.substring(0, 7)}\``;
      if (fullGitInfo)
        snapshotTooltip.appendMarkdown(`**Git:** ${fullGitInfo}\n\n`);
      // Display tags
      if (snapshot.tags && snapshot.tags.length > 0) {
        snapshotTooltip.appendMarkdown(
          `**Tags:** ${snapshot.tags.map((t) => `\`#${t}\``).join(' ')}\n\n`,
        );
      }
      // Display notes
      if (snapshot.notes) {
        // Truncate notes preview to first two lines
        const lines = snapshot.notes.split('\n');
        const preview =
          lines.slice(0, 2).join('\n') + (lines.length > 2 ? '\n...' : '');
        snapshotTooltip.appendMarkdown(`**Notes:**\n\n${preview}\n\n`);
      }
      // Show change summary
      const summary = snapshotManager.getSnapshotChangeSummary(snapshot.id); // Calculate summary once
      if (summary.added > 0 || summary.modified > 0 || summary.deleted > 0) {
        snapshotTooltip.appendMarkdown(
          `**Changes:** $(diff-added) ${summary.added} $(diff-modified) ${summary.modified} $(diff-removed) ${summary.deleted}\n\n`,
        );
      } else {
        snapshotTooltip.appendMarkdown(
          `**Changes:** None detected relative to previous snapshot.\n\n`,
        );
      }
      snapshotTooltip.appendMarkdown(
        `---\n**Actions:** Click to view changed files, Right-click for more options.`,
      );
      tooltip = snapshotTooltip;

      // Set command to show changed files when snapshot item is clicked
      command = {
        command: 'vscode-snapshots.showChangedFilesInSnapshot',
        title: 'Show Changed Files in this Snapshot',
        arguments: [{ snapshot, contextValue: 'snapshotItem' }], // Pass necessary context
      };

      // --- Icon Logic with Colorization (Using Standard Theme Colors) ---
      if (isCurrent) {
        iconPath = new vscode.ThemeIcon(
          'debug-step-back', // Icon indicating this is the restored state
          new vscode.ThemeColor('debugIcon.stepBackForeground'), // Use a distinct color
        );
      } else if (snapshot.isSelective) {
        iconPath = new vscode.ThemeIcon(
          'filter',
          new vscode.ThemeColor('list.filterMatchBackground'), // Use a color associated with filtering
        );
      } else if (snapshot.isFavorite) {
        iconPath = new vscode.ThemeIcon(
          'star-full',
          new vscode.ThemeColor('list.warningForeground'), // Use warning color (often yellow/orange)
        );
      } else {
        // Default: History icon, colorized based on change count
        const totalChanges = summary.added + summary.modified + summary.deleted;
        let iconColorId = 'foreground'; // Default subtle color (editor foreground)
        const highThreshold = 20; // Define thresholds for color changes
        const mediumThreshold = 5;

        if (totalChanges > highThreshold) {
          iconColorId = 'list.errorForeground'; // Standard Red for many changes
        } else if (totalChanges > mediumThreshold) {
          iconColorId = 'list.warningForeground'; // Standard Yellow/Orange for moderate changes
        } else if (totalChanges > 0) {
          iconColorId = 'list.highlightForeground'; // Standard Blueish highlight for few changes
        } else if (totalChanges === 0) {
          iconColorId = 'list.inactiveSelectionBackground'; // Standard Grayish for no changes
        }
        // else: keep default 'foreground' color for no changes

        logVerbose(
          `Snapshot ${id}: Changes=${totalChanges}, Assigning color ID '${iconColorId}' for history icon.`,
        );
        iconPath = new vscode.ThemeIcon(
          'history',
          new vscode.ThemeColor(iconColorId),
        );
      }
      resourceUri = undefined; // Snapshots don't directly map to a single file URI

      // UNKNOWN ITEM (Fallback)
    } else {
      label = 'Unknown Item';
      collapsibleState = vscode.TreeItemCollapsibleState.None;
      contextValue = 'unknown';
      tooltip = 'An unknown item was encountered.';
      iconPath = new vscode.ThemeIcon('error');
      id = 'unknown_' + Date.now();
      command = undefined;
      resourceUri = undefined;
    }

    // --- Call super() constructor ---
    super(label, collapsibleState);

    // --- Assign properties to 'this' AFTER super() ---
    this.snapshot = snapshot;
    this.isCurrent = isCurrent;
    this.snapshotManager = snapshotManager;
    this.relativePath = relativePath;
    this.groupName = groupName;
    this.groupSnapshots = groupSnapshots;
    this.changeType = changeType; // Store the change type

    this.id = id; // Assign the unique ID
    this.snapshotId = snapshot?.id; // Store snapshot ID if applicable
    this.snapshotTimestamp = snapshot?.timestamp; // Store timestamp if applicable
    this.contextValue = contextValue; // Used for context menu 'when' clauses
    this.description = description; // Text displayed next to the label
    this.tooltip = tooltip; // Hover text (can be Markdown)
    this.resourceUri = resourceUri; // URI for file items
    this.iconPath = iconPath; // Icon for the item
    this.command = command; // Command executed on click

    // Accessibility Information
    if (snapshot && !relativePath) {
      // Snapshot item
      this.accessibilityInformation = {
        label: `Snapshot ${
          snapshot.description
            ? snapshot.description
            : `ID ${snapshot.id.substring(0, 8)}`
        } from ${new Date(snapshot.timestamp).toLocaleString()}${
          isCurrent ? ', current snapshot' : ''
        }${snapshot.isFavorite ? ', favorite' : ''}${
          snapshot.isSelective ? ', selective' : ''
        }`,
        role: 'treeitem',
      };
    } else if (snapshot && relativePath) {
      // File item
      this.accessibilityInformation = {
        label: `${changeType || 'File'} ${path.basename(
          relativePath,
        )} in directory ${path.dirname(relativePath)} from snapshot ${
          snapshot.description || snapshot.id.substring(0, 8)
        }`,
        role: 'treeitem',
      };
    } else if (groupName) {
      // Group item
      this.accessibilityInformation = {
        label: `${groupName} snapshot group containing ${
          groupSnapshots?.length || 0
        } snapshots`,
        role: 'treeitem',
      };
    }
  }
}
