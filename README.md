# dsh-tender-workbench

`dsh-tender-workbench` is an open-source DeepSeek Harness tender Agent workbench. The current S1a implementation provides one Session-scoped Better Sidebar workbench, three official entry points, a four-phase progressive shell over seven internal Projection nodes, and directly sent user-visible typed query Intents.

The three entries are `sidebar.footer.action` (“招投标”), `conversation.input.left` (“搜索招投标”), and `conversation.session.header.actions` (reopen). They all focus the same `dsh-better-sidebar 0.17.1` single-instance Tab for the addressed Session. The workbench reads only that Session's Host Projection through a narrow `TenderProjectionPort`; it does not infer business state from chat text or maintain cross-Session state.

The S1a query surface captures a work goal, source scope (`tender`, `proposed`, or `combined`), and up to ten explicit keywords. Rich query fields already present in the repository remain pure mapping assets for S2 and are not exposed as a second drawer or alternate workflow.

The plugin does not modify DeepSeek Harness source, inspect or write the native composer DOM, fetch MCP from the Client, access connector storage, or hold credentials. Explicit workbench submission validates one `TenderQueryIntentV1`, serializes the same object into a user-visible message, and sends it through the public scoped `conversation.send()` service without touching the composer draft.

S1a does not yet implement the S2 query tools, Artifact storage, data overview/detail, rules, classification, review, or report delivery. The shell presents empty, waiting-for-Agent, running, failed, and capability-missing states without inventing those later results.

The confirmed S2 data boundary is deliberately narrow: schema-valid `qcc-tender` MCP fields are treated as source facts without Web or multi-source accuracy verification. Missing or unparseable fields retain their source text and are shown as disclosure/parse status, not as source errors. Each Session has one active query dataset; a successful new query replaces that active snapshot instead of appending or merging batches, while historical artifacts remain available for traceability and prior downstream results leave the active workflow.

## Documentation

- [Province, city, and district source snapshot](resources/area.ts)

## Compatibility

This checkout targets DeepSeek Harness `0.1.1-rc.2` and requires `dsh-better-sidebar 0.17.1`. The Better Sidebar version is exact because S1a relies on its validated `targetedOpen`, `stateSubscription`, public Tab store, and Session scope contracts.

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
- The input shortcut always selects the “Find opportunities” phase. Sidebar and Header entries reopen the same Session Tab without duplicating the workbench.
- When no Session is selected, the sidebar entry invokes the native New Session flow.
- The Better Sidebar registration, Projection subscription, Reveal attachment, and all three Slot entries dispose with the Client Context.
- Narrow layouts use a container-responsive four-phase navigation and keep the main action reachable below a scrollable content area.


