import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ArtifactRefV1, TenderWorkflowProjectionV1 } from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import { createGenerateReportIntent, createRetryReportIntent } from '../intents/screening-intent.ts'
import type { SessionWriteFlight } from './session-write-flight.ts'
import { SessionWriteButtonLabel, SessionWriteProgress } from './SessionWriteProgress.tsx'
import { MetricCard, PageHeader, StatePanel, StatusPill, SurfaceHeader } from './WorkbenchPrimitives.tsx'
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
  const bothSucceeded = report?.excel.status === 'succeeded' && report.pdf.status === 'succeeded'
  const partialFiles = report !== undefined && report.excel.status !== report.pdf.status
  return (
    <div className={css.reportWorkspace}>
      <PageHeader
        eyebrow={t('workbench.report.eyebrow')}
        title={report === undefined ? t('workbench.report.title') : bothSucceeded ? t('workbench.report.deliveredTitle') : t('workbench.report.deliveryRunningTitle')}
        description={report === undefined ? t('workbench.report.description') : t('workbench.report.deliveredDescription')}
        aside={<StatusPill tone={bothSucceeded ? 'success' : partialFiles ? 'warning' : 'neutral'}>{report === undefined ? t('workbench.report.notGenerated') : report.completeness === 'complete' ? t('workbench.report.complete') : t('workbench.report.partial')}</StatusPill>}
      />

      <section className={css.reportScope} aria-labelledby="report-scope-title">
        <SurfaceHeader title={<span id="report-scope-title">{t('workbench.report.scopeTitle')}</span>} description={t('workbench.report.scopeDescription')} />
        <div className={css.reportMetrics}>
          <MetricCard label={t('workbench.report.reviewed')} value={reviewed} detail={t('workbench.review.progress', { reviewed, total: workflow.query?.total ?? reviewed + pending })} />
          <MetricCard label={t('workbench.review.confirmed')} value={workflow.review?.confirmedCandidate ?? 0} tone="success" />
          <MetricCard label={t('workbench.review.watch')} value={workflow.review?.watch ?? 0} tone="warning" />
          <MetricCard label={t('workbench.review.exclude')} value={workflow.review?.exclude ?? 0} />
          <MetricCard label={t('workbench.review.pending')} value={pending} tone={pending > 0 ? 'purple' : 'neutral'} />
          <MetricCard label={t('workbench.report.agentCoverage')} value={`${workflow.analysis?.completed ?? 0}/${workflow.analysis?.total ?? workflow.query?.total ?? 0}`} />
        </div>
        <StatePanel tone="neutral" title={t('workbench.report.boundaryTitle')} description={t('workbench.report.boundary')} />
      </section>

      {report === undefined ? (
        <section className={css.reportCreate} aria-labelledby="report-create-title">
          <SurfaceHeader title={<span id="report-create-title">{pending === 0 ? t('workbench.report.createComplete') : t('workbench.report.createPartial')}</span>} description={pending === 0 ? t('workbench.report.completeDescription') : t('workbench.report.partialDescription', { count: pending })} />
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
          <div className={css.reportPrimaryAction}>
            <span>{t('workbench.report.generateHint')}</span>
            <button type="button" className={css.primary} disabled={!canCreate} onClick={startCreate} aria-busy={write.state.action === 'report.create' && write.busy}>
              <SessionWriteButtonLabel action="report.create" idle={t('workbench.report.generate')} t={t} write={write} />
            </button>
          </div>
          <SessionWriteProgress t={t} write={write} />
        </section>
      ) : (
        <section className={css.reportDelivery} aria-labelledby="report-files-title">
          <section className={css.reportHero}>
            <div><p className={css.eyebrow}>{report.completeness === 'complete' ? t('workbench.report.complete') : t('workbench.report.partial')}</p><h3>{bothSucceeded ? t('workbench.report.deliveredHero') : t('workbench.report.processingHero')}</h3><p>{t('workbench.report.snapshotSummary', { reviewed: report.reviewed ?? 0, pending: report.pending ?? 0, tender: report.confirmedTender ?? 0, proposed: report.priorityProposed ?? 0 })}</p></div>
            <dl><div><dt>{t('workbench.report.filesSucceeded')}</dt><dd>{Number(report.excel.status === 'succeeded') + Number(report.pdf.status === 'succeeded')} / 2</dd></div><div><dt>{t('workbench.report.narrative')}</dt><dd>{t(report.narrativeIncluded === true ? 'workbench.report.narrativeIncludedShort' : 'workbench.report.narrativeAbsentShort')}</dd></div></dl>
          </section>
          <SurfaceHeader title={<span id="report-files-title">{t('workbench.report.files')}</span>} description={t('workbench.report.filesDescription')} />
          <div className={css.reportFiles}>
            {(['excel', 'pdf'] as const).map((format) => {
              const state = report[format]
              return (
                <article key={format} className={css.reportFile} data-file-status={state.status}>
                  <div className={css.reportFileHeader}><span className={css.fileIcon} data-format={format}>{format === 'excel' ? 'X' : 'P'}</span><div><strong>{state.artifact?.fileName ?? (format === 'excel' ? 'Excel' : 'PDF')}</strong><small>{format === 'excel' ? t('workbench.report.excelPurpose') : t('workbench.report.pdfPurpose')}</small></div><StatusPill tone={state.status === 'succeeded' ? 'success' : state.status === 'failed' ? 'danger' : state.status === 'running' ? 'brand' : 'neutral'}>{statusLabel(t, state.status)}</StatusPill></div>
                  {state.errorMessage !== undefined && <p role="alert">{state.errorMessage}</p>}
                  <div className={css.reportFileAction}>{state.status === 'succeeded' && state.artifact !== undefined && (
                    <button type="button" className={css.primary} disabled={write.busy} onClick={() => { downloadFile(state.artifact as ArtifactRefV1) }}>
                      {t('workbench.report.download', { format: format === 'excel' ? 'Excel' : 'PDF' })}
                    </button>
                  )}
                  {state.status === 'failed' && (
                    <button type="button" className={css.primary} disabled={write.busy} onClick={() => { retry(format) }}>
                      <SessionWriteButtonLabel action="report.retry" idle={t('workbench.report.retry', { format: format === 'excel' ? 'Excel' : 'PDF' })} t={t} write={write} />
                    </button>
                  )}</div>
                </article>
              )
            })}
          </div>
          {downloadError !== undefined && <p className={css.inlineError} role="alert">{downloadError}</p>}
          <SessionWriteProgress t={t} write={write} />
          <StatePanel tone="success" title={t('workbench.report.endsHere')} description={t('workbench.report.endsHereDescription')} />
        </section>
      )}
    </div>
  )
}
