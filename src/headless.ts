/**
 * Headless-run guards for VS Code UI that only an interactive window can
 * answer (integration tests, CI, any extension host started without a UI).
 *
 * Why pickers need an explicit guard, while modals do not:
 *
 * VS Code's own test harness (`DialogService`) *refuses* modal dialogs — a
 * `showWarningMessage({ modal: true })` rejects immediately, which is why the
 * interactive delete confirmation fails fast in the integration suite. Two
 * non-modal prompts do not behave that way: `showQuickPick` and
 * `showInputBox` are simply queued for a window that never renders them, so
 * their promise **never settles**. An `await` on one of those therefore hangs
 * the calling command — and whatever is awaiting that command — until an
 * unrelated timeout fires, with no error to point at the cause.
 *
 * Modals are safe to leave alone; pickers are not. And because a single
 * unguarded picker is enough to wedge a whole suite silently, every prompt
 * site must consult this one predicate rather than testing its own
 * environment variable.
 *
 * One-way UI side effects are the third case and follow the same rule for a
 * different reason. Revealing the CodeLapse output channel is the example: no
 * human can read it in a headless run, and the editor a reveal opens cannot be
 * closed again by anything this host offers (`workbench.action.closeAllEditors`,
 * `workbench.action.closeActiveEditor` and `window.tabGroups.close` all leave it
 * in place). It therefore outlives the command that opened it and leaves the
 * host's editor state permanently changed for whatever runs next — which is how
 * a later suite's "no editor is open" precondition came to depend on focus
 * bookkeeping. The predicate consequently covers reveals as well as prompts,
 * which does mean the older credential-only variable suppresses reveals too:
 * that variable is a headless switch, and a headless host has nobody to reveal
 * anything to.
 */

/**
 * True when the extension host cannot be expected to get an answer from a
 * human, so interactive prompts must be skipped or failed fast instead of
 * awaited.
 *
 * `CODELAPSE_DISABLE_CREDENTIAL_PROMPTS` is the original, already-shipped
 * variable (set by `test/runTest.ts` and honoured by the credential guards in
 * `vectorDatabaseService` / `embeddingService`); it keeps working so existing
 * launchers and documentation stay valid. `CODELAPSE_DISABLE_INTERACTIVE_UI`
 * is the general form covering every prompt, not just credential ones.
 *
 * It also covers one-way UI side effects no human can read — revealing an
 * output channel is the one in use, see the header note on why a reveal is
 * worse than a prompt in a host that never closes what it opens.
 */
export function isInteractiveUiDisabled(): boolean {
  return (
    process.env.CODELAPSE_DISABLE_INTERACTIVE_UI === '1' ||
    process.env.CODELAPSE_DISABLE_CREDENTIAL_PROMPTS === '1'
  );
}
