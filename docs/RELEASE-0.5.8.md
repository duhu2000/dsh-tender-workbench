# 0.5.8 — History and actual progress

Version: **0.5.8**
Status: **ready for release**

Profile-persistent read-only history, immutable origin Workspace/Session, explicit source navigation, terminal completion latch, actual Session-event telemetry, and strict Provider result distinctions. No historical projection is rebound to a new task. Excel/PDF remain the primary customer deliverables; human confirmation and immutable report snapshots remain intact.

Adopts DSH-UX-001 v1.5.3. The 0.5.6 snapshotEvents/turn-start authorization implementation is unchanged. See `HISTORY-PROGRESS-ADOPTION.md` for contracts, test evidence and limits.

Publication gate: complete local checks, isolated DSH checks, PR Linux Node 22/24 + Windows Node 24 + installable package, merged default-branch exact-SHA CI, annotated immutable tag, GitHub Actions OIDC/provenance and registry gitHead readback. Publication evidence is recorded after those actions, not inferred from this preparation record.

Limits: synthetic Provider only; no paid QCC/model end-to-end acceptance. History is a local Profile derivative index (single writer); older unopened Sessions and their earlier tasks are not globally scanned. Historical artifacts stay in original Session messages and retain existing download authorization. A corrupt/unavailable index is an explicit error, never fabricated empty history. Hot HMR and four-product combined compatibility require independent evidence and are not signed off by unit tests.
