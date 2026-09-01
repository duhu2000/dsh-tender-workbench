import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ArtifactRowsPageV1Schema,
  type ArtifactRowsFilterV1,
  type ArtifactRowsPageV1,
} from '../contracts/dataset.ts'
import type { ArtifactRefV1 } from '../contracts/workflow.ts'
import {
  ClassifiedRowsPageV1Schema,
  RuleArtifactContentV1Schema,
  type ClassifiedRowsFilterV1,
  type ClassifiedRowsPageV1,
  type RuleArtifactContentV1,
} from '../contracts/screening.ts'

const ARTIFACT_ROUTE_PREFIX = '/dsh-tender-workbench/api/v1/artifacts'

export class ArtifactApiError extends Error {
  constructor(readonly status: number, message = 'Artifact 读取失败。') {
    super(message)
    this.name = 'ArtifactApiError'
  }
}

export type ArtifactFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function rowsParameters(filter: ArtifactRowsFilterV1): URLSearchParams {
  const parameters = new URLSearchParams({
    page: String(filter.page),
    pageSize: String(filter.pageSize),
  })
  if (filter.query !== undefined) parameters.set('q', filter.query)
  if (filter.source !== undefined) parameters.set('source', filter.source)
  if (filter.lifecycle !== undefined) parameters.set('lifecycle', filter.lifecycle)
  if (filter.fieldStatus !== undefined) parameters.set('fieldStatus', filter.fieldStatus)
  if (filter.region !== undefined) parameters.set('region', filter.region)
  if (filter.sort !== undefined) parameters.set('sort', filter.sort)
  return parameters
}

export async function fetchArtifactRows(
  fetcher: ArtifactFetch,
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  filter: ArtifactRowsFilterV1,
  signal?: AbortSignal,
): Promise<ArtifactRowsPageV1> {
  const response = await fetcher(
    `${ARTIFACT_ROUTE_PREFIX}/${encodeURIComponent(artifact.id)}/rows?${rowsParameters(filter)}`,
    {
      method: 'GET',
      headers: {
        'X-Dsh-Tender-Session': String(sessionId),
        'X-Dsh-Tender-Artifact-Token': artifact.accessToken,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    },
  )
  if (!response.ok) throw new ArtifactApiError(response.status)
  const value: unknown = await response.json()
  return ArtifactRowsPageV1Schema.parse(value)
}

function classifiedRowsParameters(filter: ClassifiedRowsFilterV1): URLSearchParams {
  const parameters = new URLSearchParams({ page: String(filter.page), pageSize: String(filter.pageSize) })
  if (filter.query !== undefined) parameters.set('q', filter.query)
  if (filter.source !== undefined) parameters.set('source', filter.source)
  if (filter.classification !== undefined) parameters.set('classification', filter.classification)
  if (filter.ruleId !== undefined) parameters.set('ruleId', filter.ruleId)
  if (filter.conflict !== undefined) parameters.set('conflict', String(filter.conflict))
  if (filter.fieldStatus !== undefined) parameters.set('fieldStatus', filter.fieldStatus)
  return parameters
}

function artifactHeaders(sessionId: SessionId, artifact: ArtifactRefV1): HeadersInit {
  return {
    'X-Dsh-Tender-Session': String(sessionId),
    'X-Dsh-Tender-Artifact-Token': artifact.accessToken,
  }
}

export async function fetchClassifiedArtifactRows(
  fetcher: ArtifactFetch,
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  filter: ClassifiedRowsFilterV1,
  signal?: AbortSignal,
): Promise<ClassifiedRowsPageV1> {
  const response = await fetcher(
    `${ARTIFACT_ROUTE_PREFIX}/${encodeURIComponent(artifact.id)}/rows?${classifiedRowsParameters(filter)}`,
    {
      method: 'GET',
      headers: artifactHeaders(sessionId, artifact),
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    },
  )
  if (!response.ok) throw new ArtifactApiError(response.status)
  const value: unknown = await response.json()
  return ClassifiedRowsPageV1Schema.parse(value)
}

export async function fetchRuleArtifactContent(
  fetcher: ArtifactFetch,
  sessionId: SessionId,
  artifact: ArtifactRefV1,
  signal?: AbortSignal,
): Promise<RuleArtifactContentV1> {
  const response = await fetcher(
    `${ARTIFACT_ROUTE_PREFIX}/${encodeURIComponent(artifact.id)}/content`,
    {
      method: 'GET',
      headers: artifactHeaders(sessionId, artifact),
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    },
  )
  if (!response.ok) throw new ArtifactApiError(response.status)
  const value: unknown = await response.json()
  return RuleArtifactContentV1Schema.parse(value)
}
