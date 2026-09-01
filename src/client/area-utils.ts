import { AREA_OPTIONS, type AreaOption } from './area-data.ts'

export interface AreaRecord {
  readonly option: AreaOption
  readonly path: readonly AreaOption[]
}

const AREA_RECORDS = new Map<string, AreaRecord>()
const UNSUPPORTED_MCP_ROOTS = new Set(['香港特别行政区', '澳门特别行政区', '台湾省'])

function visit(options: readonly AreaOption[], parents: readonly AreaOption[]): void {
  for (const option of options) {
    const path = [...parents, option]
    AREA_RECORDS.set(option.value, { option, path })
    if (option.children !== undefined) visit(option.children, path)
  }
}

visit(AREA_OPTIONS, [])

export function getAreaRecord(value: string): AreaRecord | undefined {
  return AREA_RECORDS.get(value)
}

/** Current qcc-tender search Schema accepts mainland province/city/district names only. */
export function isMcpSupportedAreaValue(value: string): boolean {
  const root = getAreaRecord(value)?.path[0]?.label
  return root !== undefined && !UNSUPPORTED_MCP_ROOTS.has(root)
}

export function formatAreaPath(value: string): string | undefined {
  const record = getAreaRecord(value)
  return record?.path.map(option => option.label).join('-')
}

export function formatAreaSelections(values: readonly string[]): string | undefined {
  const labels = values.flatMap(value => {
    const label = formatAreaPath(value)
    return label === undefined ? [] : [label]
  })
  return labels.length === 0 ? undefined : labels.join('、')
}

function isAncestor(ancestor: AreaRecord, descendant: AreaRecord): boolean {
  return descendant.path.some(option => option.value === ancestor.option.value)
}

/** Keep selections canonical: choosing a parent replaces descendants and vice versa. */
export function toggleAreaSelection(values: readonly string[], value: string): string[] {
  if (values.includes(value)) return values.filter(candidate => candidate !== value)
  const nextRecord = getAreaRecord(value)
  if (nextRecord === undefined) return [...values]
  const withoutRelated = values.filter(candidate => {
    const candidateRecord = getAreaRecord(candidate)
    if (candidateRecord === undefined) return true
    return !isAncestor(candidateRecord, nextRecord) && !isAncestor(nextRecord, candidateRecord)
  })
  return [...withoutRelated, value]
}

export function hasSelectedDescendant(values: readonly string[], value: string): boolean {
  const record = getAreaRecord(value)
  if (record === undefined) return false
  return values.some(candidate => {
    if (candidate === value) return false
    const candidateRecord = getAreaRecord(candidate)
    return candidateRecord !== undefined && isAncestor(record, candidateRecord)
  })
}

export function searchAreas(query: string, limit = 60): AreaRecord[] {
  const keyword = query.trim().toLocaleLowerCase()
  if (keyword === '') return []
  const results: AreaRecord[] = []
  for (const record of AREA_RECORDS.values()) {
    if (!isMcpSupportedAreaValue(record.option.value)) continue
    const path = record.path.map(option => option.label).join('-').toLocaleLowerCase()
    if (path.includes(keyword)) results.push(record)
    if (results.length >= limit) break
  }
  return results
}
