import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ArtifactRefV1, TenderWorkflowProjectionV1 } from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import { createGenerateReportIntent, createRetryReportIntent } from '../intents/screening-intent.ts'
import type { SessionWriteFlight } from './session-write-flight.ts'
import { SessionWriteButtonLabel, SessionWriteProgress } from './SessionWriteProgress.tsx'
import css from './tender-workbench.module.css'

export type ReportArtifactDownloader = (sessionId: SessionId, artifact: ArtifactRefV1) => Promise<void>

interface TenderReportViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV1
  readonly write: SessionWriteFlight
  readonly download: ReportArtifactDownloader
  readonly t: TenderTranslate
}

function reportBinding(workflow: TenderWorkflowProjectionV1) {
  const active = workflow.query?.normalizedData
  if (active === undefined) throw new Error('missing active dataset')
  const review = workflow.review
  return {
    activeDatasetRef: active.id,
    ...(workflow.classification === undefined ? {} : {
      classificationArtifactRef: workflow.classification.data.id,
      ruleSetVersion: workflow.classification.ruleSetVersion,
    }),
    ...(workflow.analysis === undefined ? {} : { analysisVersion: workflow.analysis.version }),
    ...(review === undefined ? {} : { reviewArtifactRef: review.data.id }),
    reviewRevision: review?.revision ?? 0,
    projectionRevision: workflow.revision,
  }
}

function statusLabel(
  t: TenderTranslate,
  status: NonNullable<TenderWorkflowProjectionV1['report']>['excel']['status'],
): string {
  return t(`workbench.report.fileStatus.${status}`)
}

export function TenderReportView({ sessionId, workflow, write, download, t }: TenderReportViewProps) {
  const report = workflow.report
  const pending = workflow.review?.pending ?? workflow.query?.total ?? 0
  const reviewed = (workflow.review?.confirmedCandidate ?? 0) + (workflow.review?.watch ?? 0) + (workflow.review?.exclude ?? 0)
  const [confirmPending, setConfirmPending] = useState(false)
  const [includeNarrative, setIncludeNarrative] = useState(true)
  const [downloadError, setDownloadError] = useState<string>()
  const startCreate = (): void => {
    write.start('report.create', commandId => createGenerateReportIntent({
      commandId,
      ...reportBinding(workflow),
      confirmPending: pending === 0 || confirmPending,
      includeNarrative,
    }))
  }
  const retry = (format: 'excel' | 'pdf'): void => {
    if (report?.finalSnapshotId === undefined) return
    write.start('report.retry', commandId => createRetryReportIntent({
      commandId,
      projectionRevision: workflow.revision,
      finalSnapshotId: report.finalSnapshotId ?? '',
      formats: [format],
    }))
  }
  const downloadFile = (artifact: ArtifactRefV1): void => {
    setDownloadError(undefined)
    void download(sessionId, artifact).catch(() => { setDownloadError(t('workbench.report.downloadFailed')) })
  }
  const canCreate = !write.busy && (pending === 0 || confirmPending)
  return (
    <div className={css.reportWorkspace}>
      <header className={css.pageHeading}>
        <div>
          <p className={css.eyebrow}>{t('workbench.phase.workspace')}</p>
          <h2>{t('workbench.report.title')}</h2>
          <p>{t('workbench.report.description')}</p>
        </div>
        <span className={css.stageState} data-phase-status={report === undefined ? 'not-started' : report.excel.status === 'succeeded' && report.pdf.status === 'succeeded' ? 'completed' : 'progress'}>
          {report === undefined ? t('workbench.report.notGenerated') : report.completeness === 'complete' ? t('workbench.report.complete') : t('workbench.report.partial')}
        </span>
      </header>

      <section className={css.reportScope} aria-labelledby="report-scope-title">
        <div>
          <p className={css.eyebrow}>{t('workbench.report.scopeEyebrow')}</p>
          <h3 id="report-scope-title">{t('workbench.report.scopeTitle')}</h3>
        </div>
        <dl className={css.reportMetrics}>
          <div><dt>{t('workbench.report.reviewed')}</dt><dd>{reviewed}</dd></div>
          <div><dt>{t('workbench.review.confirmed')}</dt><dd>{workflow.review?.confirmedCandidate ?? 0}</dd></div>
          <div><dt>{t('workbench.review.watch')}</dt><dd>{workflow.review?.watch ?? 0}</dd></div>
          <div><dt>{t('workbench.review.exclude')}</dt><dd>{workflow.review?.exclude ?? 0}</dd></div>
          <div><dt>{t('workbench.review.pending')}</dt><dd>{pending}</dd></div>
          <div><dt>{t('workbench.report.agentCoverage')}</dt><dd>{workflow.analysis?.completed ?? 0}/{workflow.analysis?.total ?? workflow.query?.total ?? 0}</dd></div>
        </dl>
        <p className={css.reportBoundary}>{t('workbench.report.boundary')}</p>
      </section>

      {report === undefined ? (
        <section className={css.reportCreate} aria-labelledby="report-create-title">
          <h3 id="report-create-title">{pending === 0 ? t('workbench.report.createComplete') : t('workbench.report.createPartial')}</h3>
          <label className={css.checkRow}>
            <input type="checkbox" checked={includeNarrative} onChange={event => { setIncludeNarrative(event.target.checked) }} disabled={write.busy} />
            <span>{t('workbench.report.includeNarrative')}</span>
          </label>
          {pending > 0 && (
            <label className={css.checkRow}>
              <input type="checkbox" checked={confirmPending} onChange={event => { setConfirmPending(event.target.checked) }} disabled={write.busy} />
              <span>{t('workbench.report.confirmPending', { count: pending })}</span>
            </label>
          )}
          <button type="button" className={css.primary} disabled={!canCreate} onClick={startCreate} aria-busy={write.state.action === 'report.create' && write.busy}>
            <SessionWriteButtonLabel action="report.create" idle={t('workbench.report.generate')} t={t} write={write} />
          </button>
          <SessionWriteProgress t={t} write={write} />
        </section>
      ) : (
        <section className={css.reportDelivery} aria-labelledby="report-files-title">
          <div className={css.reportSnapshot}>
            <div><p className={css.eyebrow}>{t('workbench.report.snapshot')}</p><h3>{report.finalSnapshotId}</h3></div>
            <p>{t('workbench.report.snapshotSummary', { reviewed: report.reviewed ?? 0, pending: report.pending ?? 0, tender: report.confirmedTender ?? 0, proposed: report.priorityProposed ?? 0 })}<br />{t(report.narrativeIncluded === true ? 'workbench.report.narrativeIncluded' : 'workbench.report.narrativeAbsent')}</p>
          </div>
          <h3 id="report-files-title">{t('workbench.report.files')}</h3>
          <div className={css.reportFiles}>
            {(['excel', 'pdf'] as const).map((format) => {
              const state = report[format]
              return (
                <article key={format} className={css.reportFile} data-file-status={state.status}>
                  <div><strong>{format === 'excel' ? 'Excel' : 'PDF'}</strong><span>{statusLabel(t, state.status)}</span></div>
                  {state.errorMessage !== undefined && <p role="alert">{state.errorMessage}</p>}
                  {state.status === 'succeeded' && state.artifact !== undefined && (
                    <button type="button" className={css.secondary} disabled={write.busy} onClick={() => { downloadFile(state.artifact as ArtifactRefV1) }}>
                      {t('workbench.report.download', { format: format === 'excel' ? 'Excel' : 'PDF' })}
                    </button>
                  )}
                  {state.status === 'failed' && (
                    <button type="button" className={css.secondary} disabled={write.busy} onClick={() => { retry(format) }}>
                      <SessionWriteButtonLabel action="report.retry" idle={t('workbench.report.retry', { format: format === 'excel' ? 'Excel' : 'PDF' })} t={t} write={write} />
                    </button>
                  )}
                </article>
              )
            })}
          </div>
          {downloadError !== undefined && <p className={css.inlineError} role="alert">{downloadError}</p>}
          <SessionWriteProgress t={t} write={write} />
        </section>
      )}
    </div>
  )
}
