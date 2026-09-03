import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import PDFDocument from 'pdfkit'
import type { ReportDatasetV2, ReportDistributionV2, ReportObservationV1 } from '../../contracts/reporting.ts'
import type { ReviewRecordV1 } from '../../contracts/analysis-review.ts'
import type { RenderedReportFile } from './excel.ts'
import {
  deadlineWindowLabel,
  deadlineWindowOf,
  distributionOf,
  formatReportDateTime,
  metricValueOf,
} from './report-dataset.ts'

const PAGE = { width: 595.28, height: 841.89, margin: 42 }
const COLORS = {
  ink: '#24323B', muted: '#667680', teal: '#0F766E', tealSoft: '#EAF5F3', line: '#D7E3E1',
  green: '#3B7F68', greenSoft: '#E8F3ED', amber: '#C47A1B', amberSoft: '#FFF2DD',
  red: '#B94A48', redSoft: '#FBE8E7', blue: '#3677A8', blueSoft: '#E9F2F8',
  purple: '#7564A7', grey: '#E6EBED', white: '#FFFFFF',
} as const

const SERIES = [COLORS.teal, COLORS.amber, COLORS.red, COLORS.purple, COLORS.blue, COLORS.green]

function fontPaths(): { readonly regular: string; readonly bold: string } {
  const require = createRequire(import.meta.url)
  const root = dirname(dirname(require.resolve('@embedpdf/fonts-sc')))
  return {
    regular: join(root, 'fonts', 'NotoSansHans-Regular.otf'),
    bold: join(root, 'fonts', 'NotoSansHans-Bold.otf'),
  }
}

function clip(value: string, maximum: number): string {
  const normalized = value.replaceAll(/[\r\n\t]+/gu, ' ').trim()
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`
}

function metricText(dataset: ReportDatasetV2, metricId: string): string {
  const definition = dataset.metricDefinitions.find(item => item.id === metricId)
  const value = metricValueOf(dataset, metricId)
  if (definition?.unit === 'percent') return `${(value.value * 100).toFixed(1)}%`
  if (definition?.unit === 'currency') return value.value > 0
    ? `¥${Math.round(value.value).toLocaleString('zh-CN')}`
    : '暂无可计算值'
  return Math.round(value.value).toLocaleString('zh-CN')
}

function sourceLink(row: ReviewRecordV1): string | undefined {
  for (let index = row.project.announcements.length - 1; index >= 0; index -= 1) {
    const link = row.project.announcements[index]?.sourceLink
    if (link !== undefined && /^https?:\/\//iu.test(link)) return link
  }
  return undefined
}

function businessField(value: { readonly original: string; readonly value?: string; readonly status: string } | undefined): string {
  if (value === undefined || value.status === 'missing') return '来源未披露'
  if (value.status === 'unparseable') return '来源已披露，暂无法解析'
  return value.value ?? value.original
}

function amountText(row: ReviewRecordV1): string {
  if (row.project.amount.parseStatus === 'missing') return '来源未披露'
  if (row.project.amount.parseStatus === 'unparseable') return '来源已披露，暂无法解析'
  return row.project.amount.display
}

function dateText(value: ReviewRecordV1['project']['publishedAt'] | undefined): string {
  if (value === undefined || value.parseStatus === 'missing') return '来源未披露'
  if (value.parseStatus === 'unparseable') return '来源已披露，暂无法解析'
  return value.value ?? value.original
}

function verification(row: ReviewRecordV1): string {
  if (row.recommendation === undefined) return '建议人工核对项目关键信息'
  return row.recommendation.verificationItems[0] ?? '暂无额外核验事项'
}

function businessAmount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿元`
  if (value >= 10_000) return `${(value / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 万元`
  return `${Math.round(value).toLocaleString('zh-CN')} 元`
}

export function reportBusinessSummary(dataset: ReportDatasetV2): string {
  const total = metricText(dataset, 'normalized-projects')
  const reviewed = metricText(dataset, 'reviewed-projects')
  const tender = metricText(dataset, 'confirmed-tender')
  const proposed = metricText(dataset, 'priority-proposed')
  const pending = metricText(dataset, 'pending-review')
  const result = metricValueOf(dataset, 'confirmed-total').value === 0
    ? '本次已复核范围内尚未形成人工确认候选。'
    : `已形成正式招投标候选 ${tender} 个、拟建重点前期线索 ${proposed} 个。`
  const scope = dataset.completeness === 'complete'
    ? `本轮 ${total} 个项目已全部完成人工复核。`
    : `本轮 ${total} 个项目中已有 ${reviewed} 个完成人工复核，另有 ${pending} 个待复核；本报告只代表当前复核范围。`
  const failed = Object.entries(dataset.query.sources)
    .filter(([, value]) => value?.status === 'failed')
    .map(([source]) => source === 'tender' ? '招投标' : '拟建项目')
  return `${scope}${result}${failed.length === 0 ? '' : ` 本轮未覆盖：${failed.join('、')}。`}`
}

function renderPdf(dataset: ReportDatasetV2, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const fonts = fontPaths()
  const document = new PDFDocument({
    size: 'A4', margin: PAGE.margin, bufferPages: true, compress: true,
    info: {
      Title: '招投标机会筛选结果报告',
      Author: '招投标工作台',
      Subject: dataset.completeness === 'complete' ? '完整机会筛选结果' : '阶段性机会筛选结果',
      CreationDate: new Date(dataset.createdAt),
    },
  })
  document.registerFont('NotoSansHans', fonts.regular)
  document.registerFont('NotoSansHansBold', fonts.bold)
  document.font('NotoSansHans').fillColor(COLORS.ink)
  const chunks: Buffer[] = []
  document.on('data', chunk => chunks.push(Buffer.from(chunk)))
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.once('end', () => resolve(Buffer.concat(chunks)))
    document.once('error', reject)
  })
  const onAbort = () => { document.destroy(signal.reason instanceof Error ? signal.reason : new Error('report rendering cancelled')) }
  signal.addEventListener('abort', onAbort, { once: true })

  const contentWidth = PAGE.width - PAGE.margin * 2
  const bottom = PAGE.height - PAGE.margin - 24
  const byRef = new Map(dataset.rows.map(row => [row.project.recordId, row]))
  const ensure = (height: number): void => {
    signal.throwIfAborted()
    if (document.y + height > bottom) document.addPage()
  }
  const paragraph = (value: string, options: { readonly muted?: boolean; readonly indent?: number; readonly size?: number } = {}): void => {
    ensure(30)
    document.font('NotoSansHans').fontSize(options.size ?? 9.7).fillColor(options.muted === true ? COLORS.muted : COLORS.ink)
      .text(value, PAGE.margin, document.y, { width: contentWidth, lineGap: 3, indent: options.indent ?? 0 })
    document.moveDown(0.3)
  }
  const section = (title: string, subtitle?: string): void => {
    ensure((subtitle === undefined ? 42 : 58) + 72)
    document.moveDown(0.35)
    document.font('NotoSansHansBold').fontSize(15).fillColor(COLORS.teal).text(title, PAGE.margin, document.y, { width: contentWidth })
    if (subtitle !== undefined) document.font('NotoSansHans').fontSize(8.8).fillColor(COLORS.muted).text(subtitle, PAGE.margin, document.y + 2, { width: contentWidth })
    document.moveTo(PAGE.margin, document.y + 4).lineTo(PAGE.margin + contentWidth, document.y + 4).lineWidth(0.8).strokeColor(COLORS.line).stroke()
    document.moveDown(0.55)
  }
  const observation = (label: string, value: ReportObservationV1): void => {
    ensure(68)
    document.roundedRect(PAGE.margin, document.y, contentWidth, 1, 1).fill(COLORS.line)
    document.moveDown(0.25)
    document.font('NotoSansHansBold').fontSize(10).fillColor(COLORS.ink).text(`${label}｜${value.title}`, PAGE.margin, document.y, { width: contentWidth })
    paragraph(value.statement)
    const metricFacts = value.metricRefs.map((ref) => {
      const definition = dataset.metricDefinitions.find(item => item.id === ref)
      return `${definition?.label ?? ref}：${metricText(dataset, ref)}`
    })
    const distributionFacts = (value.distributionRefs ?? []).map((ref) => {
      const distribution = dataset.distributions.find(item => item.id === ref)
      if (distribution === undefined) return ref
      const buckets = distribution.buckets.filter(bucket => bucket.count > 0).slice(0, 3).map(bucket => `${bucket.label} ${bucket.count}`).join('、')
      return `${distribution.label}：${buckets || '暂无记录'}`
    })
    const recordFacts = value.recordRefs.map(ref => byRef.get(ref)?.project.title ?? ref)
    paragraph(`结论依据：${[...metricFacts, ...distributionFacts, ...recordFacts].join('；')}`, { muted: true, size: 8.6 })
    if (value.limitations.length > 0) paragraph(`说明：${value.limitations.join('；')}`, { muted: true, size: 8.6 })
  }

  const drawMetricCards = (y: number): number => {
    const cards = [
      ['正式候选', 'confirmed-tender', COLORS.greenSoft, COLORS.green],
      ['拟建重点线索', 'priority-proposed', COLORS.blueSoft, COLORS.blue],
      ['观察', 'user-watch', COLORS.amberSoft, COLORS.amber],
      ['待复核', 'pending-review', '#F0EDF8', COLORS.purple],
    ] as const
    const gap = 8
    const width = (contentWidth - gap * 3) / 4
    cards.forEach(([label, id, fill, accent], index) => {
      const x = PAGE.margin + index * (width + gap)
      document.roundedRect(x, y, width, 56, 3).fill(fill)
      document.rect(x, y, 3, 56).fill(accent)
      document.font('NotoSansHans').fontSize(8.4).fillColor(COLORS.muted).text(label, x + 10, y + 9, { width: width - 18 })
      document.font('NotoSansHansBold').fontSize(19).fillColor(COLORS.ink).text(metricText(dataset, id), x + 10, y + 25, { width: width - 18 })
    })
    return y + 64
  }

  const drawStackedChart = (x: number, y: number, width: number, distribution: ReportDistributionV2): void => {
    document.font('NotoSansHansBold').fontSize(10.2).fillColor(COLORS.ink).text(distribution.label, x, y, { width })
    const total = distribution.buckets.reduce((sum, bucket) => sum + bucket.count, 0)
    let cursor = x
    document.roundedRect(x, y + 22, width, 16, 2).fill(COLORS.grey)
    if (total > 0) distribution.buckets.forEach((bucket, index) => {
      const segment = width * bucket.count / total
      if (segment > 0) document.rect(cursor, y + 22, segment, 16).fill(SERIES[index % SERIES.length] ?? COLORS.teal)
      cursor += segment
    })
    distribution.buckets.forEach((bucket, index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      const legendX = x + column * width / 2
      const legendY = y + 48 + row * 17
      document.rect(legendX, legendY + 2, 8, 8).fill(SERIES[index % SERIES.length] ?? COLORS.teal)
      document.font('NotoSansHans').fontSize(8).fillColor(COLORS.ink).text(`${bucket.label} ${bucket.count}`, legendX + 12, legendY, { width: width / 2 - 14 })
    })
  }

  const drawDeadlineChart = (x: number, y: number, width: number, distribution: ReportDistributionV2): void => {
    document.font('NotoSansHansBold').fontSize(10.2).fillColor(COLORS.ink).text(distribution.label, x, y, { width })
    const maximum = Math.max(1, ...distribution.buckets.map(bucket => bucket.count))
    distribution.buckets.forEach((bucket, index) => {
      const rowY = y + 21 + index * 16
      document.font('NotoSansHans').fontSize(7.7).fillColor(COLORS.ink).text(bucket.label, x, rowY, { width: 74 })
      document.roundedRect(x + 78, rowY + 1, width - 102, 8, 1).fill(COLORS.grey)
      if (bucket.count > 0) document.roundedRect(x + 78, rowY + 1, (width - 102) * bucket.count / maximum, 8, 1).fill(SERIES[index % SERIES.length] ?? COLORS.teal)
      document.font('NotoSansHans').fontSize(7.7).fillColor(COLORS.ink).text(String(bucket.count), x + width - 20, rowY - 1, { width: 20, align: 'right' })
    })
  }

  const compactPriority = (row: ReviewRecordV1, y: number): number => {
    const source = row.project.source === 'tender' ? '正式招投标' : '拟建项目'
    const time = row.project.source === 'tender' ? dateText(row.project.deadline) : dateText(row.project.publishedAt)
    const timeLabel = row.project.source === 'tender' ? deadlineWindowLabel(deadlineWindowOf(row, dataset.createdAt)) : '最近更新'
    document.font('NotoSansHansBold').fontSize(9.4).fillColor(COLORS.ink).text(`${source}｜${clip(row.project.title, 42)}`, PAGE.margin, y, { width: contentWidth })
    document.font('NotoSansHans').fontSize(8).fillColor(COLORS.muted)
      .text(`${clip(businessField(row.project.counterparty), 22)}｜${clip(amountText(row), 18)}｜${timeLabel} ${time}`, PAGE.margin, y + 17, { width: contentWidth })
    document.font('NotoSansHans').fontSize(8.3).fillColor(COLORS.ink)
      .text(`待核验：${clip(verification(row), 76)}`, PAGE.margin, y + 33, { width: contentWidth })
    document.moveTo(PAGE.margin, y + 51).lineTo(PAGE.margin + contentWidth, y + 51).strokeColor(COLORS.line).lineWidth(0.5).stroke()
    return y + 57
  }

  document.rect(0, 0, PAGE.width, 108).fill(COLORS.teal)
  document.font('NotoSansHansBold').fillColor(COLORS.white).fontSize(21)
    .text('招投标机会筛选结果报告', PAGE.margin, 35, { width: contentWidth })
  document.font('NotoSansHans').fontSize(10).fillColor('#D6EFEC')
    .text(`${dataset.completeness === 'complete' ? '完整报告' : '阶段性报告'}  |  生成时间 ${formatReportDateTime(dataset.createdAt)}`, PAGE.margin, 71, { width: contentWidth })
  document.y = 126
  document.font('NotoSansHansBold').fontSize(11).fillColor(COLORS.ink).text('本轮结论', PAGE.margin, document.y, { width: contentWidth })
  document.moveDown(0.25)
  paragraph(reportBusinessSummary(dataset), { size: 10 })
  document.y = drawMetricCards(document.y + 2)
  const chartY = document.y + 3
  const chartGap = 16
  const chartWidth = (contentWidth - chartGap) / 2
  drawStackedChart(PAGE.margin, chartY, chartWidth, distributionOf(dataset, 'review-decisions'))
  drawDeadlineChart(PAGE.margin + chartWidth + chartGap, chartY, chartWidth, distributionOf(dataset, 'tender-deadline-window'))
  document.y = chartY + 110
  document.font('NotoSansHansBold').fontSize(11).fillColor(COLORS.ink).text('近期需核验摘要', PAGE.margin, document.y, { width: contentWidth })
  document.font('NotoSansHans').fontSize(8).fillColor(COLORS.muted).text('按截止紧迫性或最近更新时间排列，不是商业价值排名。', PAGE.margin, document.y + 2, { width: contentWidth, align: 'right' })
  document.y += 22
  if (dataset.homepageRecordRefs.length === 0) paragraph('本次已复核范围内尚未形成人工确认候选。', { muted: true })
  else dataset.homepageRecordRefs.forEach((ref) => {
    const row = byRef.get(ref)
    if (row !== undefined) document.y = compactPriority(row, document.y)
  })

  section('近期需核验清单', '最多展示 10 条时间敏感或最近更新的人工确认结果；完整清单见 Excel。')
  const priorityRows = dataset.priorityRecordRefs.map(ref => byRef.get(ref)).filter((row): row is ReviewRecordV1 => row !== undefined)
  if (priorityRows.length === 0) paragraph('本次已复核范围内尚未形成人工确认候选。', { muted: true })
  priorityRows.forEach((row) => {
    ensure(64)
    const source = row.project.source === 'tender' ? '正式招投标' : '拟建项目'
    const time = row.project.source === 'tender' ? dateText(row.project.deadline) : dateText(row.project.publishedAt)
    const stage = row.project.source === 'tender'
      ? businessField(row.project.tenderDetails?.noticeStatus ?? row.project.stage)
      : businessField(row.project.proposedDetails?.projectStage ?? row.project.stage)
    document.font('NotoSansHansBold').fontSize(10).fillColor(COLORS.ink).text(`${source}｜${clip(row.project.title, 72)}`, PAGE.margin, document.y, { width: contentWidth })
    document.moveDown(0.15)
    paragraph(`${clip(businessField(row.project.counterparty), 30)}｜${clip(businessField(row.project.region), 20)}｜${clip(amountText(row), 22)}｜${stage}｜${time}`, { muted: true, size: 8.4 })
    paragraph(`人工备注：${row.review.note.trim() === '' ? '未填写确认备注' : clip(row.review.note, 90)}；待核验：${clip(verification(row), 90)}`, { size: 8.7 })
    const link = sourceLink(row)
    if (link !== undefined) document.font('NotoSansHans').fontSize(8.2).fillColor(COLORS.blue).text('查看来源', PAGE.margin, document.y, { link, underline: true, width: 80 })
    document.moveDown(0.3)
    document.moveTo(PAGE.margin, document.y).lineTo(PAGE.margin + contentWidth, document.y).strokeColor(COLORS.line).lineWidth(0.5).stroke()
    document.moveDown(0.3)
  })

  section('候选结构与分布')
  dataset.amountDistributions.forEach((distribution) => {
    ensure(72)
    const title = distribution.source === 'tender' ? '正式候选预算' : '拟建重点线索总投资'
    const median = distribution.medianCny === undefined ? '暂无可计算中位数' : `可解析单值中位数 ${businessAmount(distribution.medianCny)}`
    paragraph(`${title}：统计 ${distribution.eligibleCount} 个；${median}。${distribution.bands.map(band => `${band.label} ${band.count}`).join('；')}；区间暂无法确定 ${distribution.indeterminateCount}；来源未披露 ${distribution.missingCount}；暂无法解析 ${distribution.unparseableCount}。`)
    paragraph(distribution.limitation, { muted: true, size: 8.5 })
  })
  ;['confirmed-regions', 'tender-procurement-methods', 'tender-procurement-types', 'proposed-project-stages', 'proposed-approval-progress'].forEach((id) => {
    const distribution = distributionOf(dataset, id)
    ensure(55)
    document.font('NotoSansHansBold').fontSize(9.8).fillColor(COLORS.ink).text(distribution.label, PAGE.margin, document.y, { width: contentWidth })
    const facts = distribution.buckets.filter(bucket => bucket.count > 0).map(bucket => `${bucket.label} ${bucket.count}`).join('；')
    paragraph(facts === '' ? '本轮没有可用于该分布的记录。' : facts, { muted: facts === '', size: 8.8 })
  })
  dataset.narrative?.keyFindings.forEach(item => observation('补充分析观察', item))

  section('未决事项与风险')
  paragraph(`观察 ${metricText(dataset, 'user-watch')} 个，待复核 ${metricText(dataset, 'pending-review')} 个，人工排除 ${metricText(dataset, 'user-excluded')} 个。`)
  paragraph(`正式候选中近期需核验 ${metricText(dataset, 'near-term-tender')} 个；存在来源未披露字段 ${metricText(dataset, 'projects-with-missing-fields')} 个，存在暂无法解析字段 ${metricText(dataset, 'projects-with-unparseable-fields')} 个。`)
  paragraph('人工排除、规则初筛排除和数据异常分别保留；规则初筛或补充分析建议不会自动替代人工确认结论。', { muted: true })
  dataset.narrative?.risksAndLimitations.forEach(item => observation('补充风险观察', item))
  const failedSources = Object.entries(dataset.query.sources).filter(([, value]) => value?.status === 'failed')
  failedSources.forEach(([source, value]) => paragraph(`本轮未覆盖${source === 'tender' ? '招投标' : '拟建项目'}来源：${clip(value?.errorMessage ?? '来源调用未成功', 120)}`, { muted: true }))

  section('范围与统计说明')
  paragraph(`本轮筛选目标：${dataset.query.targetSummary}`)
  Object.entries(dataset.query.sources).forEach(([source, value]) => {
    if (value === undefined) return
    paragraph(`${source === 'tender' ? '招投标' : '拟建项目'}来源：${value.status === 'succeeded' ? `成功加载 ${value.loaded} 条来源记录` : '本轮未覆盖'}`)
  })
  paragraph(`本轮共加载来源记录 ${metricText(dataset, 'raw-records')} 条，经过字段整理与保守关联后形成项目 ${metricText(dataset, 'normalized-projects')} 个。来源记录和项目不是同一统计对象。`)
  const screening = distributionOf(dataset, 'screening-classifications')
  paragraph(`规则初筛：${screening.buckets.map(bucket => `${bucket.label} ${bucket.count}`).join('；')}；未执行规则初筛 ${screening.missingCount ?? 0}。规则初筛不等于人工确认结论。`)
  paragraph(`补充分析建议覆盖 ${metricText(dataset, 'agent-analyzed')}/${metricValueOf(dataset, 'agent-analyzed').denominator ?? 0}。未获得补充建议的项目仍可由人工直接复核。`)
  dataset.limitations.forEach(item => paragraph(`• ${item}`, { muted: true, size: 8.8 }))

  const range = document.bufferedPageRange()
  for (let page = range.start; page < range.start + range.count; page += 1) {
    document.switchToPage(page)
    document.font('NotoSansHans').fontSize(8).fillColor(COLORS.muted)
      .text(`招投标机会筛选结果报告  |  第 ${page + 1} / ${range.count} 页`, PAGE.margin, PAGE.height - PAGE.margin - 24, { width: contentWidth, align: 'center', lineBreak: false })
  }
  document.end()
  return completed.finally(() => signal.removeEventListener('abort', onAbort))
}

export async function renderReportPdf(dataset: ReportDatasetV2, signal: AbortSignal): Promise<RenderedReportFile> {
  const bytes = await renderPdf(dataset, signal)
  signal.throwIfAborted()
  const timestamp = dataset.createdAt.replaceAll(/[:.]/gu, '-').slice(0, 19)
  return {
    bytes,
    fileName: `招投标机会筛选结果-${dataset.completeness}-${timestamp}.pdf`,
    mediaType: 'application/pdf',
  }
}
