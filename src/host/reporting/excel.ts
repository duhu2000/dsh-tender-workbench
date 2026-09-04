import ExcelJS, { type CellValue, type Worksheet } from 'exceljs'
import type { ReviewRecordV1 } from '../../contracts/analysis-review.ts'
import type { ReportDatasetV2, ReportDistributionV2 } from '../../contracts/reporting.ts'
import {
  deadlineWindowLabel,
  deadlineWindowOf,
  distributionOf,
  formatAmountAxis,
  formatReportDateTime,
  metricValueOf,
} from './report-dataset.ts'

export interface RenderedReportFile {
  readonly bytes: Buffer
  readonly fileName: string
  readonly mediaType: string
}

const MAX_EXCEL_TEXT = 32_000
const COLORS = {
  ink: 'FF24323B', muted: 'FF64727D', teal: 'FF0F766E', tealSoft: 'FFEAF5F3',
  green: 'FF3B7F68', greenSoft: 'FFE8F3ED', amber: 'FFC47A1B', amberSoft: 'FFFFF2DD',
  red: 'FFB94A48', redSoft: 'FFFBE8E7', blue: 'FF3677A8', blueSoft: 'FFE9F2F8',
  purple: 'FF7564A7', purpleSoft: 'FFF0EDF8', line: 'FFD7E3E1', white: 'FFFFFFFF', grey: 'FFE6EBED',
} as const

const CHART_COLORS = [COLORS.teal, COLORS.amber, COLORS.red, COLORS.purple, COLORS.blue, COLORS.green]

export function escapeExcelText(value: string): string {
  const normalized = value.replaceAll(/[\t\r\n]+/gu, ' ').replaceAll(/\p{C}+/gu, '').slice(0, MAX_EXCEL_TEXT)
  return /^\s*[=+\-@]/u.test(normalized) ? `'${normalized}` : normalized
}

function text(value: string | undefined): string {
  return escapeExcelText(value ?? '')
}

function fieldText(value: { readonly original: string; readonly value?: string; readonly status: string } | undefined): string {
  if (value === undefined || value.status === 'missing') return '来源未披露'
  if (value.status === 'unparseable') return text(`来源已披露，暂无法解析：${value.original}`)
  return text(value.value ?? value.original)
}

function dateText(value: ReviewRecordV1['project']['publishedAt'] | undefined): string {
  if (value === undefined || value.parseStatus === 'missing') return '来源未披露'
  if (value.parseStatus === 'unparseable') return text(`来源已披露，暂无法解析：${value.original}`)
  return text(value.value ?? value.original)
}

function amountText(row: ReviewRecordV1): string {
  if (row.project.amount.parseStatus === 'missing') return '来源未披露'
  if (row.project.amount.parseStatus === 'unparseable') return text(`来源已披露，暂无法解析：${row.project.amount.original}`)
  return text(row.project.amount.display)
}

function entities(values: readonly { readonly name: string }[] | undefined): string {
  return values === undefined || values.length === 0 ? '来源未披露' : text(values.map(value => value.name).join('、'))
}

function list(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? '来源未披露' : text(values.join('、'))
}

function sourceLink(row: ReviewRecordV1): string | undefined {
  for (let index = row.project.announcements.length - 1; index >= 0; index -= 1) {
    const link = row.project.announcements[index]?.sourceLink
    if (link !== undefined && /^https?:\/\//iu.test(link)) return link
  }
  return undefined
}

function linkValue(row: ReviewRecordV1): CellValue {
  const link = sourceLink(row)
  return link === undefined ? '来源未返回可用链接' : { text: '查看来源', hyperlink: link, tooltip: link }
}

function decisionLabel(row: ReviewRecordV1): string {
  if (row.review.decision === 'confirmed-candidate') return row.project.source === 'tender' ? '正式候选' : '重点前期线索'
  if (row.review.decision === 'watch') return '观察'
  if (row.review.decision === 'exclude') return '人工排除'
  return '尚未形成确认结论'
}

function classificationLabel(row: ReviewRecordV1): string {
  if (row.classification === 'include') return '初选'
  if (row.classification === 'observe') return '观察'
  if (row.classification === 'manual-review') return '人工复核'
  if (row.classification === 'exclude') return '初筛排除'
  if (row.classification === 'unmatched') return '未匹配'
  return '未执行规则初筛'
}

function recommendationLabel(row: ReviewRecordV1): string {
  if (row.recommendation?.recommendation === 'priority-review') return '重点复核'
  if (row.recommendation?.recommendation === 'watch') return '建议关注'
  if (row.recommendation?.recommendation === 'not-recommended') return '暂不建议'
  return '未进行智能辅助分析'
}

function note(row: ReviewRecordV1): string {
  return row.review.note.trim() === '' ? '未填写确认备注' : text(row.review.note)
}

function verification(row: ReviewRecordV1): string {
  if (row.recommendation === undefined) return '建议人工核对项目关键信息'
  return text(row.recommendation.verificationItems.join('；')) || '暂无额外核验事项'
}

function styleTitle(sheet: Worksheet, range: string, value: string): void {
  sheet.mergeCells(range)
  const cell = sheet.getCell(range.split(':')[0] ?? 'A1')
  cell.value = value
  cell.font = { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: COLORS.white } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.teal } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(Number(cell.row)).height = 38
}

function styleTable(sheet: Worksheet, widths: readonly number[]): void {
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2, showGridLines: false }]
  if (sheet.columnCount > 0) sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columnCount).letter}1` }
  const header = sheet.getRow(1)
  header.height = 30
  header.font = { name: 'Microsoft YaHei', bold: true, color: { argb: COLORS.white }, size: 10 }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.teal } }
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.font = { name: 'Microsoft YaHei', color: { argb: COLORS.ink }, size: 10 }
    row.alignment = { vertical: 'top', wrapText: true }
    row.height = 38
  })
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
  sheet.headerFooter.oddFooter = '&C招投标机会筛选结果报告  &P / &N'
}

function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: readonly string[],
  rows: readonly CellValue[][],
  widths: readonly number[],
): Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ showGridLines: false }] })
  sheet.addRow([...headers])
  rows.forEach(row => sheet.addRow(row))
  styleTable(sheet, widths)
  return sheet
}

function tenderValues(row: ReviewRecordV1, createdAt: string): CellValue[] {
  const details = row.project.tenderDetails
  return [
    decisionLabel(row), text(row.project.title), fieldText(row.project.counterparty), fieldText(row.project.region),
    amountText(row), row.project.amount.minCny ?? null, row.project.amount.maxCny ?? null,
    dateText(row.project.deadline), deadlineWindowLabel(deadlineWindowOf(row, createdAt)),
    fieldText(details?.infoType), fieldText(details?.noticeStatus), fieldText(details?.procurementMethod),
    fieldText(details?.procurementType), list(details?.industries), list(details?.products), entities(details?.agents),
    note(row), recommendationLabel(row), text(row.recommendation?.reason), verification(row), linkValue(row),
    fieldText(row.project.projectNumber), text(row.project.sourceId),
  ]
}

const TENDER_HEADERS = [
  '人工确认结论', '项目名称', '采购人', '地区', '金额', '金额最小值（元）', '金额最大值（元）',
  '截止时间', '截止窗口', '信息类型', '公告状态', '招采方式', '招采类型', '行业', '相关产品', '代理单位',
  '用户备注', '补充分析建议', '建议理由', '待核验事项', '来源链接', '项目编号', '来源记录 id',
] as const

const TENDER_WIDTHS = [15, 42, 26, 20, 20, 18, 18, 20, 16, 16, 16, 18, 14, 22, 22, 24, 34, 18, 38, 38, 14, 20, 20]

function proposedValues(row: ReviewRecordV1): CellValue[] {
  const details = row.project.proposedDetails
  return [
    decisionLabel(row), text(row.project.title), fieldText(row.project.counterparty), fieldText(row.project.region),
    amountText(row), row.project.amount.minCny ?? null, row.project.amount.maxCny ?? null,
    fieldText(details?.projectStage), fieldText(details?.approvalProgress), entities(details?.approvalAuthorities),
    dateText(row.project.publishedAt), note(row), recommendationLabel(row), text(row.recommendation?.reason),
    verification(row), linkValue(row), fieldText(row.project.projectNumber), text(row.project.sourceId),
  ]
}

const PROPOSED_HEADERS = [
  '人工确认结论', '项目名称', '建设单位', '地区', '项目总投资', '投资最小值（元）', '投资最大值（元）',
  '项目阶段', '审批进度', '审批单位', '最近更新时间', '用户备注', '补充分析建议', '建议理由',
  '待核验事项', '来源链接', '项目编号', '来源记录 id',
] as const

const PROPOSED_WIDTHS = [15, 42, 26, 20, 20, 18, 18, 18, 18, 24, 20, 34, 18, 38, 38, 14, 20, 20]

function genericValues(row: ReviewRecordV1, createdAt: string): CellValue[] {
  const stage = row.project.source === 'tender'
    ? fieldText(row.project.tenderDetails?.noticeStatus ?? row.project.stage)
    : fieldText(row.project.proposedDetails?.projectStage ?? row.project.stage)
  const time = row.project.source === 'tender' ? dateText(row.project.deadline) : dateText(row.project.publishedAt)
  return [
    decisionLabel(row), row.project.source === 'tender' ? '招投标' : '拟建项目', text(row.project.title),
    fieldText(row.project.counterparty), fieldText(row.project.region), amountText(row), stage, time,
    row.project.source === 'tender' ? deadlineWindowLabel(deadlineWindowOf(row, createdAt)) : '按最近更新时间排列',
    note(row), recommendationLabel(row), verification(row), linkValue(row), fieldText(row.project.projectNumber), text(row.project.sourceId),
  ]
}

const GENERIC_HEADERS = [
  '人工确认结论', '来源', '项目名称', '采购人/建设单位', '地区', '金额', '阶段', '截止/更新时间',
  '时间提示', '用户备注', '补充分析建议', '待核验事项', '来源链接', '项目编号', '来源记录 id',
] as const

const GENERIC_WIDTHS = [18, 12, 42, 26, 20, 20, 18, 20, 18, 34, 18, 38, 14, 20, 20]

function overallSummary(dataset: ReportDatasetV2): string {
  const total = metricValueOf(dataset, 'normalized-projects').value
  const reviewed = metricValueOf(dataset, 'reviewed-projects').value
  const tender = metricValueOf(dataset, 'confirmed-tender').value
  const proposed = metricValueOf(dataset, 'priority-proposed').value
  const pending = metricValueOf(dataset, 'pending-review').value
  const result = tender + proposed === 0
    ? '本次已复核范围内尚未形成人工确认候选。'
    : `已形成正式招投标候选 ${tender} 个、拟建重点前期线索 ${proposed} 个。`
  const scope = dataset.completeness === 'complete'
    ? `本轮 ${total} 个项目已全部完成人工复核。`
    : `本轮 ${total} 个项目中已有 ${reviewed} 个完成人工复核，另有 ${pending} 个待复核；以下结果只代表当前复核范围。`
  const failed = Object.entries(dataset.query.sources).filter(([, value]) => value?.status === 'failed').map(([source]) => source === 'tender' ? '招投标' : '拟建项目')
  return text(`${scope}${result}${failed.length === 0 ? '' : ` 本轮未覆盖：${failed.join('、')}。`}`)
}

function allocateCells(values: readonly number[], width: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) return values.map(() => 0)
  const raw = values.map(value => value / total * width)
  const allocated = raw.map(value => Math.floor(value))
  let remaining = width - allocated.reduce((sum, value) => sum + value, 0)
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (const item of order) {
    if (remaining <= 0) break
    if ((values[item.index] ?? 0) > 0) { allocated[item.index] = (allocated[item.index] ?? 0) + 1; remaining -= 1 }
  }
  return allocated
}

function drawStackedBar(sheet: Worksheet, rowNumber: number, distribution: ReportDistributionV2): void {
  const startColumn = 2
  const width = 20
  const allocation = allocateCells(distribution.buckets.map(bucket => bucket.count), width)
  for (let offset = 0; offset < width; offset += 1) {
    sheet.getCell(rowNumber, startColumn + offset).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.grey } }
  }
  let cursor = 0
  allocation.forEach((count, index) => {
    for (let offset = 0; offset < count; offset += 1) {
      sheet.getCell(rowNumber, startColumn + cursor + offset).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CHART_COLORS[index % CHART_COLORS.length] ?? COLORS.teal } }
    }
    cursor += count
  })
  sheet.getRow(rowNumber).height = 18
}

function drawHorizontalBars(sheet: Worksheet, startRow: number, distribution: ReportDistributionV2): number {
  const maximum = Math.max(0, ...distribution.buckets.map(bucket => bucket.count))
  distribution.buckets.forEach((bucket, index) => {
    const row = startRow + index
    sheet.getCell(row, 1).value = bucket.label
    sheet.getCell(row, 1).font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.ink } }
    const cells = maximum === 0 ? 0 : Math.round(bucket.count / maximum * 20)
    for (let offset = 0; offset < 20; offset += 1) {
      sheet.getCell(row, 2 + offset).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: offset < cells ? CHART_COLORS[index % CHART_COLORS.length] ?? COLORS.teal : COLORS.grey } }
    }
    sheet.getCell(row, 22).value = bucket.count
    sheet.getCell(row, 22).alignment = { horizontal: 'right' }
    sheet.getRow(row).height = 17
  })
  return startRow + distribution.buckets.length
}

function addOverview(workbook: ExcelJS.Workbook, dataset: ReportDatasetV2): void {
  const sheet = workbook.addWorksheet('交付总览', { views: [{ showGridLines: false }] })
  for (let column = 2; column <= 21; column += 1) sheet.getColumn(column).width = 2.4
  sheet.getColumn(1).width = 19
  sheet.getColumn(22).width = 10
  sheet.getColumn(23).width = 20
  sheet.getColumn(24).width = 20
  styleTitle(sheet, 'A1:X1', '招投标机会筛选结果报告')
  sheet.mergeCells('A2:X2')
  sheet.getCell('A2').value = `${dataset.completeness === 'complete' ? '完整报告' : '阶段性报告'}  |  生成时间 ${formatReportDateTime(dataset.createdAt)}  |  本轮目标：${text(dataset.query.targetSummary)}`
  sheet.getCell('A2').font = { name: 'Microsoft YaHei', size: 10, color: { argb: COLORS.muted } }
  sheet.mergeCells('A3:X3')
  sheet.getCell('A3').value = overallSummary(dataset)
  sheet.getCell('A3').alignment = { wrapText: true, vertical: 'middle' }
  sheet.getRow(3).height = 34

  const metrics = [
    ['正式候选', 'confirmed-tender', COLORS.greenSoft],
    ['拟建重点线索', 'priority-proposed', COLORS.blueSoft],
    ['观察', 'user-watch', COLORS.amberSoft],
    ['待复核', 'pending-review', COLORS.purpleSoft],
  ] as const
  const metricRanges = [['A5:F5', 'A6:F7'], ['G5:L5', 'G6:L7'], ['M5:R5', 'M6:R7'], ['S5:X5', 'S6:X7']] as const
  metrics.forEach(([label, id, fill], index) => {
    const ranges = metricRanges[index]
    if (ranges === undefined) return
    sheet.mergeCells(ranges[0]); sheet.mergeCells(ranges[1])
    const labelCell = sheet.getCell(ranges[0].split(':')[0] ?? 'A5')
    const valueCell = sheet.getCell(ranges[1].split(':')[0] ?? 'A6')
    labelCell.value = label
    valueCell.value = metricValueOf(dataset, id).value
    ;[labelCell, valueCell].forEach((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; cell.alignment = { horizontal: 'center', vertical: 'middle' } })
    labelCell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: COLORS.muted } }
    valueCell.font = { name: 'Microsoft YaHei', size: 22, bold: true, color: { argb: COLORS.ink } }
  })

  const review = distributionOf(dataset, 'review-decisions')
  sheet.mergeCells('A9:X9'); sheet.getCell('A9').value = '人工确认结果结构'; sheet.getCell('A9').font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: COLORS.ink } }
  drawStackedBar(sheet, 10, review)
  review.buckets.forEach((bucket, index) => {
    const start = 1 + index * 6
    sheet.mergeCells(12, start, 12, Math.min(start + 4, 24))
    const cell = sheet.getCell(12, start)
    cell.value = `${bucket.label} ${bucket.count}`
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CHART_COLORS[index % CHART_COLORS.length] ?? COLORS.teal } }
    cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.white } }
    cell.alignment = { horizontal: 'center' }
  })

  const deadline = distributionOf(dataset, 'tender-deadline-window')
  sheet.mergeCells('A14:X14'); sheet.getCell('A14').value = '正式候选截止窗口'; sheet.getCell('A14').font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: COLORS.ink } }
  const afterDeadline = drawHorizontalBars(sheet, 15, deadline)
  sheet.mergeCells(afterDeadline + 1, 1, afterDeadline + 1, 24)
  sheet.getCell(afterDeadline + 1, 1).value = '近期需核验只表示截止紧迫性或信息新近程度，不是商业价值排名。'
  sheet.getCell(afterDeadline + 1, 1).font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.muted } }

  const priorityStart = afterDeadline + 3
  sheet.mergeCells(priorityStart, 1, priorityStart, 24)
  sheet.getCell(priorityStart, 1).value = '近期需核验摘要'
  sheet.getCell(priorityStart, 1).font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: COLORS.ink } }
  sheet.addRow([])
  const headers = ['来源', '项目', '单位', '金额', '截止/更新', '核验事项']
  const headerRow = sheet.getRow(priorityStart + 1)
  ;[[1, 2], [3, 9], [10, 13], [14, 16], [17, 19], [20, 24]].forEach(([start, end], index) => {
    sheet.mergeCells(priorityStart + 1, start as number, priorityStart + 1, end as number)
    const cell = sheet.getCell(priorityStart + 1, start as number)
    cell.value = headers[index]
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealSoft } }
    cell.font = { name: 'Microsoft YaHei', bold: true, size: 9, color: { argb: COLORS.ink } }
  })
  headerRow.height = 24
  const byRef = new Map(dataset.rows.map(row => [row.project.recordId, row]))
  dataset.homepageRecordRefs.forEach((ref, index) => {
    const row = byRef.get(ref)
    if (row === undefined) return
    const rowNumber = priorityStart + 2 + index
    const values = [
      row.project.source === 'tender' ? '招投标' : '拟建', text(row.project.title), fieldText(row.project.counterparty),
      amountText(row), row.project.source === 'tender' ? dateText(row.project.deadline) : dateText(row.project.publishedAt), verification(row),
    ]
    ;[[1, 2], [3, 9], [10, 13], [14, 16], [17, 19], [20, 24]].forEach(([start, end], valueIndex) => {
      sheet.mergeCells(rowNumber, start as number, rowNumber, end as number)
      const cell = sheet.getCell(rowNumber, start as number)
      cell.value = values[valueIndex] ?? ''
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.ink } }
    })
    sheet.getRow(rowNumber).height = 36
  })
  if (dataset.homepageRecordRefs.length === 0) {
    sheet.mergeCells(priorityStart + 2, 1, priorityStart + 2, 24)
    sheet.getCell(priorityStart + 2, 1).value = '本次已复核范围内尚未形成人工确认候选。'
  }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, printArea: `A1:X${priorityStart + Math.max(3, dataset.homepageRecordRefs.length) + 2}`, margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.15, footer: 0.15 } }
  sheet.headerFooter.oddFooter = '&C招投标机会筛选结果报告  &P / &N'
}

function sectionHeading(sheet: Worksheet, row: number, title: string): void {
  sheet.mergeCells(row, 1, row, 24)
  const cell = sheet.getCell(row, 1)
  cell.value = title
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealSoft } }
  cell.font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: COLORS.ink } }
  cell.alignment = { vertical: 'middle' }
  sheet.getRow(row).height = 26
}

function addDistributionBlock(sheet: Worksheet, startRow: number, distribution: ReportDistributionV2): number {
  sectionHeading(sheet, startRow, distribution.label)
  if (distribution.buckets.length === 0 || distribution.buckets.every(bucket => bucket.count === 0)) {
    sheet.mergeCells(startRow + 1, 1, startRow + 1, 24)
    sheet.getCell(startRow + 1, 1).value = '本轮没有可用于该分布的记录。'
    sheet.getCell(startRow + 1, 1).font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.muted } }
    return startRow + 3
  }
  const end = drawHorizontalBars(sheet, startRow + 1, distribution)
  sheet.mergeCells(end, 1, end, 24)
  sheet.getCell(end, 1).value = `${distribution.scopeDescription}${distribution.missingCount === undefined || distribution.missingCount === 0 ? '' : ` 未披露 ${distribution.missingCount}。`}${distribution.limitation === undefined ? '' : ` ${distribution.limitation}`}`
  sheet.getCell(end, 1).font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.muted } }
  sheet.getCell(end, 1).alignment = { wrapText: true }
  return end + 2
}

function addResultDistributions(workbook: ExcelJS.Workbook, dataset: ReportDatasetV2): void {
  const sheet = workbook.addWorksheet('结果分布', { views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }] })
  sheet.getColumn(1).width = 24
  for (let column = 2; column <= 21; column += 1) sheet.getColumn(column).width = 2.4
  sheet.getColumn(22).width = 10
  styleTitle(sheet, 'A1:X1', '结果分布')
  let row = 3
  ;['tender-deadline-window', 'confirmed-regions', 'tender-procurement-methods', 'tender-procurement-types', 'tender-industries', 'proposed-project-stages', 'proposed-approval-progress']
    .forEach((id) => { row = addDistributionBlock(sheet, row, distributionOf(dataset, id)) })
  dataset.amountDistributions.forEach((distribution) => {
    sectionHeading(sheet, row, distribution.source === 'tender' ? '正式候选预算分布' : '拟建重点线索总投资分布')
    const buckets = [
      ...distribution.bands.filter(band => band.count > 0),
      { id: 'indeterminate', label: '区间暂无法确定', count: distribution.indeterminateCount },
      { id: 'missing', label: '来源未披露', count: distribution.missingCount },
      { id: 'unparseable', label: '来源已披露，暂无法解析', count: distribution.unparseableCount },
    ]
    row = drawHorizontalBars(sheet, row + 1, { id: 'amount', label: '金额', scopeDescription: '', buckets }) + 1
    sheet.mergeCells(row, 1, row, 24)
    const axis = distribution.axis === undefined ? '没有可用的金额分档轴。' : `金额分档轴：${formatAmountAxis(distribution.axis)}。`
    sheet.getCell(row, 1).value = `${axis} ${distribution.medianCny === undefined ? '没有可计算中位数的单一金额。' : `可解析单值中位数：${Math.round(distribution.medianCny).toLocaleString('zh-CN')} 元。`} ${distribution.limitation}`
    sheet.getCell(row, 1).font = { name: 'Microsoft YaHei', size: 9, color: { argb: COLORS.muted } }
    row += 2
  })
  if (dataset.narrative !== undefined) {
    sectionHeading(sheet, row, '补充分析观察')
    const observations = [
      ...(dataset.narrative.executiveSummary === undefined ? [] : [dataset.narrative.executiveSummary]),
      ...dataset.narrative.keyFindings,
      ...dataset.narrative.risksAndLimitations,
    ]
    observations.forEach((item) => {
      row += 1
      sheet.mergeCells(row, 1, row, 5); sheet.getCell(row, 1).value = text(item.title)
      sheet.mergeCells(row, 6, row, 24); sheet.getCell(row, 6).value = text(item.statement)
      sheet.getRow(row).height = 34
    })
    row += 2
  }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:X${row}`, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } }
  sheet.headerFooter.oddFooter = '&C招投标机会筛选结果报告  &P / &N'
}

function traceValues(row: ReviewRecordV1): CellValue[] {
  return [
    text(row.project.recordId), row.project.source === 'tender' ? '招投标' : '拟建项目', text(row.project.title),
    '已完成结构化处理', classificationLabel(row), text(row.finalRuleId), recommendationLabel(row),
    text(row.recommendation?.reason), text(row.recommendation?.evidence.map(item => `${item.label}：${item.value}`).join('；')),
    verification(row), text(row.recommendation?.limitations.join('；')), decisionLabel(row), note(row),
    text(row.project.amount.original), text(row.project.amount.parseStatus), text(row.project.publishedAt.original),
    text(row.project.publishedAt.value), text(row.project.deadline?.original), text(row.project.deadline?.value),
    text(row.project.announcements.map(item => item.sourceRecordId).join('；')),
    text(row.project.announcements.map(item => item.lifecycle).join('；')),
  ]
}

function addDataQuality(workbook: ExcelJS.Workbook, dataset: ReportDatasetV2): void {
  const sheet = workbook.addWorksheet('数据质量与口径', { views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }] })
  styleTitle(sheet, 'A1:H1', '数据质量与口径')
  const scope = dataset.query.scope === 'combined' ? '招投标与拟建项目' : dataset.query.scope === 'tender' ? '招投标' : '拟建项目'
  sheet.addRow(['本轮筛选目标', text(dataset.query.targetSummary), '来源范围', scope, '报告状态', dataset.completeness === 'complete' ? '完整报告' : '阶段性报告', '生成时间', formatReportDateTime(dataset.createdAt)])
  sheet.addRow(['来源覆盖', text(Object.entries(dataset.query.sources).map(([source, value]) => `${source === 'tender' ? '招投标' : '拟建项目'}：${value?.status === 'succeeded' ? `成功加载 ${value.loaded}` : '本轮未覆盖'}`).join('；')), '', '', '', '', '', ''])
  sheet.addRow([])
  sheet.addRow(['指标', '值', '单位', '分子', '分母', '统计范围与说明', '局限', '指标 id'])
  dataset.metricDefinitions.forEach((definition) => {
    const value = metricValueOf(dataset, definition.id)
    const row = sheet.addRow([definition.label, value.value, definition.unit, value.numerator ?? null, value.denominator ?? null, text(`${definition.description} ${definition.scopeDescription}`), text(definition.limitation), definition.id])
    row.getCell(2).numFmt = definition.unit === 'percent' ? '0.0%' : definition.unit === 'currency' ? '#,##0' : '0'
  })
  sheet.addRow([])
  sheet.addRow(['项目记录 id', '项目', '来源', '未披露字段', '暂无法解析字段', '来源记录 id', '说明', ''])
  dataset.rows.filter(row => row.project.disclosure.missingFields.length > 0 || row.project.disclosure.unparseableFields.length > 0)
    .forEach((row) => {
      sheet.addRow([row.project.recordId, text(row.project.title), row.project.source === 'tender' ? '招投标' : '拟建项目', text(row.project.disclosure.missingFields.join('；')), text(row.project.disclosure.unparseableFields.join('；')), text(row.project.sourceId), '未披露不表示来源错误；无法解析值保留来源原文。', ''])
    })
  dataset.invalidRecords.forEach((invalid) => {
    sheet.addRow([`index:${invalid.index}`, text(invalid.rawPreview), invalid.source === 'tender' ? '招投标' : '拟建项目', '', text(invalid.message), '', '该来源记录存在数据异常，未进入业务项目清单。', text(invalid.code)])
  })
  ;[25, 20, 14, 18, 18, 58, 52, 24].forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  ;[2, 3, 5].forEach((rowNumber) => {
    const row = sheet.getRow(rowNumber)
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealSoft } }
    row.font = { name: 'Microsoft YaHei', bold: true, color: { argb: COLORS.ink } }
  })
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.font = row.font ?? { name: 'Microsoft YaHei', size: 10, color: { argb: COLORS.ink } }
    row.alignment = { vertical: 'top', wrapText: true }
  })
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  sheet.headerFooter.oddFooter = '&C招投标机会筛选结果报告  &P / &N'
}

function historicalRows(rows: readonly ReviewRecordV1[]): ReviewRecordV1[] {
  return rows.filter(row => row.project.lifecycle === 'awarded' || row.project.lifecycle === 'contracted'
    || row.project.announcements.some(announcement => announcement.lifecycle === 'awarded' || announcement.lifecycle === 'contracted'))
}

function historySheetName(rows: readonly ReviewRecordV1[]): string {
  const hasCompetitionFacts = rows.some(row => (row.project.tenderDetails?.awardees.length ?? 0) > 0
    && row.project.amount.type === 'award' && row.project.publishedAt.value !== undefined)
  return hasCompetitionFacts ? '历史结果与竞争线索' : '历史结果记录'
}

function historyValues(row: ReviewRecordV1): CellValue[] {
  return [
    text(row.project.title), fieldText(row.project.counterparty), entities(row.project.tenderDetails?.awardees),
    amountText(row), dateText(row.project.publishedAt), fieldText(row.project.region),
    fieldText(row.project.tenderDetails?.procurementType), linkValue(row), text(row.project.sourceId),
  ]
}

export async function renderReportExcel(dataset: ReportDatasetV2, signal: AbortSignal): Promise<RenderedReportFile> {
  signal.throwIfAborted()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'dsh-tender-workbench'
  workbook.created = new Date(dataset.createdAt)
  workbook.modified = new Date(dataset.createdAt)
  workbook.subject = dataset.completeness === 'complete' ? '完整机会筛选结果' : '阶段性机会筛选结果'
  workbook.title = '招投标机会筛选结果报告'
  workbook.company = 'DeepSeek Harness'

  addOverview(workbook, dataset)
  addResultDistributions(workbook, dataset)
  const confirmedTender = dataset.rows.filter(row => row.project.source === 'tender' && row.review.decision === 'confirmed-candidate')
  const confirmedProposed = dataset.rows.filter(row => row.project.source === 'proposed' && row.review.decision === 'confirmed-candidate')
  const tenderSheet = addTableSheet(workbook, '正式招投标候选', TENDER_HEADERS, confirmedTender.map(row => tenderValues(row, dataset.createdAt)), TENDER_WIDTHS)
  ;[6, 7].forEach(column => { tenderSheet.getColumn(column).numFmt = '#,##0' })
  const proposedSheet = addTableSheet(workbook, '拟建重点线索', PROPOSED_HEADERS, confirmedProposed.map(proposedValues), PROPOSED_WIDTHS)
  ;[6, 7].forEach(column => { proposedSheet.getColumn(column).numFmt = '#,##0' })
  addTableSheet(workbook, '待复核', GENERIC_HEADERS, dataset.rows.filter(row => row.review.decision === 'pending').map(row => genericValues(row, dataset.createdAt)), GENERIC_WIDTHS)
  addTableSheet(workbook, '观察项目', GENERIC_HEADERS, dataset.rows.filter(row => row.review.decision === 'watch').map(row => genericValues(row, dataset.createdAt)), GENERIC_WIDTHS)
  addTableSheet(workbook, '排除项目', GENERIC_HEADERS, dataset.rows.filter(row => row.review.decision === 'exclude').map(row => genericValues(row, dataset.createdAt)), GENERIC_WIDTHS)
  addTableSheet(workbook, '全量项目', GENERIC_HEADERS, dataset.rows.map(row => genericValues(row, dataset.createdAt)), GENERIC_WIDTHS)
  addTableSheet(workbook, '决策追溯', [
    '项目记录 id', '来源', '项目名称', '数据处理状态', '规则初筛', '生效规则 id', '补充分析建议',
    '建议理由', '引用证据', '待核验事项', '建议局限', '人工确认结论', '用户备注', '金额原值',
    '金额解析状态', '发布时间原值', '发布时间规范值', '截止时间原值', '截止时间规范值', '关联来源记录 id', '关联生命周期',
  ], dataset.rows.map(traceValues), [24, 12, 42, 16, 16, 20, 18, 38, 48, 38, 34, 18, 34, 22, 18, 20, 20, 20, 20, 36, 30])
  addDataQuality(workbook, dataset)
  const history = historicalRows(dataset.rows)
  if (history.length > 0) {
    addTableSheet(workbook, historySheetName(history), [
      '项目名称', '采购人', '中标单位', '结果金额', '结果时间', '地区', '招采类型', '来源链接', '来源记录 id',
    ], history.map(historyValues), [42, 26, 28, 20, 20, 20, 16, 14, 22])
  }
  signal.throwIfAborted()
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  signal.throwIfAborted()
  const timestamp = dataset.createdAt.replaceAll(/[:.]/gu, '-').slice(0, 19)
  return {
    bytes,
    fileName: `招投标机会筛选结果-${dataset.completeness}-${timestamp}.xlsx`,
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}
