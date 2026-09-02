# dsh-tender-workbench

`dsh-tender-workbench` is an open-source DeepSeek Harness tender Agent workbench. The current S3 implementation provides one Session-scoped Better Sidebar workbench, three official entry points, a four-phase progressive shell over seven internal Projection nodes, directly sent user-visible typed Intents, the S2 real query/Artifact/data-detail slice, and an S3 initial-screening/classification vertical slice.

The three entries are `sidebar.footer.action` (“招投标”), `conversation.input.left` (“搜索招投标”), and `conversation.session.header.actions` (reopen). They all focus the same `dsh-better-sidebar 0.17.1` single-instance Tab for the addressed Session. The workbench reads only that Session's Host Projection through a narrow `TenderProjectionPort`; it does not infer business state from chat text or maintain cross-Session state.

The current workbench query surface captures a work goal, source scope (`tender`, `proposed`, or `combined`), and up to ten explicit keywords. The high-level Host tool validates the complete `TenderQueryIntentV1` branches, deterministically derives the exact qcc calls, and never accepts a second Agent-authored MCP parameter set. Rich query fields already present in the repository remain reusable mapping assets rather than a second drawer or alternate workflow.

The plugin does not modify DeepSeek Harness source, inspect or write the native composer DOM, fetch MCP from the Client, access connector storage, or hold credentials. Explicit workbench submission validates one `TenderQueryIntentV1`, serializes the same object into a user-visible message, and sends it through the public scoped `conversation.send()` service without touching the composer draft.

S2 implements `tender_workbench_query`, the exact `mcp__qcc-tender__search_tenders` and `mcp__qcc-tender__search_proposed_projects` nested calls, source-specific runtime validation, deterministic normalization, conservative announcement linking, Session-private Artifact storage, the Host Projection result, data overview, and paged/filterable data details. Empty, waiting-for-Agent, running, partial, failed, completed, and capability-missing states are projected without parsing model text.

S3 implements the read-only `tender_workbench_get_screening_context` tool plus `tender_workbench_preview_rules` and `tender_workbench_confirm_rules`. Screening starts only after an explicit user action. Agent suggestions, local drafts, previews, confirmed immutable rule versions, and classified data remain distinct. The one-layer rule contract supports explicit source scope, `title`/`purchaser`/`all` field scope, OR keywords, exception terms, enabled state, numeric priority, stable array-order tie breaking, and the five classifications `include`, `observe`, `manual-review`, `exclude`, and `unmatched`. No industry rules are built in.

The drafting-context tool reads the current query specification and normalized dataset through the Session-private manifest and returns only deterministic statistics plus at most eight representative samples; it never re-queries qcc or changes Projection state. Agent proposals omit `draftFingerprint`, which the Host computes from the validated complete draft. Each visible proposal, adjustment, or preview Intent permits exactly one preview call and ends after that result.

Preview and confirmation both read the current `activeDatasetRef` from the Session-private manifest and use the same pure classifier. Preview binds the active Artifact, Projection revision, and Host-validated draft fingerprint without creating a formal version or changing active classification. Confirmation rejects stale inputs, creates an immutable rule-set Artifact, classifies the full active dataset, and projects only summary counts and Artifact references. Classified rows remain paged behind the same loopback/same-origin/header/token boundary and retain source → normalization → raw matches/exceptions → stable decision traceability.

Every successful query replaces the Session's single active dataset snapshot atomically; it never appends or merges earlier batches. Historical Artifacts remain in the Session directory, while old rules, classification, analysis, review, and reports leave the active chain. The same `commandId` and canonical parameters replay the first result; a user-triggered rerun receives a new `commandId` even when its parameters are identical. A failed all-source rerun does not replace a previously active successful dataset.

The confirmed S2 data boundary is deliberately narrow: schema-valid `qcc-tender` MCP fields are treated as source facts without Web or multi-source accuracy verification. Missing or unparseable fields retain their source text and are shown as disclosure/parse status, not as source errors. Each Session has one active query dataset; a successful new query replaces that active snapshot instead of appending or merging batches, while historical artifacts remain available for traceability and prior downstream results leave the active workflow.

Internal data is located only through the public `sessionPersistence.locate(session.header)` seam and is stored beside the default JSONL Session transcript under `dsh-tender-workbench/v1/`; the transcript itself is never read or modified. The read-only rows/download API is loopback-only and requires same-origin browser provenance, the Session header, and an Artifact capability token. Tokens stay in request headers rather than URLs.

S3 deliberately does not implement Agent candidate recommendations, user decisions, human review, Excel/PDF generation, report preview/versioning, subscriptions, CRM follow-up, enterprise profiles, multi-batch merging, or source-accuracy verification. Query completion remains a valid lightweight endpoint; classification completion only identifies S4 as a future next stage and never fabricates its results.

## Documentation

- [Province, city, and district source snapshot](resources/area.ts)

## Compatibility

This checkout targets DeepSeek Harness `0.1.1-rc.2` and requires `dsh-better-sidebar 0.17.1`. The Better Sidebar version is exact because S1a relies on its validated `targetedOpen`, `stateSubscription`, public Tab store, and Session scope contracts.

S2/S3 additionally require the standard JSONL Session Persistence service and an installed, authorized `qcc-tender` MCP connection exposing the exact tools `mcp__qcc-tender__search_tenders` and `mcp__qcc-tender__search_proposed_projects`. Missing tools or non-JSONL persistence fail explicitly; there is no Web-search, Workspace-storage, or alternate-persistence fallback.

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
dsh plugin --profile web add dsh-better-sidebar@0.17.1
dsh plugin --profile web add dsh-tender-workbench@beta
dsh web --no-open
```

To install an exact version:

```sh
dsh plugin --profile web add dsh-better-sidebar@0.17.1
dsh plugin --profile web add dsh-tender-workbench@0.2.1-beta.0
```

After a stable version is published to `latest`, users will be able to install it without an explicit tag:

```sh
dsh plugin --profile web add dsh-better-sidebar@0.17.1
dsh plugin --profile web add dsh-tender-workbench
```

### Install from an independent source checkout

Install and mount Better Sidebar first. Then build this repository and run the following command from the plugin root when the public `dsh` CLI is available:

```sh
dsh plugin --profile web add dsh-better-sidebar@0.17.1
dsh plugin --profile web add .
dsh web --no-open
```

If `dsh` is only available through a separate DeepSeek Harness source checkout, pass this plugin's absolute path instead of assuming that it is nested inside the Harness repository:

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/to/dsh-tender-workbench
pnpm dsh web --no-open
```

### Install from a tarball

```sh
dsh plugin --profile web add ./dsh-tender-workbench-0.2.1-beta.0.tgz
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
- Query, rule proposal, Agent adjustment, impact preview, and confirmation share one Session-scoped write flight. Rapid clicks, Enter repeats, and click/submit races create one command and remain locked through send, Agent wait, and matching tool execution; a transport retry reuses the same `commandId`.
- Agent rule changes must be explicitly applied to the local draft. Local editing never changes persisted business state; an unexpired deterministic preview is required before confirmation.
- The screening view uses a criteria-list/editor workspace, keeps identifiers and revisions in collapsed technical details, emphasizes one primary action for the current state, and presents preview conclusions and conflicts before a bounded sample set.
- Confirmed classification exposes mutually exclusive totals, source/rule/conflict/disclosure filters, and per-record traceability. Agent recommendations and user decisions are absent until S4.
- The input shortcut always selects the “Find opportunities” phase. Sidebar and Header entries reopen the same Session Tab without duplicating the workbench.
- When no Session is selected, the sidebar entry invokes the native New Session flow.
- The Better Sidebar registration, Projection subscription, Reveal attachment, and all three Slot entries dispose with the Client Context.
- Narrow layouts use a container-responsive four-phase navigation and keep the main action reachable below a scrollable content area.
