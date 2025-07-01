import * as vscode from 'vscode';
import { AutoSnapshotRule, getAutoSnapshotRules } from '../config';
import { log } from '../logger';

/**
 * UI class for managing auto-snapshot rules
 */
export class AutoSnapshotRulesUI {
  /**
   * Shows the UI for managing auto-snapshot rules
   */
  public static async show(): Promise<void> {
    const actions = [
      {
        label: '$(add) Add New Rule',
        description: 'Create a new auto-snapshot rule',
        action: 'add',
      },
      {
        label: '$(edit) Edit Rules',
        description: 'Modify existing auto-snapshot rules',
        action: 'edit',
      },
      {
        label: '$(trash) Delete Rules',
        description: 'Remove auto-snapshot rules',
        action: 'delete',
      },
      {
        label: '$(preview) View All Rules',
        description: 'See all configured auto-snapshot rules',
        action: 'view',
      },
    ];

    const selectedAction = await vscode.window.showQuickPick(actions, {
      placeHolder: 'Select an action for auto-snapshot rules',
      title: 'Manage Auto-Snapshot Rules',
    });

    if (!selectedAction) {
      return; // User cancelled
    }

    switch (selectedAction.action) {
      case 'add':
        await this.addRule();
        break;
      case 'edit':
        await this.editRules();
        break;
      case 'delete':
        await this.deleteRules();
        break;
      case 'view':
        await this.viewRules();
        break;
    }
  }

  /**
   * Shows UI for adding a new auto-snapshot rule
   */
  private static async addRule(): Promise<void> {
    // Step 1: Get file pattern
    const patternInput = await vscode.window.showInputBox({
      prompt: 'Enter file pattern (glob syntax)',
      placeHolder: 'E.g., src/*.js or **/*.ts or specific/file.json',
      validateInput: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Pattern cannot be empty';
        }
        return null; // Pattern is valid
      },
    });

    if (patternInput === undefined) {
      return; // User cancelled
    }

    // Step 2: Get interval in minutes
    const intervalInput = await vscode.window.showInputBox({
      prompt: 'Enter interval in minutes between snapshots for this pattern',
      placeHolder: 'E.g., 15',
      validateInput: (input) => {
        const intervalMinutes = parseInt(input, 10);
        if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
          return 'Interval must be a positive number';
        }
        return null; // Interval is valid
      },
    });

    if (intervalInput === undefined) {
      return; // User cancelled
    }

    const intervalMinutes = parseInt(intervalInput, 10);

    // Create the new rule
    const newRule: AutoSnapshotRule = {
      pattern: patternInput.trim(),
      intervalMinutes,
    };

    // Get current rules and add the new one
    const currentRules = getAutoSnapshotRules();
    const updatedRules = [...currentRules, newRule];

    // Save the updated rules
    await this.saveRules(updatedRules);

    vscode.window.showInformationMessage(
      `Auto-snapshot rule added: ${newRule.pattern} (every ${newRule.intervalMinutes} minutes)`,
    );
  }

  /**
   * Shows UI for editing existing rules
   */
  private static async editRules(): Promise<void> {
    const currentRules = getAutoSnapshotRules();

    if (currentRules.length === 0) {
      vscode.window.showInformationMessage('No auto-snapshot rules to edit');
      return;
    }

    // Create QuickPick items from rules
    const ruleItems = currentRules.map((rule, index) => ({
      label: `${index + 1}. ${rule.pattern}`,
      description: `Every ${rule.intervalMinutes} minutes`,
      rule,
      index,
    }));

    const selectedRuleItem = await vscode.window.showQuickPick(ruleItems, {
      placeHolder: 'Select a rule to edit',
      title: 'Edit Auto-Snapshot Rule',
    });

    if (!selectedRuleItem) {
      return; // User cancelled
    }

    // Edit the selected rule
    const rule = selectedRuleItem.rule;

    // Step 1: Edit pattern (pre-filled with current value)
    const patternInput = await vscode.window.showInputBox({
      prompt: 'Edit file pattern (glob syntax)',
      value: rule.pattern,
      validateInput: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Pattern cannot be empty';
        }
        return null; // Pattern is valid
      },
    });

    if (patternInput === undefined) {
      return; // User cancelled
    }

    // Step 2: Edit interval (pre-filled with current value)
    const intervalInput = await vscode.window.showInputBox({
      prompt: 'Edit interval in minutes',
      value: rule.intervalMinutes.toString(),
      validateInput: (input) => {
        const intervalMinutes = parseInt(input, 10);
        if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
          return 'Interval must be a positive number';
        }
        return null; // Interval is valid
      },
    });

    if (intervalInput === undefined) {
      return; // User cancelled
    }

    const intervalMinutes = parseInt(intervalInput, 10);

    // Update the rule
    const updatedRule: AutoSnapshotRule = {
      pattern: patternInput.trim(),
      intervalMinutes,
    };

    // Replace the rule in the array
    const updatedRules = [...currentRules];
    updatedRules[selectedRuleItem.index] = updatedRule;

    // Save the updated rules
    await this.saveRules(updatedRules);

    vscode.window.showInformationMessage(
      `Auto-snapshot rule updated: ${updatedRule.pattern} (every ${updatedRule.intervalMinutes} minutes)`,
    );
  }

  /**
   * Shows UI for deleting rules
   */
  private static async deleteRules(): Promise<void> {
    const currentRules = getAutoSnapshotRules();

    if (currentRules.length === 0) {
      vscode.window.showInformationMessage('No auto-snapshot rules to delete');
      return;
    }

    // Create QuickPick items from rules
    const ruleItems = currentRules.map((rule, index) => ({
      label: `${index + 1}. ${rule.pattern}`,
      description: `Every ${rule.intervalMinutes} minutes`,
      rule,
      index,
    }));

    const selectedRuleItems = await vscode.window.showQuickPick(ruleItems, {
      placeHolder: 'Select rules to delete (select multiple with Shift/Ctrl)',
      canPickMany: true,
      title: 'Delete Auto-Snapshot Rules',
    });

    if (!selectedRuleItems || selectedRuleItems.length === 0) {
      return; // User cancelled or didn't select any rules
    }

    // Confirm deletion
    const selectedIndexes = selectedRuleItems.map((item) => item.index);
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete ${selectedRuleItems.length} rule(s)?`,
      { modal: true },
      'Delete',
    );

    if (confirmation !== 'Delete') {
      return; // User cancelled
    }

    // Filter out the selected rules
    const updatedRules = currentRules.filter(
      (_, index) => !selectedIndexes.includes(index),
    );

    // Save the updated rules
    await this.saveRules(updatedRules);

    vscode.window.showInformationMessage(
      `Deleted ${selectedRuleItems.length} auto-snapshot rule(s)`,
    );
  }

  /**
   * Shows a view of all configured rules
   */
  private static async viewRules(): Promise<void> {
    const currentRules = getAutoSnapshotRules();

    if (currentRules.length === 0) {
      vscode.window.showInformationMessage('No auto-snapshot rules configured');
      return;
    }

    // Create a readable list of rules
    const ruleDescriptions = currentRules.map(
      (rule, index) =>
        `${index + 1}. Pattern: ${rule.pattern}, Interval: ${
          rule.intervalMinutes
        } minutes`,
    );

    // Show the rules in a quick pick (just for viewing)
    const itemsWithHeader = [
      {
        label: '--- Configured Auto-Snapshot Rules ---',
        kind: vscode.QuickPickItemKind.Separator,
      },
      ...ruleDescriptions.map((desc) => ({ label: desc })),
    ];

    await vscode.window.showQuickPick(itemsWithHeader, {
      placeHolder: 'Press Escape to close',
      title: `Auto-Snapshot Rules (${currentRules.length})`,
    });
  }

  /**
   * Saves the updated rules to VS Code configuration
   */
  private static async saveRules(rules: AutoSnapshotRule[]): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('vscode-snapshots');
      await config.update(
        'autoSnapshot.rules',
        rules,
        vscode.ConfigurationTarget.Workspace,
      );
      log(
        `Updated auto-snapshot rules configuration with ${rules.length} rules`,
      );
    } catch (error) {
      log(`Error saving auto-snapshot rules: ${error}`);
      vscode.window.showErrorMessage(
        `Failed to save auto-snapshot rules: ${error}`,
      );
      throw error;
    }
  }
}

// Register the command in your extension activation function
