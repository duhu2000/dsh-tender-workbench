import type { Context } from '@deepseek-ai/cordis'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { createArtifactRouteHandler } from './host/artifacts/artifact-route.ts'
import { IntentReceiptCoordinator } from './host/artifacts/intent-receipts.ts'
import { registerArtifactRoute } from './host/artifacts/register-route.ts'
import type { SessionPersistenceLocator } from './host/artifacts/store.ts'
import { tenderWorkflowProjectionDefinition } from './host/projection.ts'
import { createTenderWorkbenchQueryTool } from './host/tools/query-tool.ts'
import {
  createTenderWorkbenchConfirmRulesTool,
  createTenderWorkbenchPreviewRulesTool,
} from './host/tools/rule-tools.ts'
import { createTenderWorkbenchRuleDraftingContextTool } from './host/tools/screening-context-tool.ts'
import { registerTenderWorkflowSkills } from './host/skills/index.ts'
import {
  createTenderWorkbenchAnalysisRecordContextTool,
  createTenderWorkbenchApplyReviewTool,
  createTenderWorkbenchCommitAnalysisBatchTool,
  createTenderWorkbenchPrepareAnalysisBatchTool,
  createTenderWorkbenchRevertReviewTool,
} from './host/tools/analysis-review-tools.ts'
import {
  createTenderWorkbenchCreateReportTool,
  createTenderWorkbenchReportNarrativeContextTool,
  createTenderWorkbenchRetryReportTool,
} from './host/tools/report-tools.ts'
import { createTenderWorkbenchWorkflowStateTool } from './host/tools/workflow-state-tool.ts'

/** Public Host services required by the S2/S3 workflow and Session-private Artifact seam. */
export const inject = ['sessionProjections', 'tools', 'sessionPersistence', 'webServer', 'sessions', 'skills']

function sessionPersistenceLocator(ctx: Context): SessionPersistenceLocator {
  const candidate: unknown = ctx.get('sessionPersistence')
  if (typeof candidate !== 'object' || candidate === null || !('locate' in candidate) || typeof candidate.locate !== 'function') {
    throw new Error('dsh-tender-workbench requires the public sessionPersistence.locate() service')
  }
  const service = candidate as { locate(header: SessionHeader): { readonly kind: string; readonly path: string } | undefined }
  return { locate: header => service.locate(header) }
}

/** Register the whole-Session Projection, high-level tools, and read-only Artifact route. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(tenderWorkflowProjectionDefinition)
  const persistence = sessionPersistenceLocator(ctx)
  const receipts = new IntentReceiptCoordinator()
  ctx.effect(() => ctx.tools.register(createTenderWorkbenchQueryTool({
    tools: ctx.tools,
    sessionProjections: ctx.sessionProjections,
    sessionPersistence: persistence,
    receipts,
  })), 'dsh-tender-workbench: query tool')
  const ruleDependencies = {
    sessionProjections: ctx.sessionProjections,
    sessionPersistence: persistence,
    receipts,
  }
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchPreviewRulesTool(ruleDependencies),
  ), 'dsh-tender-workbench: preview rules tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchConfirmRulesTool(ruleDependencies),
  ), 'dsh-tender-workbench: confirm rules tool')
  const analysisReviewDependencies = {
    sessionProjections: ctx.sessionProjections,
    sessionPersistence: persistence,
    receipts,
  }
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchPrepareAnalysisBatchTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: prepare analysis batch tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchCommitAnalysisBatchTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: commit analysis batch tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchApplyReviewTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: apply review tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchRevertReviewTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: revert review tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchCreateReportTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: create report tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchRetryReportTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: retry report tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchWorkflowStateTool({ sessionProjections: ctx.sessionProjections }),
  ), 'dsh-tender-workbench: workflow state tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchRuleDraftingContextTool({
      sessionProjections: ctx.sessionProjections,
      sessionPersistence: persistence,
    }),
  ), 'dsh-tender-workbench: rule drafting context tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchAnalysisRecordContextTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: analysis record context tool')
  ctx.effect(() => ctx.tools.register(
    createTenderWorkbenchReportNarrativeContextTool(analysisReviewDependencies),
  ), 'dsh-tender-workbench: report narrative context tool')
  ctx.effect(() => registerTenderWorkflowSkills(ctx.skills), 'dsh-tender-workbench: workflow skills')
  ctx.effect(() => registerArtifactRoute(
    ctx.webServer,
    createArtifactRouteHandler({ sessions: ctx.sessions, sessionPersistence: persistence }),
  ), 'dsh-tender-workbench: artifact route')
}
