# dsh-tender-workbench 0.4.0 release checklist

- Version: **0.4.0**
- Release date: 2026-09-05
- Status: **release candidate**
- Release commit: pending
- Git tag: pending
- npm publication: pending
- GitHub Release: pending

## Scope

Version 0.4.0 promotes the complete 0.3.0 beta workflow to the stable npm channel. It includes the Session-scoped query, deterministic rule screening, bounded Agent analysis, explicit human review, and immutable Excel/PDF delivery already represented by the V2 contracts. This release adds repeatable documentation, packaging, CI, and OIDC publication gates; it does not migrate the workflow or Artifact schema used by 0.3.0-beta.1.

## Compatibility and installation

- Node.js: `^22.19.0 || >=24.0.0`
- Package manager: `pnpm@11.7.0`
- DeepSeek Harness public packages: `>=0.1.1-rc.2 || >=0.1.2-0`
- `dsh-mcp-connector`: `>=0.2.31`
- `dsh-better-sidebar`: `>=0.17.1 || >=0.18.0-0`
- Required MCP tools: `mcp__qcc-tender__search_tenders` and `mcp__qcc-tender__search_proposed_projects`

Install `dsh-tender-workbench@0.4.0` together with compatible Provider plugins, then fully restart the Web profile. Missing required services, incompatible Better Sidebar capabilities, unavailable MCP tools, or non-JSONL Session persistence fail explicitly.

## Release gates

- [x] Frozen pnpm install completes with the repository lockfile.
- [x] TypeScript type checking passes.
- [x] Full Vitest suite passes.
- [x] Host loader, Client bundle, source maps, and declarations build successfully.
- [x] README and release-state checks pass for 0.4.0.
- [x] `npm pack --dry-run --json` contains only whitelisted public files.
- [x] A clean temporary installation imports the packed Host entry and package metadata and registers the Client bundle.
- [ ] `main` CI passes on Linux Node 22/24 and Windows Node 24.
- [ ] Tag `v0.4.0` resolves to the reviewed release commit.
- [ ] npm Trusted Publishing creates `dsh-tender-workbench@0.4.0` with provenance and the `latest` dist-tag.
- [ ] GitHub Release `v0.4.0` is neither draft nor prerelease.

Unchecked items are pending and must not be reported as completed.

## Local validation record

Validated on 2026-09-05 with pnpm 11.7.0:

- `pnpm install --frozen-lockfile`: passed with the checked-in lockfile and `allowBuilds` policy.
- `pnpm run check`: passed, including 207 passing tests and 1 intentional skip across 40 test files.
- Package whitelist: passed with 169 public files and no source, test, script, cache, credential, or private Artifact paths.
- Clean-install smoke test: passed after supplying the same DSH Host peer baseline used by development; the Host entry exported `apply` and `inject`, package metadata reported 0.4.0, and the Client bundle registered with the module loader.

The ordinary npm peer auto-installer currently reports an upstream DSH peer-version conflict between the connector and UI layout packages. The production DSH plugin manager supplies the Host peer set, so the isolated smoke test installs the tarball with peer auto-installation disabled and then injects the compatible 0.1.1-rc.2 Host baseline explicitly. The build also reports an upstream missing source-map warning from `@deepseek-ai/dsh-client-ui-primitives`; generated package source maps are present and the gate passes.

## Publication procedure

1. Run `pnpm install --frozen-lockfile` using pnpm 11.7.0.
2. Run `pnpm run check` and the clean tarball installation/import smoke test.
3. Commit only the reviewed 0.4.0 release files and push `main`.
4. Wait for all required CI jobs to pass.
5. Create annotated tag `v0.4.0` on the pushed release commit and push the tag.
6. The tag workflow verifies `v${package.version}`, reruns the complete gates, publishes with npm OIDC Trusted Publishing and provenance, then creates the GitHub Release.
7. Verify npm version, dist-tags, repository, maintainers, tarball metadata/file list, clean installation/import, Git commit/tag, and GitHub Release state.

## Security

- Never store or print npm tokens, GitHub tokens, QCC credentials, source datasets, real business evidence, or Session-private Artifacts.
- The npm package must exclude `src`, `tests`, `scripts`, `.github`, `resources`, caches, local evidence, and environment files.
- Runtime QCC access remains customer-authorized through the connector; this repository does not own or proxy credentials.
- pnpm's `allowBuilds` policy explicitly keeps the indirect `node-pty` native build script disabled because this package does not use its binary at runtime or in the release gates.

## Rollback

- Before the tag is pushed: delete only the local tag if necessary, fix the release commit, and rerun all gates.
- After the tag is pushed but before npm publication: stop the failing workflow, fix forward with a new patch version and tag, and do not reuse a public tag.
- After npm publication: never overwrite or unpublish 0.4.0. Mark the affected version if necessary, publish a corrected patch version, and use an ordinary revert commit for source rollback.
- Deployment rollback target: reinstall `dsh-tender-workbench@0.3.0-beta.1` and fully restart the profile.
