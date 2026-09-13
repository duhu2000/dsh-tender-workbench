# 0.5.8 — History and actual progress

Version: **0.5.8**
Status: **ready for release**

Profile-persistent read-only history, immutable origin Workspace/Session, explicit source navigation, terminal completion latch, actual Session-event telemetry, and strict Provider result distinctions. No historical projection is rebound to a new task. Excel/PDF remain the primary customer deliverables; human confirmation and immutable report snapshots remain intact.

Adopts DSH-UX-001 v1.5.3. The 0.5.6 snapshotEvents/turn-start authorization implementation is unchanged. See `HISTORY-PROGRESS-ADOPTION.md` for contracts, test evidence and limits.

Publication gate: complete local checks, isolated DSH checks, PR Linux Node 22/24 + Windows Node 24 + installable package, merged default-branch exact-SHA CI, annotated immutable tag, GitHub Actions OIDC/provenance and registry gitHead readback. Publication evidence is recorded after those actions, not inferred from this preparation record.

Verified locally: 267 tests passed (one Windows-only skip on macOS), eight Chromium UI cases, isolated DSH 0.1.2-rc.1 with Sidebar 0.18.1 / absent, actual persisted progress and restart history, and Excel/PDF artifacts. Four-product public-entry switching, return to tender, explicit origin-history navigation and restart passed with cleaning 0.9.7 / previsit 0.1.22 / form-fill 0.2.28. An earlier form-fill entry test was a button-vs-link locator false negative, not a product defect.

Limits: synthetic Provider only; no paid QCC/model end-to-end acceptance. History is a local Profile derivative index (single writer); older unopened Sessions and their earlier tasks are not globally scanned. Historical artifacts stay in original Session messages and retain existing download authorization. A corrupt/unavailable index is an explicit error, never fabricated empty history. Hot HMR and the other products' full business flows remain independently unverified; entry checks are not full combined-business acceptance.
