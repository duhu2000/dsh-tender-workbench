# dsh-tender-workbench

`dsh-tender-workbench` is an open-source DeepSeek Harness tender Agent workbench. The current S1-S5.5 MVP provides one Session-scoped Better Sidebar workbench, a top-left “招投标” launcher, a four-phase launcher below the composer card, a Session Header recovery action, a progressive shell over seven internal Projection nodes, and a real query → optional analysis → human review → immutable Excel/PDF delivery chain.

The top-left launcher uses `sidebar.footer.action` as its lifecycle owner and portals an owned mount next to `sidebar.workspaces`; when Data Cleaning is present, it follows that plugin's top launcher. The composer launcher uses `conversation.input.dock` as its lifecycle owner and portals an owned row after the composer card, ordered after the Previsit mode bar. Its four buttons open “Find opportunities / Screen candidates / Human confirmation / Deliver” directly. `conversation.session.header.actions` remains the recovery action. Every entry focuses the same Better Sidebar single-instance Tab for the addressed Session. The workbench reads only that Session's Host Projection through a narrow `TenderProjectionPort`; it does not infer business state from chat text or maintain cross-Session state.

The single query workspace now captures the complete approved condition set: source scope, up to ten keywords, publication presets/prior year/custom dates, up to twenty province/city/district regions, the analysis goal, tender information type and conditional stages/amounts, procurement method/industry/type, and proposed-project stage/approval/investment. The visible execution plan, user message, Host validation, and exact qcc calls all come from the same `TenderQueryIntentV1`; hidden or inactive branches cannot leak stale values, and `smartSort` is not exposed as a user filter.

S5.1, S5.2, S5.4, and S5.5 implement the mandatory UI convergence surfaces before S6. “Find opportunities” uses the approved condition-editor/execution-plan layout plus aligned overview and list/detail data surfaces. “Screen candidates” uses criteria-list/editor, impact-first preview, five-category classification/trace, and evidence-bound full-run Agent-analysis work surfaces. “Human confirmation” uses separate pending/reviewed queues, the approved seven-column table and a fixed report handoff. “Deliver” uses the approved conclusion/snapshot lead section, five report tabs, independent file states, and fixed footer actions. Wide layouts preserve the prototype's master/detail grids; medium and narrow containers fold in the same information order. No simplified/advanced query split, legacy compatibility page, or parallel UI state machine remains.

S5.5, “人工定案与筛候选补充对齐” (Human confirmation and supplemental candidate-screening alignment), replaces the old classification, analysis, and review work surfaces. Both classification list surfaces use one server-side stable order before pagination: `初选` → `观察` → `人工复核` → `规则排除` → `未匹配`. One click analyzes every record classified as `include`, `observe`, or `manual-review`; `exclude` and `unmatched` are classification outcomes and never enter Agent analysis. The Host continues deterministic batches until complete, while interrupted runs expose and resume their remaining work instead of reporting partial success. Human review uses the approved progress/summary, seven-column queue, batch controls, record detail/audit, and fixed “按当前进度生成报告” action. Pending and reviewed records are separate queues; pending work defaults to server-side recommendation priority (`重点复核` → `建议关注` → `暂不建议` → unanalyzed), and a new review Artifact does not clear unaffected selections, filters, focus, or scroll position.

The MVP intentionally omits “让 Agent 调整草案”, rule import, rule copy, nested condition groups, and rule-version browsing/comparison. These omissions are not rendered as disabled or simulated controls. The prototype's focused-project question sends a real typed, record-bound interaction. Apart from the closed omission list, the affected phases must match the approved design in structure, styling, layout, icons, states, responsive behavior, and interaction.

The plugin does not modify DeepSeek Harness source, read or write the native composer input, fetch MCP from the Client, access connector storage, or hold credentials. Private DOM access is limited to locating the two host layout containers and creating/removing this plugin's own Portal mounts; it does not inspect another plugin's Store, React root, or business state. Explicit workbench submission validates one `TenderQueryIntentV1`, serializes the same object into a user-visible message, and sends it through the public scoped `conversation.send()` service without touching the composer draft.

S2 implements `tender_workbench_query`, the exact `mcp__qcc-tender__search_tenders` and `mcp__qcc-tender__search_proposed_projects` nested calls, source-specific runtime validation, deterministic normalization, conservative announcement linking, Session-private Artifact storage, the Host Projection result, data overview, and paged/filterable data details. Empty, waiting-for-Agent, running, partial, failed, completed, and capability-missing states are projected without parsing model text.

S3 implements the read-only `tender_workbench_get_screening_context` tool plus `tender_workbench_preview_rules` and `tender_workbench_confirm_rules`. Screening starts only after an explicit user action. Agent suggestions, local drafts, previews, confirmed immutable rule versions, and classified data remain distinct. The one-layer rule contract supports explicit source scope, `title`/`purchaser`/`all` field scope, OR keywords, exception terms, enabled state, numeric priority, stable array-order tie breaking, and the five classifications `include`, `observe`, `manual-review`, `exclude`, and `unmatched`. No industry rules are built in.

The drafting-context tool reads the current query specification and normalized dataset through the Session-private manifest and returns only deterministic statistics plus at most eight representative samples; it never re-queries qcc or changes Projection state. Agent proposals omit `draftFingerprint`, which the Host computes from the validated complete draft. Each visible proposal, adjustment, or preview Intent permits exactly one preview call and ends after that result.

Preview and confirmation both read the current `activeDatasetRef` from the Session-private manifest and use the same pure classifier. Preview binds the active Artifact, Projection revision, and Host-validated draft fingerprint without creating a formal version or changing active classification. Confirmation rejects stale inputs, creates an immutable rule-set Artifact, classifies the full active dataset, and projects only summary counts and Artifact references. Classified rows remain paged behind the same loopback/same-origin/header/token boundary and retain source → normalization → raw matches/exceptions → stable decision traceability.

S4 implements stable bounded `tender_workbench_analysis_next` batches, evidence-bound `tender_workbench_analysis_commit`, and independent `tender_workbench_apply_review` / `tender_workbench_revert_review` commands. S5.5 binds these tools to one Host-bound `all-eligible` run over `include + observe + manual-review`; `exclude + unmatched` remain unanalysed by design. Agent recommendations are optional and never become user decisions. Users can skip analysis and review rows individually or in an explicit batch, restore rows to `pending`, keep notes, and replay the latest-operation undo from Session-private review Artifacts.

S5 implements read-only `tender_workbench_get_report_context` plus `tender_workbench_generate_report`. S5.3 makes the delivery result-first: the PDF is a content-driven business report with a conclusion-led first page, two deterministic charts, and bounded verification records; chapters continue in the available space and start a new page only when needed. Normal business volumes are expected to produce roughly 4-6 pages, while small result sets may be shorter. Excel separates management results, source-specific execution lists, traceability, and data-quality definitions across fixed-purpose Sheets. The Host fixes all numeric facts, distributions, record selection, workbook structure, PDF sections, fonts, pagination, and visual layout. Agent narrative is optional, bounded, reference-validated against one `ReportContextV2` fingerprint, and stored once in the immutable `ReportDatasetV2` snapshot for both files. Without narrative, both deterministic files still generate.

The project has not shipped a prior report snapshot format, so S5.3 deliberately accepts only the current `ReportDatasetV2` contract. Failed-format retry reads the same immutable V2 snapshot, reruns only the requested failed renderer, and never re-queries, adapts an older Schema, or asks Agent to rewrite content.

S5.4 replaces the compact delivery screen with the approved prototype structure across pre-generation, generating, and delivered states. The delivered workspace uses a conclusion/snapshot lead section and five tabs for management summary, charts, confirmed opportunities, files, and current-version provenance. A bounded Host-derived `ReportDeliveryViewV1` exposes only deterministic facts from the same immutable V2 snapshot; the Client does not load all snapshot rows or recalculate report metrics. Amount charts use Host-selected, data-dependent units and three-interval axes; a scope with no stably banded amount shows an explicit empty state instead of zero-value color slivers. Embedded PDF preview, multi-version history/comparison, and regeneration of successful files remain outside the MVP and do not appear as disabled placeholders.

Every successful query replaces the Session's single active dataset snapshot atomically; it never appends or merges earlier batches. Historical Artifacts remain in the Session directory, while old rules, classification, analysis, review, and reports leave the active chain. The same `commandId` and canonical parameters replay the first result; a user-triggered rerun receives a new `commandId` even when its parameters are identical. A failed all-source rerun does not replace a previously active successful dataset.

The confirmed S2 data boundary is deliberately narrow: schema-valid `qcc-tender` MCP fields are treated as source facts without Web or multi-source accuracy verification. Missing or unparseable fields retain their source text and are shown as disclosure/parse status, not as source errors. Each Session has one active query dataset; a successful new query replaces that active snapshot instead of appending or merging batches, while historical artifacts remain available for traceability and prior downstream results leave the active workflow.

Internal data is located only through the public `sessionPersistence.locate(session.header)` seam and is stored beside the default JSONL Session transcript under `dsh-tender-workbench/v1/`; the transcript itself is never read or modified. The read-only rows/download API is loopback-only and requires same-origin browser provenance, the Session header, and an Artifact capability token. Tokens stay in request headers rather than URLs.

The MVP deliberately does not implement report preview/version centers, successful-file regeneration, subscriptions, CRM follow-up, enterprise profiles, Bid/No-Bid decisions, source-accuracy verification, or dark theme. Query, classification, analysis, and review may each be a valid stopping point; no later action runs without explicit user input.

## Documentation

- [Province, city, and district source snapshot](resources/area.ts)

## Compatibility

The published plugin does not pin DeepSeek Harness, MCP Connector, or Better Sidebar to exact deployment versions. Its peer metadata declares minimums with no stable-version upper bound: DSH public packages from `0.1.1-rc.2`, MCP Connector from `0.2.31`, and Better Sidebar from `0.17.1`. The active Profile still supplies one coherent runtime. Runtime compatibility remains capability-based: Better Sidebar must expose the public `targetedOpen` and `stateSubscription` features, while the Host must provide the public Session Projection, JSONL Session Persistence, Tools, Skill, Sessions, and WebServer services used by the workflow. Development and release verification currently use DSH `0.1.1-rc.2` with Better Sidebar `0.17.1` as a reproducible reference combination, not as an exact installation restriction.

S2-S5 additionally require the standard JSONL Session Persistence service and an installed, authorized `qcc-tender` MCP connection exposing the exact tools `mcp__qcc-tender__search_tenders` and `mcp__qcc-tender__search_proposed_projects`. Missing capabilities, missing tools, or non-JSONL persistence fail explicitly; there is no Web-search, Workspace-storage, or alternate-persistence fallback.

`peerDependencies` let package managers diagnose versions below those minimums, but the current `dsh plugin` command delegates to pnpm, whose Profile defaults report peer conflicts as warnings instead of guaranteed installation failures. DSH currently has no Bundle-manifest prerequisite field. Consequently this package cannot promise a hard pre-install rejection on every DSH version; missing Host services still keep the Host plugin from activating, and missing Better Sidebar features fail Client activation before a business command is sent.

## Build and test

From this directory:

```sh
pnpm install --ignore-workspace
pnpm run typecheck
pnpm run test
pnpm run build
```

The build emits the Host loader entry at `lib/index.js`, the DSH Client factory bundle at `lib/client.js`, and declarations under `lib/types/`.

## Install into the Web profile

### Install the internal preview from npm

The current release is an internal preview published under the `beta` dist-tag. Install it explicitly through `@beta` so the preview channel remains clear even when npm also resolves the first published version through `latest`:

```sh
dsh plugin --profile web add 'dsh-mcp-connector@>=0.2.31'
dsh plugin --profile web add 'dsh-better-sidebar@>=0.17.1'
dsh plugin --profile web add dsh-tender-workbench@beta
dsh web --no-open
```

To install an exact version:

```sh
dsh plugin --profile web add 'dsh-mcp-connector@>=0.2.31'
dsh plugin --profile web add 'dsh-better-sidebar@>=0.17.1'
dsh plugin --profile web add dsh-tender-workbench@0.2.1-beta.3
```

After a stable version is published to `latest`, users will be able to install it without an explicit tag:

```sh
dsh plugin --profile web add 'dsh-mcp-connector@>=0.2.31'
dsh plugin --profile web add 'dsh-better-sidebar@>=0.17.1'
dsh plugin --profile web add dsh-tender-workbench
```

### Install from an independent source checkout

Install and mount MCP Connector and Better Sidebar first. Then build this repository and run the following command from the plugin root when the public `dsh` CLI is available:

```sh
dsh plugin --profile web add 'dsh-mcp-connector@>=0.2.31'
dsh plugin --profile web add 'dsh-better-sidebar@>=0.17.1'
dsh plugin --profile web add .
dsh web --no-open
```

If `dsh` is only available through a separate DeepSeek Harness source checkout, pass this plugin's absolute path instead of assuming that it is nested inside the Harness repository:

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add 'dsh-mcp-connector@>=0.2.31'
pnpm dsh plugin --profile web add 'dsh-better-sidebar@>=0.17.1'
pnpm dsh plugin --profile web add /absolute/path/to/dsh-tender-workbench
pnpm dsh web --no-open
```

### Install from a tarball

```sh
dsh plugin --profile web add 'dsh-mcp-connector@>=0.2.31'
dsh plugin --profile web add 'dsh-better-sidebar@>=0.17.1'
dsh plugin --profile web add ./dsh-tender-workbench-0.2.1-beta.3.tgz
dsh web --no-open
```

Restart the Web profile after adding or removing the bundle. The plugin package's `dsh.bundle.patch` declaration activates `cordis.patch.yml`, whose only contribution is the `dsh-tender-workbench` Loader row.

To remove it:

```sh
dsh plugin --profile web remove dsh-tender-workbench
```

## Runtime behavior

- The front-end phases are “Find opportunities / Screen candidates / Human confirmation / Deliver”. The internal `query`, `overview`, `rules`, `classification`, `analysis`, `review`, and `report` nodes remain independent Projection facts rather than a strict seven-step wizard.
- Navigation changes only the local view. It never advances `currentStage`, assumes a contiguous completion prefix, or disables later phases by ordinal position.
- A completed query is a normal lightweight outcome. The UI does not display “2/7 incomplete”; it offers progressive next steps without selecting a lightweight/full mode in advance.
- Query completion never creates a rule draft or starts classification. “Continue screening” sends a visible `rules.propose` Intent only after the user clicks it.
- Query, rules, analysis, review, report creation, and failed-format retry share one Session-scoped write flight. Rapid clicks, Enter repeats, and click/submit races create one command and remain locked through send, Agent wait, and matching tool execution; a transport retry reuses the same `commandId`.
- Initial Agent criteria open directly as the current Session's editable working draft; there is no suggestion-application gate, and loading the working copy never confirms rules or classifies data. Local add/edit/enable/delete operations never change persisted business state; changing the draft expires its Dry Run result, which must be refreshed before confirmation.
- The screening view always exposes the three approved tabs: criteria, classification results, and Agent analysis. It follows the approved primary path “confirm criteria and start classification → ask Agent to analyze all eligible candidates → enter human review”; locked tabs are visibly present but unavailable until their real dependencies exist.
- The criteria page uses the approved list/editor workspace. “Save draft and run Dry Run” refreshes the inline four-item impact strip and the representative-sample/global-conflict columns; there is no separate “deterministic impact preview” surface. The workbench footer owns “confirm criteria and start classification”.
- Confirmed classification exposes mutually exclusive totals, source/rule/conflict/disclosure filters, and per-record traceability. Analysis recommendations and user decisions remain separate row fields.
- The S5.5 classification overview and detail retain the prototype's five cards, funnel/audit composition, sampling columns, six detail tabs, list/trace geometry, icons, and responsive collapse. Unfiltered classification rows are stably ordered `include`, `observe`, `manual-review`, `exclude`, `unmatched` before pagination. The Agent-analysis queue has no record checkboxes or partial-analysis actions; its only run scope is all `include + observe + manual-review` records, with real `completed / eligibleTotal` progress until full coverage.
- S5.1, S5.2, S5.4, and S5.5 “Human confirmation and supplemental candidate-screening alignment” are mandatory design-convergence gates before S6. Their regression contracts keep the checked-in HTML UX information architecture, responsive grids, focus behavior, exact data mapping, full-run analysis, stable review workflow, and closed MVP omission list from drifting back to legacy or placeholder UI.
- Batch review inputs and the focused-record editor keep separate local state. Selecting a record initializes its saved decision and note, so a batch choice or a previously focused record cannot leak into an individual review command.
- Report creation shows the current reviewed/pending scope and requires explicit confirmation for a partial report. Excel and PDF download independently through same-origin Session/token headers; temporary Blob URLs are revoked after use.
- The composer launcher exposes the four existing business phases as direct shortcuts. The top-left and Header entries reopen the same Session Tab without duplicating the workbench.
- When no Session is selected, the sidebar entry invokes the native New Session flow.
- The Better Sidebar registration, Projection subscription, Reveal attachment, all three Slot registrations, the placement observer, and all owned Portal mounts dispose with the Client Context or component lifecycle.
- Narrow layouts use a container-responsive four-phase navigation and keep the main action reachable below a scrollable content area.
