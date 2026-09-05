# Changelog

All notable changes to `dsh-tender-workbench` are documented in this file.

## [Unreleased]

## [0.4.1] - 2026-09-05

### Changed

- Reworked the GitHub and npm landing content into a Chinese-first product introduction for domestic customers, while preserving the complete English documentation in `README.en.md` with bidirectional language links.
- Replaced the npm package description with a concise Chinese capability summary and added Chinese discovery keywords for tender notices, proposed projects, and Qichacha.
- Updated packaging and release gates so both language pages and the 0.4.1 release record are verified in the public tarball.

### Compatibility

- The workflow, runtime implementation, public exports, and Artifact schema are unchanged from 0.4.0; this patch only changes product presentation and release metadata.

## [0.4.0] - 2026-09-05

### Added

- Stable Host + Client workbench flow for query, deterministic screening, bounded Agent analysis, explicit human review, and immutable Excel/PDF delivery.
- Session-scoped V2 Intent, Projection, Tool, Artifact, and runtime Skill contracts with strict validation and idempotent mutation receipts.
- Release gates for documentation/version consistency, stable-release metadata, full type/test/build verification, and an npm tarball file whitelist.
- Linux Node 22/24 and Windows Node 24 CI, plus tag-driven npm Trusted Publishing with provenance and GitHub Release creation.

### Changed

- Promoted the 0.3.0 beta line to the stable 0.4.0 distribution without changing its workflow or Artifact schema.
- Updated package repository, homepage, and issue metadata to `duhu2000/dsh-tender-workbench`.
- Stable installations now use the npm `latest` dist-tag; the previous `0.3.0-beta.1` remains available as an immutable rollback target.

### Security

- The npm package whitelist excludes source files, tests, scripts, fixtures, local evidence, caches, environment files, and credentials.
- Release automation uses GitHub OIDC Trusted Publishing and does not require a long-lived npm token in the repository.
- Runtime credentials remain owned by the authorized MCP connector; Session-private source data and generated Artifacts are not published.

[Unreleased]: https://github.com/duhu2000/dsh-tender-workbench/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.1
[0.4.0]: https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.0
