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
 */
export function isInteractiveUiDisabled(): boolean {
  return (
    process.env.CODELAPSE_DISABLE_INTERACTIVE_UI === '1' ||
    process.env.CODELAPSE_DISABLE_CREDENTIAL_PROMPTS === '1'
  );
}
