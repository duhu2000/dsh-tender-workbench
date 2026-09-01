import { z } from 'zod'
import type { TechnicalInvalidRecordV1 } from '../../contracts/dataset.ts'

const sourceText = z.string().max(32_768)
const requiredSourceText = sourceText.refine(value => value.trim() !== '', 'required source identifier is empty')
const sourceEntitySchema = z.object({
  企业ID: sourceText,
  企业名称: sourceText,
}).passthrough()
const sourceEntitiesSchema = z.array(sourceEntitySchema).max(500)
const sourceStringsSchema = z.array(sourceText).max(500)

const querySummarySchema = z.object({
  命中总数: z.number().finite().nonnegative(),
  结果说明: sourceText,
  生效筛选: z.record(z.string(), z.unknown()),
}).passthrough()

export const QccTenderItemSchema = z.object({
  标讯ID: requiredSourceText,
  标题: requiredSourceText,
  信息类型: sourceText.optional(),
  公告子状态: sourceText.optional(),
  省市区: sourceText.optional(),
  招采单位: sourceEntitiesSchema.optional(),
  代理单位: sourceEntitiesSchema.optional(),
  中标单位: sourceEntitiesSchema.optional(),
  招采方式: sourceText.optional(),
  招采类型: sourceText.optional(),
  标讯行业分类: sourceStringsSchema.optional(),
  项目编号: sourceText.optional(),
  '预算金额（元）': sourceText.optional(),
  '中标金额（元）': sourceText.optional(),
  发布时间: sourceText.optional(),
  投标截止时间: sourceText.optional(),
  相关产品: sourceStringsSchema.optional(),
  关联项目ID: sourceText.optional(),
  项目ID: sourceText.optional(),
  来源链接: sourceText.optional(),
  原文链接: sourceText.optional(),
  链接: sourceText.optional(),
}).passthrough()

export const QccProposedItemSchema = z.object({
  拟建项目ID: requiredSourceText,
  项目名称: requiredSourceText,
  项目阶段: sourceText.optional(),
  审批进度: sourceText.optional(),
  省市区: sourceText.optional(),
  '项目总投资（元）': sourceText.optional(),
  发布时间: sourceText.optional(),
  建设单位: sourceEntitiesSchema.optional(),
  审批单位: sourceEntitiesSchema.optional(),
  项目编号: sourceText.optional(),
  关联项目ID: sourceText.optional(),
  来源链接: sourceText.optional(),
  原文链接: sourceText.optional(),
  链接: sourceText.optional(),
}).passthrough()

const qccTenderPayloadEnvelopeSchema = z.object({
  查询摘要: querySummarySchema,
  标讯列表: z.array(z.unknown()).max(20_000),
}).passthrough()

const qccProposedPayloadEnvelopeSchema = z.object({
  查询摘要: querySummarySchema,
  拟建项目列表: z.array(z.unknown()).max(20_000),
}).passthrough()

export type QccTenderSourceItem = z.infer<typeof QccTenderItemSchema>
export type QccProposedSourceItem = z.infer<typeof QccProposedItemSchema>
export type QccQuerySummary = z.infer<typeof querySummarySchema>

export interface AdaptedQccSource<T> {
  readonly summary: QccQuerySummary
  readonly items: readonly T[]
  readonly invalidRecords: readonly TechnicalInvalidRecordV1[]
  readonly rawRecordCount: number
}

export class QccSourceContractError extends Error {
  constructor(readonly code: 'invalid-tender-payload' | 'invalid-proposed-payload') {
    super(code)
    this.name = 'QccSourceContractError'
  }
}

function preview(value: unknown): string {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return String(value).slice(0, 2_048)
    return serialized.length <= 2_048 ? serialized : `${serialized.slice(0, 2_047)}…`
  } catch {
    return '[unserializable source value]'
  }
}

function adaptItems<T>(
  source: TechnicalInvalidRecordV1['source'],
  values: readonly unknown[],
  schema: z.ZodType<T>,
): Pick<AdaptedQccSource<T>, 'items' | 'invalidRecords' | 'rawRecordCount'> {
  const items: T[] = []
  const invalidRecords: TechnicalInvalidRecordV1[] = []
  values.forEach((value, index) => {
    const parsed = schema.safeParse(value)
    if (parsed.success) {
      items.push(parsed.data)
      return
    }
    invalidRecords.push({
      source,
      index,
      code: 'invalid-item-schema',
      message: '来源记录违反已确认的字段类型或缺少必要标识，未进入规范化项目。',
      rawPreview: preview(value),
    })
  })
  return { items, invalidRecords, rawRecordCount: values.length }
}

export function adaptQccTenderPayload(value: unknown): AdaptedQccSource<QccTenderSourceItem> {
  const envelope = qccTenderPayloadEnvelopeSchema.safeParse(value)
  if (!envelope.success) throw new QccSourceContractError('invalid-tender-payload')
  return {
    summary: envelope.data.查询摘要,
    ...adaptItems('tender', envelope.data.标讯列表, QccTenderItemSchema),
  }
}

export function adaptQccProposedPayload(value: unknown): AdaptedQccSource<QccProposedSourceItem> {
  const envelope = qccProposedPayloadEnvelopeSchema.safeParse(value)
  if (!envelope.success) throw new QccSourceContractError('invalid-proposed-payload')
  return {
    summary: envelope.data.查询摘要,
    ...adaptItems('proposed', envelope.data.拟建项目列表, QccProposedItemSchema),
  }
}
