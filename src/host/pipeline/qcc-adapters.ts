import { z } from 'zod'
import type { TechnicalInvalidRecordV1 } from '../../contracts/dataset.ts'

const sourceText = z.string().max(32_768)
const requiredSourceText = sourceText.refine(value => value.trim() !== '', 'required source identifier is empty')
const optionalSourceText = z.preprocess(value => value === null ? undefined : value, sourceText.optional())
const entitySourceText = optionalSourceText.transform(value => value ?? '')
const sourceEntitySchema = z.object({
  企业ID: entitySourceText,
  企业名称: entitySourceText,
}).passthrough()
const sourceEntitiesSchema = z.preprocess(
  value => value === null ? undefined : value,
  z.array(sourceEntitySchema).max(500).optional(),
)
const sourceStringsSchema = z.preprocess(
  value => value === null ? undefined : value,
  z.array(sourceText).max(500).optional(),
)

const querySummarySchema = z.object({
  命中总数: z.number().finite().nonnegative().optional(),
  结果说明: optionalSourceText,
  生效筛选: z.preprocess(
    value => value === null ? undefined : value,
    z.record(z.string(), z.unknown()).optional(),
  ),
}).passthrough()

export const QccTenderItemSchema = z.object({
  标讯ID: requiredSourceText,
  标题: requiredSourceText,
  信息类型: optionalSourceText,
  公告子状态: optionalSourceText,
  省市区: optionalSourceText,
  招采单位: sourceEntitiesSchema,
  代理单位: sourceEntitiesSchema,
  中标单位: sourceEntitiesSchema,
  招采方式: optionalSourceText,
  招采类型: optionalSourceText,
  标讯行业分类: sourceStringsSchema,
  项目编号: optionalSourceText,
  '预算金额（元）': optionalSourceText,
  '中标金额（元）': optionalSourceText,
  发布时间: optionalSourceText,
  投标截止时间: optionalSourceText,
  相关产品: sourceStringsSchema,
  关联项目ID: optionalSourceText,
  项目ID: optionalSourceText,
  来源链接: optionalSourceText,
  原文链接: optionalSourceText,
  链接: optionalSourceText,
}).passthrough()

export const QccProposedItemSchema = z.object({
  拟建项目ID: requiredSourceText,
  项目名称: requiredSourceText,
  项目阶段: optionalSourceText,
  审批进度: optionalSourceText,
  省市区: optionalSourceText,
  '项目总投资（元）': optionalSourceText,
  发布时间: optionalSourceText,
  建设单位: sourceEntitiesSchema,
  审批单位: sourceEntitiesSchema,
  项目编号: optionalSourceText,
  关联项目ID: optionalSourceText,
  来源链接: optionalSourceText,
  原文链接: optionalSourceText,
  链接: optionalSourceText,
}).passthrough()

const qccTenderPayloadEnvelopeSchema = z.object({
  查询摘要: z.unknown().optional(),
  标讯列表: z.preprocess(
    value => value === null ? [] : value,
    z.array(z.unknown()).max(20_000).default([]),
  ),
}).passthrough()

const qccProposedPayloadEnvelopeSchema = z.object({
  查询摘要: z.unknown().optional(),
  拟建项目列表: z.preprocess(
    value => value === null ? [] : value,
    z.array(z.unknown()).max(20_000).default([]),
  ),
}).passthrough()

export type QccTenderSourceItem = z.infer<typeof QccTenderItemSchema>
export type QccProposedSourceItem = z.infer<typeof QccProposedItemSchema>
export type QccQuerySummary = z.infer<typeof querySummarySchema>

export interface AdaptedQccSource<T> {
  readonly summary?: QccQuerySummary
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

function hasEnvelopeMarker(value: unknown, listKey: '标讯列表' | '拟建项目列表'): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (Object.hasOwn(value, '查询摘要') || Object.hasOwn(value, listKey))
}

export function adaptQccTenderPayload(value: unknown): AdaptedQccSource<QccTenderSourceItem> {
  if (!hasEnvelopeMarker(value, '标讯列表')) throw new QccSourceContractError('invalid-tender-payload')
  const envelope = qccTenderPayloadEnvelopeSchema.safeParse(value)
  if (!envelope.success) throw new QccSourceContractError('invalid-tender-payload')
  const summary = querySummarySchema.safeParse(envelope.data.查询摘要)
  return {
    ...(summary.success ? { summary: summary.data } : {}),
    ...adaptItems('tender', envelope.data.标讯列表, QccTenderItemSchema),
  }
}

export function adaptQccProposedPayload(value: unknown): AdaptedQccSource<QccProposedSourceItem> {
  if (!hasEnvelopeMarker(value, '拟建项目列表')) throw new QccSourceContractError('invalid-proposed-payload')
  const envelope = qccProposedPayloadEnvelopeSchema.safeParse(value)
  if (!envelope.success) throw new QccSourceContractError('invalid-proposed-payload')
  const summary = querySummarySchema.safeParse(envelope.data.查询摘要)
  return {
    ...(summary.success ? { summary: summary.data } : {}),
    ...adaptItems('proposed', envelope.data.拟建项目列表, QccProposedItemSchema),
  }
}
