import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'

async function pdfSpike(outputPath: string, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  const require = createRequire(import.meta.url)
  const packageRoot = dirname(dirname(require.resolve('@embedpdf/fonts-sc')))
  const document = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: '招投标候选分析报告', Author: 'dsh-tender-workbench' } })
  document.registerFont('NotoSansHans', join(packageRoot, 'fonts', 'NotoSansHans-Regular.otf'))
  const chunks: Buffer[] = []
  document.on('data', chunk => chunks.push(Buffer.from(chunk)))
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.once('end', () => resolve(Buffer.concat(chunks)))
    document.once('error', reject)
  })
  const onAbort = () => { document.destroy(signal.reason instanceof Error ? signal.reason : new Error('cancelled')) }
  signal.addEventListener('abort', onAbort, { once: true })
  const lines = [
    '招投标候选分析报告 - 中文字体与长文本验证',
    '候选筛选漏斗：原始记录 2,000 条，规范化项目 1,873 个；Agent 分析只覆盖用户明确选择的证据批次。',
    `统计口径与能力边界：${'不判断企业适配度、中标概率、利润、资格符合或 Bid/No-Bid。'.repeat(30)}`,
  ]
  document.font('NotoSansHans').fillColor('#1F303A').fontSize(11)
  lines.forEach((line, index) => {
    signal.throwIfAborted()
    document.fontSize(index === 0 ? 18 : 11).text(line, { lineGap: index === 0 ? 7 : 4 })
    document.moveDown(index === 0 ? 0.8 : 0.45)
  })
  document.end()
  try {
    const bytes = await completed
    signal.throwIfAborted()
    await writeFile(outputPath, bytes)
    return bytes
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function excelSpike(outputPath: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'dsh-tender-workbench reporting spike'
  const sheetNames = ['分析概况', '招投标候选', '拟建重点线索', '观察与待复核', '排除与异常', '全量规范化数据']
  sheetNames.forEach((name) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.addRow(['记录 id', '项目名称', '四层状态', '备注', '来源链接'])
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
    sheet.autoFilter = 'A1:E1'
  })
  const all = workbook.getWorksheet('全量规范化数据')
  if (all === undefined) throw new Error('missing spike sheet')
  for (let index = 0; index < 2_000; index += 1) {
    if (index % 100 === 0) signal.throwIfAborted()
    all.addRow([
      `record-${index + 1}`,
      `${index % 2 === 0 ? '数据治理平台' : '智算中心拟建'}项目 ${index + 1}`,
      '已规范化 / 初选 / 未分析 / pending',
      index === 0 ? `'=2+2 ${'长文本'.repeat(1_500)}` : index === 1 ? "'+SUM(A1:A2)" : '待人工核验',
      `https://example.test/source/${index + 1}`,
    ])
  }
  all.columns = [{ width: 18 }, { width: 32 }, { width: 36 }, { width: 60 }, { width: 42 }]
  all.getColumn(4).alignment = { wrapText: true, vertical: 'top' }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  signal.throwIfAborted()
  await writeFile(outputPath, bytes)
  return bytes
}

describe('S5 reporting library bounded spike', () => {
  it('generates real Chinese XLSX/PDF for 2,000 rows and long text, supports cancellation, and round-trips workbook structure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tender-reporting-spike-'))
    const xlsxPath = join(root, 'reporting-spike.xlsx')
    const pdfPath = join(root, 'reporting-spike.pdf')
    const controller = new AbortController()
    const [xlsx, pdf] = await Promise.all([
      excelSpike(xlsxPath, controller.signal),
      pdfSpike(pdfPath, controller.signal),
    ])
    expect(xlsx.byteLength).toBeGreaterThan(50_000)
    expect(pdf.byteLength).toBeGreaterThan(10_000)
    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(xlsx as never)
    expect(reloaded.worksheets.map(sheet => sheet.name)).toEqual([
      '分析概况', '招投标候选', '拟建重点线索', '观察与待复核', '排除与异常', '全量规范化数据',
    ])
    expect(reloaded.getWorksheet('全量规范化数据')?.rowCount).toBe(2_001)
    expect(String(reloaded.getWorksheet('全量规范化数据')?.getCell('D2').value)).toMatch(/^'=2\+2/u)
    expect(Buffer.from(pdf).subarray(0, 5).toString('ascii')).toBe('%PDF-')
    console.info(`REPORTING_SPIKE_DIR=${root}`)

    const cancelled = new AbortController()
    cancelled.abort(new Error('cancelled by test'))
    await expect(excelSpike(join(root, 'cancelled.xlsx'), cancelled.signal)).rejects.toThrow('cancelled')
    await expect(pdfSpike(join(root, 'cancelled.pdf'), cancelled.signal)).rejects.toThrow('cancelled')
  }, 30_000)
})
