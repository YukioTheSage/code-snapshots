# Releasing CodeLapse

Three artifacts are versioned and released independently from this one
repository.

| Artifact | Path | Registry | Current |
| --- | --- | --- | --- |
| `vscode-snapshots` (CodeLapse) | repository root | VS Code Marketplace | 0.9.6 |
| `codelapse-core` | `shared/` | npm | 0.9.6 |
| `codelapse-cli` | `cli/` | npm | 2.0.0 |

## Order matters

1. **`codelapse-core` first.** `codelapse-cli` declares a semver range on the
   core, so the matching core version must already be on the registry before
   the CLI can be installed by anyone.
2. **Then `codelapse-cli`.**
3. **Then the extension.** It is independent of the registry: esbuild inlines
   the core into `dist/extension.js`, so the VSIX never resolves
   `codelapse-core` at install time.

## Never publish a `file:` specifier

`npm` does **not** rewrite `file:` dependencies at publish time. If
`cli/package.json` says `"codelapse-core": "file:../shared"` when you publish,
the tarball on the registry keeps that specifier and every consumer install
fails with a missing-module error.

The repository uses `file:` links during development so that `shared/src` is
the code under test. Flipping to a range is an explicit release step, not a
permanent state, and it must be done **after** the matching core version is
published.

Confirm before publishing either package:

```bash
npm pkg get dependencies.codelapse-core
npm pkg get dependencies.codelapse-core --prefix cli
# both must print a range such as ^0.9.6 -- never file:shared or file:../shared
```

The reliable check is against the packed tarball, which is what the registry
actually receives:

```bash
npm pack --prefix cli --pack-destination /tmp/cli-probe
tar -xzf /tmp/cli-probe/codelapse-cli-*.tgz -C /tmp/cli-probe
node -e "const p=require('/tmp/cli-probe/package/package.json'); \
  if (/file:/.test(JSON.stringify(p.dependencies))) throw new Error('BLOCKER: file: specifier'); \
  console.log('OK: no file: specifier');"
```

## Credentials

- **npm**: a Granular Access Token with *read and write* on **both**
  `codelapse-core` and `codelapse-cli`, **bypass 2FA** enabled (npm restricts
  2FA-bypassing tokens for direct publishing), stored in `~/.npmrc`.
- **Marketplace**: an Azure DevOps Personal Access Token scoped to **All
  accessible organizations** and **Marketplace → Manage**, exported as
  `VSCE_PAT`. An organization-scoped PAT is the most common publish failure.

Verify both before starting. Do not begin a release on the assumption that an
existing token still works:

```bash
npm whoami                     # must print the maintainer name
npx vsce verify-pat YukioTheSage
```

### This account requires 2FA for writes, so a script cannot publish

`npm profile get` reports `tfa.mode = auth-and-writes`. A `npm publish` from a
non-interactive shell therefore fails:

```
npm error code EOTP
npm error This operation requires a one-time password.
npm error Open this URL in your browser to authenticate:
```

npm prints a browser URL to authenticate and waits only when it has a TTY. Two
consequences:

- An agent or CI job cannot complete a publish. A human runs `npm publish` from
  a terminal, or supplies `--otp=<code>` with a fresh code. TOTP codes are
  single-use and expire in about 30 seconds, so they cannot be passed around.
- A 2FA-bypass Granular Access Token still publishes directly today, but GitHub
  has announced that bypass tokens lose the ability to publish directly around
  **January 2027**. Move to trusted publishing (OIDC) or staged publishing
  before then.

### The repository root refuses to publish to npm

The extension's name, `vscode-snapshots`, is unclaimed on npm, so an
`npm publish` run from the repository root would quietly publish the extension
to npm, where it was never meant to go. The extension ships to the Marketplace
only.

`"private": true` alone does **not** prevent that, which is worth knowing
because it is the widely assumed guard. npm 11 enforces the private flag only
when publishing a *workspace member*:

```js
// npm/lib/commands/publish.js
if (workspace && manifest.private) { throw ... code: 'EPRIVATE' }
```

`workspace` is the workspace name passed by `execWorkspaces`, and this
repository declares no `workspaces`, so the branch never runs. Verified against
npm 11.17.0 with a throwaway private, non-workspace package: `npm publish
--dry-run` exited 0 and reported the tarball as publishable.

What actually blocks it is a root `prepublishOnly` script that exits non-zero.
`prepublishOnly` runs on `npm publish` only — not on `npm ci`, not on
`npm install`, and not on `vsce package`, which uses the separate
`vscode:prepublish` hook — so packaging and CI are unaffected.

Guard the working directory anyway before any manual publish:

```bash
node -e "const p=require('./package.json'); \
  if (p.name!=='codelapse-core') { console.error('WRONG PACKAGE: '+p.name); process.exit(1); } \
  console.log('OK: '+p.name+'@'+p.version);"
```

## Gates

All of these must pass before any push.

```bash
# root (the extension)
npm run check-types
npm run lint
npm run format:check
npx jest --runInBand --ci --forceExit

# shared (codelapse-core)
(cd shared && npx tsc --noEmit && npm run build && npx jest --runInBand --ci)

# cli (codelapse-cli)
(cd cli && npm run check-types && npm run check-types:test && npm run lint \
  && npm run format:check && npm run test:ci && npm run build)
```

`--forceExit` is required at the root: the suite reports leaked handles because
`CliConnectorService` never closes its server.

`shared/` deliberately has no lint or format gate. Adding one now would fail on
arrival, because several of its files do not satisfy prettier.

Then inspect what would actually ship:

```bash
npm publish --dry-run --prefix shared
npm publish --dry-run --prefix cli
npm run package          # builds the VSIX locally
```

For the VSIX, confirm the file list contains the extension and nothing
internal. The 0.9.5 VSIX shipped `docs/superpowers/**`, `.superpowers/sdd/**`,
`.claude/**`, `AUDIT_REPORT.md`, `PLAN_AUDIT.md` and `FIX_PROGRESS.md`; the
`.vscodeignore` rules that prevent that must stay in place.

## Publish

```bash
npm publish --prefix shared
npm publish --prefix cli
npx vsce publish --no-dependencies -p "$VSCE_PAT"
```

Publish from a clean tree: `git status --porcelain` must be empty first.

## Tag

The repository has a `v0.9.4` tag and no tag for 0.9.5, 1.0.0 or 1.0.1.

```bash
git tag -a v0.9.6 -m "codelapse-core 0.9.6, codelapse-cli 2.0.0, extension 0.9.6"
git push origin main
git push origin v0.9.6
```

## Post-publish verification

Verify from the registries, not from the local tree.

```bash
npm view codelapse-core version          # 0.9.6
npm view codelapse-cli version           # 2.0.0
npm view codelapse-cli dependencies      # codelapse-core must be a range
npx vsce show YukioTheSage.vscode-snapshots
```

Finally, prove a clean consumer works. This is the check that would have
caught the `file:` defect, and it is worth running even when everything above
looks right:

```bash
mkdir -p /tmp/codelapse-consumer && cd /tmp/codelapse-consumer
npm init -y
npm install codelapse-cli@2.0.0
npx codelapse --help
```

## Keeping the VSIX clean

`.vscodeignore` decides what ships; `.git/info/exclude` only hides files on one
machine and does not travel with the repository. Anything added to one for
being internal must be added to the other, or it will be published.
