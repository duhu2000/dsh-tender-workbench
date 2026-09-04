import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AmountDistributionV2,
  MetricValueV1,
  ReportDeliveryRecordV1,
  ReportDeliveryViewV1,
  ReportDistributionV2,
  ReportNarrativeV1,
} from '../../contracts/reporting.ts'
import type { ArtifactRefV1, TenderWorkflowProjectionV2 } from '../../contracts/workflow.ts'
import type { TenderTranslate } from '../fields/field-props.ts'
import { createGenerateReportIntent, createRetryReportIntent } from '../intents/screening-intent.ts'
import type { SessionWriteFlight } from './session-write-flight.ts'
import { SessionWriteButtonLabel, SessionWriteProgress } from './SessionWriteProgress.tsx'
import { StatePanel, StatusPill } from './WorkbenchPrimitives.tsx'
import css from './tender-workbench.module.css'

export type ReportArtifactDownloader = (sessionId: SessionId, artifact: ArtifactRefV1) => Promise<void>
export type ReportDeliveryViewLoader = (
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  signal?: AbortSignal,
) => Promise<ReportDeliveryViewV1>

interface TenderReportViewProps {
  readonly sessionId: SessionId
  readonly workflow: TenderWorkflowProjectionV2
  readonly write: SessionWriteFlight
  readonly loadView: ReportDeliveryViewLoader
  readonly download: ReportArtifactDownloader
  readonly footerTarget: HTMLElement | null
  readonly t: TenderTranslate
}

const REPORT_TABS = ['summary', 'charts', 'opportunities', 'files', 'provenance'] as const
type ReportTab = typeof REPORT_TABS[number]

function ReportIcon({ name }: { readonly name: 'chart' | 'file' | 'info' | 'check' | 'download' }) {
  const paths: Record<typeof name, ReactNode> = {
    chart: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></>,
  }
  return <svg className={css.icon} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function reportBinding(workflow: TenderWorkflowProjectionV2) {
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

function metric(view: ReportDeliveryViewV1, id: string): MetricValueV1 {
  return view.metricValues.find(value => value.metricId === id) ?? { metricId: id, value: 0 }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)
}

function formatAmountAxisValue(value: number, unit: NonNullable<AmountDistributionV2['axis']>['unit']): string {
  const divisor = unit === 'hundred-million-yuan' ? 100_000_000 : unit === 'ten-thousand-yuan' ? 10_000 : 1
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value / divisor)
}

function amountAxisUnit(unit: NonNullable<AmountDistributionV2['axis']>['unit'], t: TenderTranslate): string {
  return t(unit === 'hundred-million-yuan'
    ? 'workbench.report.amount.unit.hundredMillionYuan'
    : unit === 'ten-thousand-yuan'
      ? 'workbench.report.amount.unit.tenThousandYuan'
      : 'workbench.report.amount.unit.yuan')
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date).replaceAll('/', '-')
}

function fileStatusLabel(t: TenderTranslate, status: NonNullable<TenderWorkflowProjectionV2['report']>['excel']['status']): string {
  return t(`workbench.report.fileStatus.${status}`)
}

function ReportFooter({ target, children }: { readonly target: HTMLElement | null, readonly children: ReactNode }) {
  return target === null ? null : createPortal(children, target)
}

function ReportHero({ workflow, t }: {
  readonly workflow: TenderWorkflowProjectionV2
  readonly t: TenderTranslate
}) {
  const report = workflow.report
  const pending = report?.pending ?? workflow.review?.pending ?? workflow.query?.total ?? 0
  const reviewed = report?.reviewed ?? ((workflow.review?.confirmedCandidate ?? 0) + (workflow.review?.watch ?? 0) + (workflow.review?.exclude ?? 0))
  const hasSourceCounts = report === undefined
    ? workflow.review?.confirmedTender !== undefined && workflow.review.priorityProposed !== undefined
    : report.confirmedTender !== undefined && report.priorityProposed !== undefined
  const confirmedTender = report?.confirmedTender ?? workflow.review?.confirmedTender ?? 0
  const priorityProposed = report?.priorityProposed ?? workflow.review?.priorityProposed ?? 0
  const included = hasSourceCounts ? confirmedTender + priorityProposed : workflow.review?.confirmedCandidate ?? 0
  const completeness = report?.completeness ?? (pending === 0 ? 'complete' : 'partial')
  const analysisCompleted = report?.analysisCompleted ?? workflow.analysis?.completed ?? 0
  const analysisTotal = report?.analysisTotal ?? workflow.analysis?.eligibleTotal ?? workflow.query?.total ?? 0
  const filesSucceeded = report === undefined ? 0 : Number(report.excel.status === 'succeeded') + Number(report.pdf.status === 'succeeded')
  const raw = report?.rawRecords ?? workflow.query?.sourceRecordCount ?? 0
  const normalized = report?.normalizedProjects ?? workflow.query?.total ?? 0
  return (
    <div className={css.deliveryHeroGrid}>
      <section className={css.deliveryLead}>
        <p className={css.eyebrow}>{t(completeness === 'complete' ? 'workbench.report.heroComplete' : 'workbench.report.heroPartial')}</p>
        <h2>{t(report === undefined ? 'workbench.report.preTitle' : 'workbench.report.deliveredTitle')}</h2>
        <p>{t(report === undefined ? 'workbench.report.preSummary' : 'workbench.report.deliveredSummary', {
          reviewed, pending, included, watch: report?.watch ?? workflow.review?.watch ?? 0, exclude: report?.exclude ?? workflow.review?.exclude ?? 0,
        })}</p>
        <div className={css.deliveryFacts}>
          <span>{t(report === undefined ? 'workbench.report.fact.currentScope' : 'workbench.report.fact.currentFiles')}</span>
          <span>{t(completeness === 'complete' ? 'workbench.report.complete' : 'workbench.report.partial')}</span>
          <span>{t('workbench.report.fact.analysis', { completed: analysisCompleted, total: analysisTotal })}</span>
          {report?.createdAt === undefined ? null : <span>{t('workbench.report.fact.generatedAt', { time: formatTimestamp(report.createdAt) })}</span>}
        </div>
      </section>
      <aside className={css.deliverySnapshot} aria-labelledby="delivery-snapshot-title">
        <header className={css.deliverySnapshotHeader}>
          <div><h3 id="delivery-snapshot-title">{t('workbench.report.snapshotTitle')}</h3><p>{t('workbench.report.snapshotDescription')}</p></div>
          <StatusPill tone={completeness === 'complete' ? 'success' : 'warning'}>{t(completeness === 'complete' ? 'workbench.report.complete' : 'workbench.report.partial')}</StatusPill>
        </header>
        <dl className={css.deliverySnapshotList}>
          <div><dt>{t('workbench.report.snapshot.range')}</dt><dd>{t('workbench.report.snapshot.rangeValue', { raw, normalized })}</dd></div>
          <div><dt>{t('workbench.report.snapshot.included')}</dt><dd>{t('workbench.report.count', { count: included })}</dd></div>
          <div><dt>{t('workbench.review.watch')}</dt><dd>{t('workbench.report.count', { count: report?.watch ?? workflow.review?.watch ?? 0 })}</dd></div>
          <div><dt>{t('workbench.review.exclude')}</dt><dd>{t('workbench.report.count', { count: report?.exclude ?? workflow.review?.exclude ?? 0 })}</dd></div>
          <div><dt>{t('workbench.review.pending')}</dt><dd>{t('workbench.report.count', { count: pending })}</dd></div>
          <div><dt>{t('workbench.report.snapshot.reviewed')}</dt><dd>{reviewed} / {normalized}</dd></div>
          {report === undefined ? null : <div><dt>{t('workbench.report.snapshot.files')}</dt><dd>{filesSucceeded} / 2</dd></div>}
        </dl>
      </aside>
    </div>
  )
}

function KpiCard({ label, value, detail }: { readonly label: string, readonly value: ReactNode, readonly detail: string }) {
  return <article className={css.reportKpi}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function DistributionCard({ distribution, t }: { readonly distribution: ReportDistributionV2, readonly t: TenderTranslate }) {
  const maximum = Math.max(1, ...distribution.buckets.map(bucket => bucket.count))
  return (
    <article className={css.reportChartCard}>
      <header><h3>{distribution.label}</h3><p>{distribution.scopeDescription}</p></header>
      <div className={css.horizontalBars}>
        {distribution.buckets.map(bucket => <div className={css.horizontalBarRow} key={bucket.id}>
          <span>{bucket.label}</span><div><i style={{ width: `${bucket.count / maximum * 100}%` }} /></div><strong>{bucket.count}</strong>
        </div>)}
      </div>
      {(distribution.missingCount ?? 0) > 0 && <p className={css.chartNote}>{t('workbench.report.chart.missing', { count: distribution.missingCount ?? 0 })}</p>}
      {distribution.limitation === undefined ? null : <p className={css.chartNote}>{distribution.limitation}</p>}
    </article>
  )
}

function AmountCard({ value, title, t }: { readonly value: AmountDistributionV2, readonly title: string, readonly t: TenderTranslate }) {
  const plottedBands = value.bands
    .map((band, index) => ({ ...band, segment: index }))
    .filter(band => band.count > 0)
  const plottedCount = plottedBands.reduce((sum, band) => sum + band.count, 0)
  const axis = value.axis
  const unit = axis === undefined ? '' : amountAxisUnit(axis.unit, t)
  const axisRange = axis === undefined ? '' : t('workbench.report.amount.axisRange', {
    minimum: formatAmountAxisValue(axis.minCny, axis.unit),
    maximum: formatAmountAxisValue(axis.maxCny, axis.unit),
    unit,
  })
  const bandLabels = axis?.ticksCny.slice(0, 3).map((tick, index) => t('workbench.report.amount.bandRange', {
    minimum: formatAmountAxisValue(tick, axis.unit),
    maximum: formatAmountAxisValue(axis.ticksCny[index + 1] ?? tick, axis.unit),
    unit,
  }))
  const median = value.medianCny === undefined
    ? undefined
    : axis === undefined
      ? `¥${formatNumber(value.medianCny)}`
      : `${formatAmountAxisValue(value.medianCny, axis.unit)} ${unit}`
  return (
    <article className={css.reportChartCard} data-amount-chart={value.source}>
      <header><h3>{title}</h3><p>{t('workbench.report.amount.coverage', { parsed: value.singleValueCount + value.bandedRangeCount, total: value.eligibleCount })}</p></header>
      {plottedCount === 0 || axis === undefined
        ? <div className={css.amountChartEmpty}><strong>{t('workbench.report.amount.emptyTitle')}</strong><span>{t('workbench.report.amount.emptyDescription')}</span></div>
        : <>
            <div className={css.amountAxis}><span>{axisRange}</span></div>
            <div className={css.stackedBar} role="img" aria-label={`${title}，${axisRange}`}>
              {plottedBands.map(band => <i key={band.id} data-segment={band.segment} style={{ flexGrow: band.count }}>{band.count}</i>)}
            </div>
            <div className={css.stackedLegend}>{value.bands.map((band, index) => <span key={band.id}><i data-segment={index} />{bandLabels?.[index] ?? band.label}</span>)}</div>
          </>}
      {median === undefined ? null : <p className={css.chartNote}>{t('workbench.report.amount.median', { amount: median })}</p>}
      {value.indeterminateCount === 0 ? null : <p className={css.chartNote}>{t('workbench.report.amount.indeterminate', { count: value.indeterminateCount })}</p>}
      {value.missingCount === 0 ? null : <p className={css.chartNote}>{t('workbench.report.amount.missing', { count: value.missingCount })}</p>}
      {value.unparseableCount === 0 ? null : <p className={css.chartNote}>{t('workbench.report.amount.unparseable', { count: value.unparseableCount })}</p>}
      <p className={css.chartNote}>{value.limitation}</p>
    </article>
  )
}

function FunnelChart({ view, t }: { readonly view: ReportDeliveryViewV1, readonly t: TenderTranslate }) {
  const values = [
    { label: t('workbench.report.kpi.raw'), value: metric(view, 'raw-records').value },
    { label: t('workbench.report.kpi.normalized'), value: metric(view, 'normalized-projects').value },
    { label: t('workbench.report.kpi.screened'), value: metric(view, 'screening-candidates').value },
    { label: t('workbench.report.kpi.included'), value: metric(view, 'confirmed-total').value },
  ]
  const maximum = Math.max(1, ...values.map(item => item.value))
  return <article className={css.reportChartCard}><header><h3>{t('workbench.report.chart.funnel')}</h3><p>{t('workbench.report.chart.funnelDescription')}</p></header><div className={css.columnChart}>{values.map((item, index) => <div key={item.label}><i data-segment={index} style={{ height: `${Math.max(6, item.value / maximum * 100)}%` }} /><span>{item.label} {item.value}</span></div>)}</div></article>
}

function narrativeItems(narrative: ReportNarrativeV1): ReportNarrativeV1['keyFindings'] {
  return [
    ...(narrative.executiveSummary === undefined ? [] : [narrative.executiveSummary]),
    ...narrative.keyFindings,
    ...narrative.priorityVerification,
  ].slice(0, 3)
}

function SummaryPane({ view, t }: { readonly view: ReportDeliveryViewV1, readonly t: TenderTranslate }) {
  const raw = metric(view, 'raw-records').value
  const normalized = metric(view, 'normalized-projects').value
  const reviewed = metric(view, 'reviewed-projects').value
  const confirmed = metric(view, 'confirmed-total').value
  const confirmedTender = metric(view, 'confirmed-tender').value
  const proposed = metric(view, 'priority-proposed').value
  const screening = metric(view, 'screening-candidates').value
  const reviewRate = metric(view, 'confirmed-rate-reviewed')
  const deadlineDistribution = view.distributions.find(item => item.id === 'tender-deadline-window')
  const withinSevenDays = deadlineDistribution?.buckets.find(bucket => bucket.id === 'within-7-days')?.count ?? 0
  const narrative = view.narrative === undefined ? [] : narrativeItems(view.narrative)
  return <div className={css.reportPaneContent}>
    <div className={css.reportKpis}>
      <KpiCard label={t('workbench.report.kpi.raw')} value={raw} detail={t('workbench.report.kpi.rawDetail')} />
      <KpiCard label={t('workbench.report.kpi.normalized')} value={normalized} detail={t('workbench.report.kpi.normalizedDetail')} />
      <KpiCard label={t('workbench.report.kpi.screened')} value={screening} detail={t('workbench.report.kpi.screenedDetail')} />
      <KpiCard label={t('workbench.report.kpi.included')} value={confirmed} detail={t('workbench.report.kpi.includedDetail', { reviewed })} />
      <KpiCard label={t('workbench.report.kpi.nearTerm')} value={withinSevenDays} detail={t('workbench.report.kpi.nearTermDetail')} />
      <KpiCard label={t('workbench.report.kpi.analysis')} value={`${view.analysisCoverage.completed}/${view.analysisCoverage.total}`} detail={t('workbench.report.kpi.analysisDetail')} />
    </div>
    <div className={css.reportExplanations}>
      <article><strong>{t('workbench.report.explain.rateTitle')}</strong><span>{t('workbench.report.explain.rate', { confirmed, reviewed, rate: formatPercent(reviewRate.value) })}</span></article>
      <article><strong>{t('workbench.report.explain.recordsTitle')}</strong><span>{t('workbench.report.explain.records', { raw, normalized })}</span></article>
      <article><strong>{t('workbench.report.explain.amountTitle')}</strong><span>{t('workbench.report.explain.amount')}</span></article>
    </div>
    <div className={css.reportInsights}>
      <article><span>01</span><h3>{t(confirmed === 0 ? 'workbench.report.insight.confirmedZero' : 'workbench.report.insight.confirmed')}</h3><p>{t('workbench.report.insight.confirmedText', { tender: confirmedTender, proposed })}</p><small>{t('workbench.report.insight.deterministic')}</small></article>
      <article><span>02</span><h3>{t('workbench.report.insight.nearTerm')}</h3><p>{t('workbench.report.insight.nearTermText', { count: withinSevenDays })}</p><small>{t('workbench.report.insight.deadline')}</small></article>
      <article><span>03</span><h3>{t('workbench.report.insight.proposed')}</h3><p>{t('workbench.report.insight.proposedText', { count: proposed })}</p><small>{t('workbench.report.insight.source')}</small></article>
    </div>
    {narrative.length === 0 ? null : <section className={css.reportNarrative}><header><h3>{t('workbench.report.narrativeTitle')}</h3><p>{t('workbench.report.narrativeDescription')}</p></header><div>{narrative.map((item, index) => <article key={`${item.title}-${index}`}><strong>{item.title}</strong><p>{item.statement}</p>{item.limitations.map(limit => <small key={limit}>{limit}</small>)}</article>)}</div></section>}
    <div className={css.reportChartGrid}>
      <FunnelChart view={view} t={t} />
      {deadlineDistribution === undefined || deadlineDistribution.buckets.every(bucket => bucket.count === 0) ? null : <DistributionCard distribution={deadlineDistribution} t={t} />}
    </div>
    <section className={css.reportLimitations}><header><h3>{t('workbench.report.boundariesTitle')}</h3><p>{t('workbench.report.boundariesDescription')}</p></header>{view.limitations.slice(0, 3).map((limitation, index) => <div key={limitation}><i>{index + 1}</i><span>{limitation}</span></div>)}</section>
  </div>
}

function ChartsPane({ view, t }: { readonly view: ReportDeliveryViewV1, readonly t: TenderTranslate }) {
  const distributionIds = [
    'confirmed-regions', 'screening-classifications', 'tender-procurement-methods',
    'tender-procurement-types', 'tender-industries', 'proposed-project-stages', 'proposed-approval-progress',
  ]
  const distributions = distributionIds
    .map(id => view.distributions.find(item => item.id === id))
    .filter((item): item is ReportDistributionV2 => item !== undefined && item.buckets.some(bucket => bucket.count > 0))
  const amounts = view.amountDistributions.filter(item => item.eligibleCount > 0)
  if (distributions.length === 0 && amounts.length === 0) return <StatePanel title={t('workbench.report.chart.emptyTitle')} description={t('workbench.report.chart.emptyDescription')} />
  return <div className={css.reportChartGrid}>
    {distributions.map(item => <DistributionCard key={item.id} distribution={item} t={t} />)}
    {amounts.map(item => <AmountCard key={item.source} value={item} title={t(item.source === 'tender' ? 'workbench.report.chart.tenderAmount' : 'workbench.report.chart.proposedAmount')} t={t} />)}
  </div>
}

function displayRecordDate(record: ReportDeliveryRecordV1, t: TenderTranslate): string {
  if (record.deadlineOrUpdatedAt === undefined) return t('workbench.report.value.undisclosed')
  return record.source === 'tender'
    ? t('workbench.report.record.deadline', { value: record.deadlineOrUpdatedAt })
    : t('workbench.report.record.updated', { value: record.deadlineOrUpdatedAt })
}

function OpportunitiesPane({ view, excel, downloadExcel, t }: {
  readonly view: ReportDeliveryViewV1
  readonly excel?: ArtifactRefV1
  readonly downloadExcel: () => void
  readonly t: TenderTranslate
}) {
  return <div className={css.reportOpportunities}>
    <header className={css.reportTableTitle}><div><h3>{t('workbench.report.opportunitiesTitle')}</h3><p>{t('workbench.report.opportunitiesDescription')}</p></div>{excel === undefined ? null : <button type="button" className={css.secondary} onClick={downloadExcel}><ReportIcon name="download" />{t('workbench.report.openExcel')}</button>}</header>
    {view.priorityRecords.length === 0 ? <StatePanel title={t('workbench.report.opportunitiesEmpty')} description={t('workbench.report.opportunitiesEmptyDescription')} /> : <div className={css.reportTableWrap}><table className={css.reportTable}><thead><tr><th>#</th><th>{t('workbench.report.column.project')}</th><th>{t('workbench.report.column.source')}</th><th>{t('workbench.report.column.region')}</th><th>{t('workbench.report.column.amount')}</th><th>{t('workbench.report.column.date')}</th><th>{t('workbench.report.column.recommendation')}</th><th>{t('workbench.report.column.note')}</th></tr></thead><tbody>{view.priorityRecords.map((record, index) => <tr key={record.recordRef}><td data-label="#">{String(index + 1).padStart(2, '0')}</td><td data-label={t('workbench.report.column.project')}><strong>{record.title}</strong><small>{record.counterparty ?? t('workbench.report.value.undisclosed')}</small></td><td data-label={t('workbench.report.column.source')}><StatusPill tone={record.source === 'tender' ? 'brand' : 'warning'}>{t(record.source === 'tender' ? 'workbench.report.source.tender' : 'workbench.report.source.proposed')}</StatusPill></td><td data-label={t('workbench.report.column.region')}>{record.region ?? t('workbench.report.value.undisclosed')}</td><td data-label={t('workbench.report.column.amount')}>{record.amountDisplay}</td><td data-label={t('workbench.report.column.date')}>{displayRecordDate(record, t)}{record.stage === undefined ? null : <small>{record.stage}</small>}</td><td data-label={t('workbench.report.column.recommendation')}>{record.recommendationSummary ?? t('workbench.report.value.unanalyzed')}</td><td data-label={t('workbench.report.column.note')}>{record.userNote ?? t('workbench.report.value.unnoted')}</td></tr>)}</tbody></table><footer><span>{t('workbench.report.opportunitiesCount', { count: view.priorityRecords.length })}</span><span>{t('workbench.report.asOf', { time: formatTimestamp(view.createdAt) })}</span></footer></div>}
  </div>
}

function FileCard({ format, state, retry, download, write, t }: {
  readonly format: 'excel' | 'pdf'
  readonly state: NonNullable<TenderWorkflowProjectionV2['report']>['excel']
  readonly retry: () => void
  readonly download: () => void
  readonly write: SessionWriteFlight
  readonly t: TenderTranslate
}) {
  const formatName = format === 'excel' ? 'Excel' : 'PDF'
  const outline = format === 'excel'
    ? [
        t('workbench.report.file.excelOverview'), t('workbench.report.file.excelResults'),
        t('workbench.report.file.excelCandidates'), t('workbench.report.file.excelReview'),
        t('workbench.report.file.excelAll'), t('workbench.report.file.excelTrace'),
      ]
    : [
        t('workbench.report.file.pdfConclusion'), t('workbench.report.file.pdfCandidates'),
        t('workbench.report.file.pdfStructure'), t('workbench.report.file.pdfDeadline'),
        t('workbench.report.file.pdfMethods'), t('workbench.report.file.pdfLimits'),
      ]
  return <article className={css.deliveryFileCard} data-file-status={state.status}><header><span className={css.deliveryFileIcon} data-format={format}><ReportIcon name="file" /></span><div><strong>{state.artifact?.fileName ?? formatName}</strong><small>{state.artifact === undefined ? t(format === 'excel' ? 'workbench.report.excelPurpose' : 'workbench.report.pdfPurpose') : formatTimestamp(state.artifact.createdAt)}</small></div><StatusPill tone={state.status === 'succeeded' ? 'success' : state.status === 'failed' ? 'danger' : state.status === 'running' ? 'brand' : 'neutral'}>{fileStatusLabel(t, state.status)}</StatusPill></header><div className={css.deliveryFileBody}><div className={css.fileOutline}>{outline.map(item => <span key={item}>{item}</span>)}</div>{state.errorMessage === undefined ? null : <p className={css.inlineError} role="alert">{state.errorMessage}</p>}<div className={css.deliveryFileActions}>{state.status === 'succeeded' && state.artifact !== undefined ? <button type="button" className={css.primary} disabled={write.busy} onClick={download}><ReportIcon name="download" />{t('workbench.report.download', { format: formatName })}</button> : null}{state.status === 'failed' ? <button type="button" className={css.primary} disabled={write.busy} onClick={retry}><SessionWriteButtonLabel action="report.retry" idle={t('workbench.report.retry', { format: formatName })} t={t} write={write} /></button> : null}</div></div></article>
}

function FilesPane({ workflow, retry, download, write, downloadError, t }: {
  readonly workflow: TenderWorkflowProjectionV2
  readonly retry: (format: 'excel' | 'pdf') => void
  readonly download: (artifact: ArtifactRefV1) => void
  readonly write: SessionWriteFlight
  readonly downloadError?: string
  readonly t: TenderTranslate
}) {
  const report = workflow.report
  if (report === undefined) return null
  return <div className={css.reportFilesPane}><div className={css.reportNotice}><ReportIcon name="info" /><p><strong>{t('workbench.report.filesIndependent')}</strong> {t('workbench.report.filesDescription')}</p></div><div className={css.deliveryFileGrid}><FileCard format="excel" state={report.excel} retry={() => { retry('excel') }} download={() => { if (report.excel.artifact !== undefined) download(report.excel.artifact) }} write={write} t={t} /><FileCard format="pdf" state={report.pdf} retry={() => { retry('pdf') }} download={() => { if (report.pdf.artifact !== undefined) download(report.pdf.artifact) }} write={write} t={t} /></div>{downloadError === undefined ? null : <p className={css.inlineError} role="alert">{downloadError}</p>}<SessionWriteProgress t={t} write={write} /></div>
}

function ProvenancePane({ view, workflow, t }: { readonly view: ReportDeliveryViewV1, readonly workflow: TenderWorkflowProjectionV2, readonly t: TenderTranslate }) {
  const sourceText = (source: 'tender' | 'proposed') => {
    const state = view.query.sources[source]
    if (state === undefined) return t('workbench.report.provenance.notRequested')
    return state.status === 'succeeded' ? t('workbench.report.provenance.loaded', { count: state.loaded }) : t('workbench.report.provenance.sourceFailed')
  }
  const reviewed = metric(view, 'reviewed-projects').value
  const total = metric(view, 'normalized-projects').value
  return <div className={css.reportProvenance}><article><strong>{t('workbench.report.provenance.query')}</strong><span>{view.query.targetSummary}</span></article><article><strong>{t('workbench.report.provenance.sources')}</strong><span>{t('workbench.report.source.tender')}: {sourceText('tender')} · {t('workbench.report.source.proposed')}: {sourceText('proposed')}</span></article><article><strong>{t('workbench.report.provenance.screening')}</strong><span>{t(view.rulesIncluded ? 'workbench.report.provenance.included' : 'workbench.report.provenance.notIncluded')}</span></article><article><strong>{t('workbench.report.provenance.analysis')}</strong><span>{t(view.analysisIncluded ? 'workbench.report.provenance.analysisIncluded' : 'workbench.report.provenance.analysisAbsent', { completed: view.analysisCoverage.completed, total: view.analysisCoverage.total })}</span></article><article><strong>{t('workbench.report.provenance.review')}</strong><span>{t('workbench.report.provenance.reviewValue', { reviewed, total })}</span></article><article><strong>{t('workbench.report.provenance.statistics')}</strong><span>{t('workbench.report.provenance.statisticsValue')}</span></article><article><strong>{t('workbench.report.provenance.files')}</strong><span>Excel {fileStatusLabel(t, workflow.report?.excel.status ?? 'not-started')} · PDF {fileStatusLabel(t, workflow.report?.pdf.status ?? 'not-started')}</span></article><article><strong>{t('workbench.report.provenance.boundary')}</strong><span>{t('workbench.report.provenance.boundaryValue')}</span></article><div className={css.reportNotice}><ReportIcon name="check" /><p>{t('workbench.report.endsHereDescription')}</p></div></div>
}

export function TenderReportView({ sessionId, workflow, write, loadView, download, footerTarget, t }: TenderReportViewProps) {
  const report = workflow.report
  const pending = workflow.review?.pending ?? workflow.query?.total ?? 0
  const [confirmPending, setConfirmPending] = useState(false)
  const [includeNarrative, setIncludeNarrative] = useState(false)
  const [downloadError, setDownloadError] = useState<string>()
  const [selectedTab, setSelectedTab] = useState<ReportTab>('summary')
  const [loadRevision, setLoadRevision] = useState(0)
  const [deliveryView, setDeliveryView] = useState<{ readonly status: 'idle' | 'loading' | 'failed' | 'ready'; readonly value?: ReportDeliveryViewV1 }>(() => ({ status: 'idle' }))
  const tabRefs = useRef<Partial<Record<ReportTab, HTMLButtonElement | null>>>({})
  const tabId = useId()

  useEffect(() => {
    setSelectedTab('summary')
    setConfirmPending(false)
    setDownloadError(undefined)
  }, [sessionId, report?.finalSnapshot?.id])

  useEffect(() => {
    const artifact = report?.finalSnapshot
    const expectedSnapshotId = report?.finalSnapshotId
    if (artifact === undefined) {
      setDeliveryView({ status: report === undefined ? 'idle' : 'failed' })
      return
    }
    const abort = new AbortController()
    setDeliveryView({ status: 'loading' })
    void loadView(sessionId, artifact, abort.signal).then(value => {
      if (abort.signal.aborted) return
      if (expectedSnapshotId !== undefined && value.finalSnapshotId !== expectedSnapshotId) throw new Error('mismatched final snapshot')
      setDeliveryView({ status: 'ready', value })
    }).catch(() => { if (!abort.signal.aborted) setDeliveryView({ status: 'failed' }) })
    return () => { abort.abort() }
  }, [sessionId, report?.finalSnapshot?.id, report?.finalSnapshotId, loadRevision, loadView])

  const startCreate = (): void => {
    write.start('report.create', intentId => createGenerateReportIntent({
      intentId,
      ...reportBinding(workflow),
      confirmPending,
      includeNarrative,
    }))
  }
  const retry = (format: 'excel' | 'pdf'): void => {
    if (report?.finalSnapshotId === undefined) return
    write.start('report.retry', intentId => createRetryReportIntent({ intentId, projectionRevision: workflow.revision, finalSnapshotId: report.finalSnapshotId ?? '', formats: [format] }))
  }
  const downloadFile = (artifact: ArtifactRefV1): void => {
    setDownloadError(undefined)
    void download(sessionId, artifact).catch(() => { setDownloadError(t('workbench.report.downloadFailed')) })
  }
  const selectTab = (tab: ReportTab, focus = false): void => {
    setSelectedTab(tab)
    if (focus) tabRefs.current[tab]?.focus()
  }
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: ReportTab): void => {
    const index = REPORT_TABS.indexOf(tab)
    let next: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % REPORT_TABS.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + REPORT_TABS.length) % REPORT_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = REPORT_TABS.length - 1
    if (next === undefined) return
    event.preventDefault()
    const target = REPORT_TABS[next]
    if (target !== undefined) selectTab(target, true)
  }
  const canCreate = !write.busy && (pending === 0 || confirmPending)

  if (report === undefined && workflow.review === undefined) return <div className={css.reportWorkspace}>
    <ReportHero workflow={workflow} t={t} />
    <StatePanel title={t('workbench.report.dependencyTitle')} description={t('workbench.report.dependencyDescription')} />
  </div>

  if (report === undefined) return <div className={css.reportWorkspace}>
    <ReportHero workflow={workflow} t={t} />
    <section className={css.reportOptions} aria-labelledby={`${tabId}-options-title`}>
      <header><h3 id={`${tabId}-options-title`}>{t(pending === 0 ? 'workbench.report.createComplete' : 'workbench.report.createPartial')}</h3><p>{t(pending === 0 ? 'workbench.report.completeDescription' : 'workbench.report.partialDescription', { count: pending })}</p></header>
      <label><input type="checkbox" checked={includeNarrative} onChange={event => { setIncludeNarrative(event.target.checked) }} disabled={write.busy} /><span><strong>{t('workbench.report.includeNarrativeTitle')}</strong><small>{t('workbench.report.includeNarrative')}</small></span></label>
      {pending > 0 && <label><input type="checkbox" checked={confirmPending} onChange={event => { setConfirmPending(event.target.checked) }} disabled={write.busy} /><span><strong>{t('workbench.report.partialConfirmTitle')}</strong><small>{t('workbench.report.confirmPending', { count: pending })}</small></span></label>}
      <StatePanel title={t('workbench.report.boundaryTitle')} description={t('workbench.report.boundary')} />
      <SessionWriteProgress t={t} write={write} />
    </section>
    <ReportFooter target={footerTarget}><div className={css.footerCopy}><span className={css.footerHint}>{t('workbench.report.generateHint')}</span>{pending > 0 && !confirmPending ? <span className={css.disabledReason}>{t('workbench.report.confirmPending', { count: pending })}</span> : null}</div><button type="button" className={css.primary} disabled={!canCreate} onClick={startCreate} aria-busy={write.state.action === 'report.create' && write.busy}><SessionWriteButtonLabel action="report.create" idle={t(pending === 0 ? 'workbench.report.generateComplete' : 'workbench.report.generatePartial')} t={t} write={write} /></button></ReportFooter>
  </div>

  const view = deliveryView.value
  const tabs = {
    summary: view === undefined ? null : <SummaryPane view={view} t={t} />,
    charts: view === undefined ? null : <ChartsPane view={view} t={t} />,
    opportunities: view === undefined ? null : <OpportunitiesPane view={view} excel={report.excel.artifact} downloadExcel={() => { if (report.excel.artifact !== undefined) downloadFile(report.excel.artifact) }} t={t} />,
    files: <FilesPane workflow={workflow} retry={retry} download={downloadFile} write={write} downloadError={downloadError} t={t} />,
    provenance: view === undefined ? null : <ProvenancePane view={view} workflow={workflow} t={t} />,
  } satisfies Record<ReportTab, ReactNode>
  return <div className={css.reportWorkspace}>
    <ReportHero workflow={workflow} t={t} />
    <nav className={css.reportTabs} role="tablist" aria-label={t('workbench.report.tabs')}>
      {REPORT_TABS.map(tab => <button key={tab} ref={node => { tabRefs.current[tab] = node }} id={`${tabId}-${tab}-tab`} type="button" role="tab" aria-selected={selectedTab === tab} aria-controls={`${tabId}-${tab}-panel`} tabIndex={selectedTab === tab ? 0 : -1} onClick={() => { selectTab(tab) }} onKeyDown={event => { onTabKeyDown(event, tab) }}>{t(`workbench.report.tab.${tab}`)}</button>)}
    </nav>
    {REPORT_TABS.map(tab => <section key={tab} className={css.reportTabPanel} id={`${tabId}-${tab}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}-tab`} tabIndex={0} hidden={selectedTab !== tab}>{selectedTab !== tab ? null : tab === 'files' ? tabs.files : deliveryView.status === 'loading' ? <StatePanel title={t('workbench.report.viewLoading')} description={t('workbench.report.viewLoadingDescription')} /> : deliveryView.status === 'failed' ? <StatePanel tone="danger" role="alert" title={t('workbench.report.viewFailed')} description={t('workbench.report.viewFailedDescription')} action={<button type="button" className={css.secondary} onClick={() => { setLoadRevision(value => value + 1) }}>{t('workbench.report.viewRetry')}</button>} /> : tabs[tab]}</section>)}
    <ReportFooter target={footerTarget}><div className={css.footerCopy}><span className={css.footerHint}>{t('workbench.report.footerDelivered')}</span></div><div className={css.footerActions}><button type="button" className={css.secondary} onClick={() => { selectTab('provenance', true) }}>{t('workbench.report.openProvenance')}</button><button type="button" className={css.primary} onClick={() => { selectTab('files', true) }}><ReportIcon name="check" />{t('workbench.report.openFiles')}</button></div></ReportFooter>
  </div>
}
