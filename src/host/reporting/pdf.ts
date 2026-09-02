import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import PDFDocument from 'pdfkit'
import type { ReportDatasetV1, ReportObservationV1 } from '../../contracts/reporting.ts'
import type { ReviewRecordV1 } from '../../contracts/analysis-review.ts'
import type { RenderedReportFile } from './excel.ts'
import { metricValueOf } from './report-dataset.ts'

const PAGE = { width: 595.28, height: 841.89, margin: 46 }
const COLORS = {
  ink: '#24323B', muted: '#667680', teal: '#0F766E', pale: '#EAF5F3', line: '#D7E3E1', amber: '#C47A1B', red: '#B94A48', white: '#FFFFFF',
} as const

function fontPaths(): { readonly regular: string; readonly bold: string } {
  const require = createRequire(import.meta.url)
  const root = dirname(dirname(require.resolve('@embedpdf/fonts-sc')))
  return {
    regular: join(root, 'fonts', 'NotoSansHans-Regular.otf'),
    bold: join(root, 'fonts', 'NotoSansHans-Bold.otf'),
  }
}

function metricText(dataset: ReportDatasetV1, metricId: string): string {
  const definition = dataset.metricDefinitions.find(item => item.id === metricId)
  const value = metricValueOf(dataset, metricId)
  if (definition?.unit === 'percent') return `${(value.value * 100).toFixed(1)}%`
  if (definition?.unit === 'currency') return value.missingCount === 0 || value.value > 0
    ? `¥${Math.round(value.value).toLocaleString('zh-CN')}`
    : '无可解析值'
  return Math.round(value.value).toLocaleString('zh-CN')
}

function decisionLabel(row: ReviewRecordV1): string {
  if (row.review.decision === 'confirmed-candidate') return row.project.source === 'tender' ? '确认候选商机' : '重点前期线索'
  if (row.review.decision === 'watch') return '观察'
  if (row.review.decision === 'exclude') return '排除'
  return '待复核'
}

export function reportNarrativeSummaryNote(dataset: ReportDatasetV1): string | undefined {
  if (dataset.narrative === undefined) {
    return '本次未包含 Agent 叙述。文件中的事实、数量、排序与重点项目均由 Host 确定性生成。'
  }
  if (dataset.narrative.executiveSummary === undefined) {
    return '本次未提供 Agent 管理摘要；其余已校验 Agent 叙述仍按固定区域展示，事实、数量、排序与重点项目均由 Host 确定性生成。'
  }
  return undefined
}

function renderPdf(dataset: ReportDatasetV1, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const fonts = fontPaths()
  const document = new PDFDocument({
    size: 'A4', margin: PAGE.margin, bufferPages: true, compress: true,
    info: {
      Title: dataset.completeness === 'complete' ? '招投标候选分析完整报告' : '招投标候选分析阶段性报告',
      Author: 'dsh-tender-workbench',
      Subject: `finalSnapshotId=${dataset.finalSnapshotId}; completeness=${dataset.completeness}`,
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
  const bottom = PAGE.height - PAGE.margin - 28
  const ensure = (height: number): void => {
    signal.throwIfAborted()
    if (document.y + height > bottom) document.addPage()
  }
  const section = (title: string): void => {
    ensure(46)
    document.moveDown(0.7)
    document.font('NotoSansHansBold').fontSize(15).fillColor(COLORS.teal).text(title, PAGE.margin, document.y, { width: contentWidth, lineGap: 3 })
    document.moveTo(PAGE.margin, document.y + 3).lineTo(PAGE.margin + contentWidth, document.y + 3).lineWidth(0.8).strokeColor(COLORS.line).stroke()
    document.moveDown(0.55)
    document.font('NotoSansHans').fillColor(COLORS.ink)
  }
  const paragraph = (value: string, options: { readonly muted?: boolean; readonly indent?: number } = {}): void => {
    ensure(34)
    document.font('NotoSansHans').fontSize(10.3).fillColor(options.muted === true ? COLORS.muted : COLORS.ink)
      .text(value, PAGE.margin, document.y, { width: contentWidth, lineGap: 3.5, indent: options.indent ?? 0 })
    document.moveDown(0.35)
  }
  const observation = (label: string, value: ReportObservationV1): void => {
    ensure(76)
    document.roundedRect(PAGE.margin, document.y, contentWidth, 1, 1).fill(COLORS.line)
    document.moveDown(0.35)
    document.font('NotoSansHansBold').fontSize(10.5).fillColor(COLORS.ink).text(`${label}｜${value.title}`, PAGE.margin, document.y, { width: contentWidth, lineGap: 3 })
    paragraph(value.statement)
    const metricFacts = value.metricRefs.map(ref => {
      const definition = dataset.metricDefinitions.find(item => item.id === ref)
      return `${definition?.label ?? ref}：${metricText(dataset, ref)}`
    })
    const recordFacts = value.recordRefs.map(ref => dataset.rows.find(row => row.project.recordId === ref)?.project.title ?? ref)
    paragraph(`Host 引用：${[...metricFacts, ...recordFacts].join('；')}`, { muted: true })
    if (value.limitations.length > 0) paragraph(`局限：${value.limitations.join('；')}`, { muted: true })
  }

  document.rect(0, 0, PAGE.width, 172).fill(COLORS.teal)
  document.font('NotoSansHansBold').fillColor(COLORS.white).fontSize(23)
    .text('招投标候选分析报告', PAGE.margin, 54, { width: contentWidth })
  document.font('NotoSansHans').fontSize(12).text(dataset.completeness === 'complete' ? '完整报告 · 全部项目已复核' : '阶段性报告 · 待复核项目已单列', PAGE.margin, document.y, { width: contentWidth, lineGap: 4 })
  document.fontSize(9.5).fillColor('#D6EFEC').text(`交付快照 ${dataset.finalSnapshotId}  ·  ${dataset.createdAt}  ·  Asia/Shanghai`, PAGE.margin, 134, { width: contentWidth })
  document.y = 196

  section('一、查询与处理范围')
  paragraph(`查询目标：${dataset.query.targetSummary}`)
  paragraph(`来源范围：${dataset.query.scope}。原始记录 ${metricText(dataset, 'raw-records')} 条，形成规范化项目 ${metricText(dataset, 'normalized-projects')} 个。`)
  paragraph(`字段披露/解析范围：存在未披露字段 ${metricText(dataset, 'projects-with-missing-fields')} 个，存在无法解析字段 ${metricText(dataset, 'projects-with-unparseable-fields')} 个。此处只描述本次可用证据范围，不评价来源事实准确性。`)

  section('二、管理摘要')
  paragraph(dataset.completeness === 'complete'
    ? `本次交付已复核 ${metricText(dataset, 'reviewed-projects')} 个项目，待复核为 ${metricText(dataset, 'pending-review')}。`
    : `本次为阶段性报告，已复核 ${metricText(dataset, 'reviewed-projects')} 个项目，另有 ${metricText(dataset, 'pending-review')} 个待复核项目。`)
  const narrativeSummaryNote = reportNarrativeSummaryNote(dataset)
  if (narrativeSummaryNote !== undefined) paragraph(narrativeSummaryNote, { muted: true })
  else if (dataset.narrative?.executiveSummary !== undefined) observation('Agent 管理摘要', dataset.narrative.executiveSummary)

  section('三、候选筛选漏斗')
  const funnel = [
    ['原始记录', 'raw-records'], ['规范化项目', 'normalized-projects'], ['初筛候选', 'screening-candidates'], ['已复核', 'reviewed-projects'], ['用户确认候选', 'confirmed-tender'], ['拟建重点线索', 'priority-proposed'],
  ] as const
  const maximum = Math.max(1, ...funnel.map(([, id]) => metricValueOf(dataset, id).value))
  funnel.forEach(([label, id]) => {
    ensure(26)
    const value = metricValueOf(dataset, id).value
    const width = Math.max(2, (contentWidth - 132) * value / maximum)
    const y = document.y
    document.font('NotoSansHans').fontSize(9.5).fillColor(COLORS.ink).text(label, PAGE.margin, y + 2, { width: 92 })
    document.rect(PAGE.margin + 98, y, width, 15).fill(id === 'confirmed-tender' || id === 'priority-proposed' ? COLORS.teal : '#81B9B3')
    document.fillColor(COLORS.ink).text(metricText(dataset, id), PAGE.margin + contentWidth - 32, y + 2, { width: 32, align: 'right' })
    document.y = y + 24
    document.x = PAGE.margin
  })
  paragraph('口径提示：原始记录与规范化项目不是同一统计对象；初筛候选、Agent 建议和用户决定彼此独立；pending 不进入已复核分母。', { muted: true })

  section('四、主要分布与 Agent 分析覆盖')
  dataset.amountDistributions.forEach((distribution) => {
    const label = distribution.source === 'tender' ? '正式招投标预算' : '拟建项目总投资'
    const median = distribution.medianCny === undefined ? '无可解析值' : `¥${Math.round(distribution.medianCny).toLocaleString('zh-CN')}`
    paragraph(`${label}：统计对象 ${distribution.eligibleCount}，可解析 ${distribution.parsedCount}，缺失/无法解析 ${distribution.missingCount}，中位数 ${median}。区间：${distribution.bands.map(band => `${band.label} ${band.count}`).join('；')}。`)
    paragraph(distribution.limitation, { muted: true })
  })
  paragraph(`Agent 分析覆盖 ${metricText(dataset, 'agent-analyzed')}/${metricValueOf(dataset, 'agent-analyzed').denominator ?? 0}（${metricText(dataset, 'agent-analysis-coverage')}）。未分析项目仍可人工复核并进入交付。`)
  dataset.narrative?.keyFindings.forEach(item => observation('Agent 主要发现', item))

  section('五、正式候选与拟建重点线索摘要')
  paragraph(`正式招投标确认候选 ${metricText(dataset, 'confirmed-tender')} 个；拟建重点前期线索 ${metricText(dataset, 'priority-proposed')} 个。两类金额不合计。`)
  const priority = dataset.priorityRecordRefs.map(ref => dataset.rows.find(row => row.project.recordId === ref)).filter((row): row is ReviewRecordV1 => row !== undefined)
  const priorityNarrative = new Map<string, ReportObservationV1[]>()
  const genericPriorityNarrative: ReportObservationV1[] = []
  dataset.narrative?.priorityVerification.forEach((item) => {
    const recordRef = dataset.priorityRecordRefs.find(ref => item.recordRefs.includes(ref))
    if (recordRef === undefined) genericPriorityNarrative.push(item)
    else priorityNarrative.set(recordRef, [...(priorityNarrative.get(recordRef) ?? []), item])
  })
  ;(['tender', 'proposed'] as const).forEach((source) => {
    const rows = priority.filter(row => row.project.source === source)
    if (rows.length === 0) return
    ensure(32)
    document.font('NotoSansHansBold').fontSize(11).fillColor(COLORS.ink).text(source === 'tender' ? '正式招投标' : '拟建项目', PAGE.margin, document.y, { width: contentWidth })
    rows.forEach((row) => {
      ensure(66)
      document.font('NotoSansHansBold').fontSize(10.3).text(`• ${row.project.title}`, PAGE.margin, document.y, { width: contentWidth, indent: 8, lineGap: 3 })
      const date = row.project.source === 'tender' ? row.project.deadline?.value ?? '未披露有效截止时间' : row.project.publishedAt.value ?? '未披露最近更新时间'
      paragraph(`${decisionLabel(row)}｜${row.project.amount.display}｜${row.project.source === 'tender' ? '截止' : '更新'} ${date}`, { muted: true, indent: 14 })
      const related = priorityNarrative.get(row.project.recordId) ?? []
      related.forEach(item => observation('Agent 核验说明', item))
    })
  })
  if (priority.length === 0) paragraph('当前没有用户确认的正式候选或拟建重点线索，因此无优先核验摘要。', { muted: true })
  genericPriorityNarrative.forEach(item => observation('Agent 核验说明', item))

  section('六、观察、待复核与排除')
  paragraph(`观察 ${metricText(dataset, 'user-watch')} 个，待复核 ${metricText(dataset, 'pending-review')} 个，用户排除 ${metricText(dataset, 'user-excluded')} 个。`)
  paragraph('用户排除与初筛排除分别保留；关联公告不会自动成为业务排除；Agent 暂不建议也不会自动生成用户排除。', { muted: true })
  dataset.narrative?.risksAndLimitations.forEach(item => observation('Agent 风险/局限', item))

  section('七、统计口径与能力边界')
  dataset.limitations.forEach(item => paragraph(`• ${item}`, { muted: true }))
  paragraph(`报告上下文指纹：${dataset.contextFingerprint}`, { muted: true })

  const range = document.bufferedPageRange()
  for (let page = range.start; page < range.start + range.count; page += 1) {
    document.switchToPage(page)
    document.font('NotoSansHans').fontSize(8).fillColor(COLORS.muted)
      .text(`dsh-tender-workbench · ${dataset.completeness} · 第 ${page + 1} / ${range.count} 页`, PAGE.margin, PAGE.height - PAGE.margin - 13, { width: contentWidth, align: 'center', lineBreak: false })
  }
  document.end()
  return completed.finally(() => signal.removeEventListener('abort', onAbort))
}

export async function renderReportPdf(dataset: ReportDatasetV1, signal: AbortSignal): Promise<RenderedReportFile> {
  const bytes = await renderPdf(dataset, signal)
  signal.throwIfAborted()
  const timestamp = dataset.createdAt.replaceAll(/[:.]/gu, '-').slice(0, 19)
  return {
    bytes,
    fileName: `招投标候选分析-${dataset.completeness}-${timestamp}.pdf`,
    mediaType: 'application/pdf',
  }
}
