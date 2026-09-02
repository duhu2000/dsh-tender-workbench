import ExcelJS, { type CellValue, type Worksheet } from 'exceljs'
import type { ReviewRecordV1 } from '../../contracts/analysis-review.ts'
import type { ReportDatasetV1 } from '../../contracts/reporting.ts'
import { metricValueOf } from './report-dataset.ts'

export interface RenderedReportFile {
  readonly bytes: Buffer
  readonly fileName: string
  readonly mediaType: string
}

const MAX_EXCEL_TEXT = 32_000
const HEADER_FILL = 'FF0F766E'
const SUBHEADER_FILL = 'FFEAF5F3'
const TEXT_COLOR = 'FF25323B'
const MUTED_COLOR = 'FF64727D'

export function escapeExcelText(value: string): string {
  const normalized = value.replaceAll(/[\t\r\n]+/gu, ' ').replaceAll(/\p{C}+/gu, '').slice(0, MAX_EXCEL_TEXT)
  return /^\s*[=+\-@]/u.test(normalized) ? `'${normalized}` : normalized
}

function text(value: string | undefined): string {
  return escapeExcelText(value ?? '')
}

function classificationLabel(value: ReviewRecordV1['classification']): string {
  if (value === 'include') return '初选'
  if (value === 'observe') return '观察'
  if (value === 'manual-review') return '人工复核'
  if (value === 'exclude') return '初筛排除'
  if (value === 'unmatched') return '未匹配'
  return '未执行初筛'
}

function recommendationLabel(row: ReviewRecordV1): string {
  if (row.recommendation?.recommendation === 'priority-review') return '重点复核'
  if (row.recommendation?.recommendation === 'watch') return '建议关注'
  if (row.recommendation?.recommendation === 'not-recommended') return '暂不建议'
  return '未分析'
}

function decisionLabel(row: ReviewRecordV1): string {
  if (row.review.decision === 'confirmed-candidate') return row.project.source === 'tender' ? '确认候选商机' : '重点前期线索'
  if (row.review.decision === 'watch') return '观察'
  if (row.review.decision === 'exclude') return '排除'
  return '待复核'
}

function disclosureLabel(row: ReviewRecordV1): string {
  if (row.project.disclosure.unparseableFields.length > 0) return '存在无法解析字段'
  if (row.project.disclosure.missingFields.length > 0) return '存在未披露字段'
  return '主要字段已披露并解析'
}

const DATA_HEADERS = [
  '数据处理状态', '初筛分类', '生效规则 id', 'Agent 建议', 'Agent 理由', 'Agent 引用证据', 'Agent 待核验项', 'Agent 局限',
  '用户决定', '用户备注', '来源', '来源项目 id', '项目名称', '生命周期', '项目编号原值', '项目编号规范值',
  '地区原值', '地区规范值', '采购人/建设单位原值', '采购人/建设单位规范值', '金额类型', '金额原值', '金额最小值（元）',
  '金额最大值（元）', '金额解析状态', '金额展示', '发布时间原值', '发布时间规范值', '截止时间原值', '截止时间规范值',
  '字段披露/解析状态', '未披露字段', '无法解析字段', '关联公告 id', '关联公告阶段', '来源链接',
] as const

function rowValues(row: ReviewRecordV1): CellValue[] {
  const announcements = row.project.announcements
  return [
    '已规范化',
    classificationLabel(row.classification),
    text(row.finalRuleId),
    recommendationLabel(row),
    text(row.recommendation?.reason),
    text(row.recommendation?.evidence.map(item => `${item.label}：${item.value}`).join('；')),
    text(row.recommendation?.verificationItems.join('；')),
    text(row.recommendation?.limitations.join('；')),
    decisionLabel(row),
    text(row.review.note),
    row.project.source === 'tender' ? '招投标' : '拟建项目',
    text(row.project.sourceId),
    text(row.project.title),
    text(row.project.lifecycle),
    text(row.project.projectNumber.original),
    text(row.project.projectNumber.value),
    text(row.project.region.original),
    text(row.project.region.value),
    text(row.project.counterparty.original),
    text(row.project.counterparty.value),
    text(row.project.amount.type),
    text(row.project.amount.original),
    row.project.amount.minCny ?? null,
    row.project.amount.maxCny ?? null,
    text(row.project.amount.parseStatus),
    text(row.project.amount.display),
    text(row.project.publishedAt.original),
    text(row.project.publishedAt.value),
    text(row.project.deadline?.original),
    text(row.project.deadline?.value),
    disclosureLabel(row),
    text(row.project.disclosure.missingFields.join('；')),
    text(row.project.disclosure.unparseableFields.join('；')),
    text(announcements.map(item => item.sourceRecordId).join('；')),
    text(announcements.map(item => item.lifecycle).join('；')),
    text(announcements.map(item => item.sourceLink).filter((value): value is string => value !== undefined).join('；')),
  ]
}

function styleDataSheet(sheet: Worksheet): void {
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }]
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(DATA_HEADERS.length).letter}1` }
  const header = sheet.getRow(1)
  header.height = 30
  header.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.font = { name: 'Microsoft YaHei', color: { argb: TEXT_COLOR }, size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
    row.height = 36
  })
  const widths = [13, 13, 18, 13, 38, 48, 36, 34, 16, 38, 12, 20, 42, 18, 22, 22, 20, 20, 28, 28, 18, 22, 18, 18, 18, 18, 20, 20, 20, 20, 24, 32, 32, 32, 28, 48]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  ;[23, 24].forEach((column) => { sheet.getColumn(column).numFmt = '#,##0' })
}

function addDataSheet(workbook: ExcelJS.Workbook, name: string, rows: readonly ReviewRecordV1[]): Worksheet {
  const sheet = workbook.addWorksheet(name, { properties: { defaultRowHeight: 22 }, views: [{ showGridLines: false }] })
  sheet.addRow([...DATA_HEADERS])
  rows.forEach(row => sheet.addRow(rowValues(row)))
  styleDataSheet(sheet)
  return sheet
}

function addOverview(workbook: ExcelJS.Workbook, dataset: ReportDatasetV1): void {
  const sheet = workbook.addWorksheet('分析概况', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] })
  sheet.mergeCells('A1:H1')
  sheet.getCell('A1').value = dataset.completeness === 'complete' ? '招投标候选分析 - 完整报告' : '招投标候选分析 - 阶段性报告'
  sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  sheet.getCell('A1').alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 38
  sheet.addRow(['交付快照', dataset.finalSnapshotId, '创建时间', dataset.createdAt, '时区', dataset.timeZone, '复核完整度', dataset.completeness])
  sheet.addRow(['活动数据', dataset.activeDatasetId, '初筛口径', dataset.ruleSetVersion ?? '未使用', 'Agent 分析', dataset.analysisVersion ?? '未使用', '复核 revision', dataset.reviewRevision])
  sheet.addRow(['查询目标', text(dataset.query.targetSummary), '来源范围', dataset.query.scope, '实际来源状态', text(Object.entries(dataset.query.sources).map(([source, value]) => `${source}:${value.status}/${value.loaded}`).join('；')), '', '', ''])
  sheet.addRow(['报告上下文指纹', dataset.contextFingerprint, '叙述状态', dataset.narrative === undefined ? '本次未包含 Agent 叙述' : '已校验并写入交付快照', '', '', '', ''])
  sheet.addRow([])
  const metricHeaderRow = sheet.rowCount + 1
  sheet.addRow(['指标 id', '指标', '值', '单位', '分子', '分母', '统计对象/范围', '局限'])
  dataset.metricDefinitions.forEach((definition) => {
    const value = metricValueOf(dataset, definition.id)
    const row = sheet.addRow([
      definition.id,
      definition.label,
      value.value,
      definition.unit,
      value.numerator ?? null,
      value.denominator ?? null,
      text(`${definition.description} ${definition.scopeDescription}`),
      text(definition.limitation),
    ])
    row.getCell(3).numFmt = definition.unit === 'percent' ? '0.0%' : definition.unit === 'currency' ? '#,##0' : '0'
    row.getCell(5).numFmt = '0'
    row.getCell(6).numFmt = '0'
  })
  sheet.addRow([])
  const amountHeaderRow = sheet.rowCount + 1
  sheet.addRow(['金额范围', '统计项目', '可解析', '缺失/无法解析', '中位数（元）', '区间分布', '局限', ''])
  dataset.amountDistributions.forEach((distribution) => {
    sheet.addRow([
      distribution.source === 'tender' ? '正式招投标预算' : '拟建项目总投资',
      distribution.eligibleCount,
      distribution.parsedCount,
      distribution.missingCount,
      distribution.medianCny ?? null,
      text(distribution.bands.map(band => `${band.label}:${band.count}`).join('；')),
      text(distribution.limitation),
      '',
    ])
  })
  sheet.addRow([])
  const narrativeHeaderRow = sheet.rowCount + 1
  sheet.addRow(['Agent 报告叙述（固定摘要区）', '', '', '', '', '', '', ''])
  sheet.mergeCells(`A${narrativeHeaderRow}:H${narrativeHeaderRow}`)
  sheet.addRow(['区域', '标题', '叙述', 'Host 指标引用', 'Host 记录引用', 'Host 确定事实', '局限', ''])
  const byMetric = new Map(dataset.metricDefinitions.map(definition => [definition.id, definition]))
  const byRecord = new Map(dataset.rows.map(row => [row.project.recordId, row]))
  const addNarrative = (
    area: string,
    observation: NonNullable<ReportDatasetV1['narrative']>['keyFindings'][number],
  ): void => {
    const metricFacts = observation.metricRefs.map((ref) => {
      const definition = byMetric.get(ref)
      const value = metricValueOf(dataset, ref)
      const rendered = definition?.unit === 'percent' ? `${(value.value * 100).toFixed(1)}%` : String(value.value)
      return `${definition?.label ?? ref}：${rendered}`
    })
    const recordFacts = observation.recordRefs.map((ref) => {
      const row = byRecord.get(ref)
      return row === undefined ? ref : `${row.project.source === 'tender' ? '招投标' : '拟建'}：${row.project.title}`
    })
    sheet.addRow([
      area,
      text(observation.title),
      text(observation.statement),
      text(observation.metricRefs.join('；')),
      text(observation.recordRefs.join('；')),
      text([...metricFacts, ...recordFacts].join('；')),
      text(observation.limitations.join('；')),
      '',
    ])
  }
  if (dataset.narrative === undefined) {
    sheet.addRow(['未提供', '本次未包含 Agent 叙述', '文件中的事实、数量、排序与重点项目均由 Host 确定性生成。', '', '', '', '', ''])
  } else {
    if (dataset.narrative.executiveSummary !== undefined) addNarrative('管理摘要', dataset.narrative.executiveSummary)
    dataset.narrative.keyFindings.forEach(item => addNarrative('主要发现', item))
    dataset.narrative.priorityVerification.forEach(item => addNarrative('优先核验', item))
    dataset.narrative.risksAndLimitations.forEach(item => addNarrative('风险/局限', item))
  }
  sheet.addRow([])
  const limitationHeaderRow = sheet.rowCount + 1
  sheet.addRow(['能力边界与局限'])
  dataset.limitations.forEach((limitation) => {
    const row = sheet.addRow([text(limitation)])
    sheet.mergeCells(`A${row.number}:H${row.number}`)
    row.height = 30
  })
  sheet.getColumn(1).width = 25
  sheet.getColumn(2).width = 24
  sheet.getColumn(3).width = 18
  sheet.getColumn(4).width = 22
  sheet.getColumn(5).width = 18
  sheet.getColumn(6).width = 18
  sheet.getColumn(7).width = 58
  sheet.getColumn(8).width = 52
  sheet.getColumn(3).numFmt = '#,##0.00'
  sheet.getColumn(5).numFmt = '#,##0.00'
  ;[2, 3, 4, 5, metricHeaderRow, amountHeaderRow, narrativeHeaderRow, narrativeHeaderRow + 1, limitationHeaderRow].forEach((rowNumber) => {
    const row = sheet.getRow(rowNumber)
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBHEADER_FILL } }
    row.font = { name: 'Microsoft YaHei', bold: true, color: { argb: TEXT_COLOR } }
  })
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true }
    if (row.number > 1 && row.font === undefined) row.font = { name: 'Microsoft YaHei', color: { argb: TEXT_COLOR }, size: 10 }
  })
}

function historicalRows(rows: readonly ReviewRecordV1[]): ReviewRecordV1[] {
  return rows.filter(row => row.project.lifecycle === 'awarded' || row.project.lifecycle === 'contracted'
    || row.project.announcements.some(announcement => announcement.lifecycle === 'awarded' || announcement.lifecycle === 'contracted'))
}

function addInvalidRows(sheet: Worksheet, dataset: ReportDatasetV1): void {
  dataset.invalidRecords.forEach((invalid) => {
    sheet.addRow([
      '技术不可用', '', '', '', '', '', '', '', '', '',
      invalid.source === 'tender' ? '招投标' : '拟建项目',
      `index:${invalid.index}`,
      text(invalid.rawPreview),
      text(invalid.code),
      '', '', '', '', '', '', '', '', null, null, '', '', '', '', '', '',
      '违反来源 Schema 或缺少必要标识', '', text(invalid.message), '', '', '',
    ])
  })
  styleDataSheet(sheet)
}

export async function renderReportExcel(dataset: ReportDatasetV1, signal: AbortSignal): Promise<RenderedReportFile> {
  signal.throwIfAborted()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'dsh-tender-workbench'
  workbook.created = new Date(dataset.createdAt)
  workbook.modified = new Date(dataset.createdAt)
  workbook.subject = dataset.completeness === 'complete' ? '完整候选分析交付' : '阶段性候选分析交付'
  workbook.title = '招投标候选分析'
  workbook.company = 'DeepSeek Harness'
  addOverview(workbook, dataset)
  addDataSheet(workbook, '招投标候选', dataset.rows.filter(row => row.project.source === 'tender' && row.review.decision === 'confirmed-candidate'))
  addDataSheet(workbook, '拟建重点线索', dataset.rows.filter(row => row.project.source === 'proposed' && row.review.decision === 'confirmed-candidate'))
  addDataSheet(workbook, '观察与待复核', dataset.rows.filter(row => row.review.decision === 'watch' || row.review.decision === 'pending'))
  const excluded = addDataSheet(workbook, '排除与异常', dataset.rows.filter(row => row.review.decision === 'exclude' || row.classification === 'exclude'))
  addInvalidRows(excluded, dataset)
  addDataSheet(workbook, '全量规范化数据', dataset.rows)
  const history = historicalRows(dataset.rows)
  if (history.length > 0) addDataSheet(workbook, '历史结果与竞争线索', history)
  signal.throwIfAborted()
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  signal.throwIfAborted()
  const timestamp = dataset.createdAt.replaceAll(/[:.]/gu, '-').slice(0, 19)
  return {
    bytes,
    fileName: `招投标候选分析-${dataset.completeness}-${timestamp}.xlsx`,
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}
