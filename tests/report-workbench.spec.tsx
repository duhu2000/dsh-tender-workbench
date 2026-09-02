// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyTenderWorkflowProjection, type TenderWorkflowProjectionV1 } from '../src/contracts/workflow.ts'
import { zh, type TenderKey } from '../src/client/locales.ts'
import { TenderReportView } from '../src/client/workbench/TenderReportView.tsx'
import type { SessionWriteFlight } from '../src/client/workbench/session-write-flight.ts'

const t = ((key: TenderKey, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  Object.entries(params ?? {}).forEach(([name, replacement]) => { value = value.replaceAll(`{${name}}`, String(replacement)) })
  return value
}) as TranslateNS<'tenderFilter'>

afterEach(() => cleanup())

function artifact(kind: 'query-spec' | 'normalized-data' | 'review-data' | 'final-snapshot' | 'excel' | 'pdf', id: string) {
  return {
    id, kind, fileName: `${id}.${kind === 'excel' ? 'xlsx' : kind === 'pdf' ? 'pdf' : 'json'}`,
    mediaType: kind === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : kind === 'pdf' ? 'application/pdf' : 'application/json',
    createdAt: '2026-09-02T00:00:00.000Z', accessToken: `token-${id}`,
  }
}

function workflow(report?: TenderWorkflowProjectionV1['report']): TenderWorkflowProjectionV1 {
  const base = createEmptyTenderWorkflowProjection()
  return {
    ...base,
    revision: report === undefined ? 4 : 5,
    currentStage: report === undefined ? 'review' : 'report',
    stages: {
      ...base.stages,
      query: { status: 'succeeded' }, overview: { status: 'succeeded' }, review: { status: 'succeeded' },
      report: report === undefined ? { status: 'not-started' } : { status: 'succeeded' },
    },
    query: {
      scope: 'combined', targetSummary: '数据项目', querySpec: artifact('query-spec', 'query'),
      sources: { tender: { status: 'succeeded', loaded: 3 }, proposed: { status: 'succeeded', loaded: 1 } },
      normalizedData: artifact('normalized-data', 'normalized'), total: 4, duplicateCount: 0, invalidCount: 0,
    },
    review: {
      revision: 2, data: artifact('review-data', 'review'), pending: 1, confirmedCandidate: 1, watch: 1, exclude: 1, canRevert: true,
    },
    ...(report === undefined ? {} : { report }),
  }
}

function writeFlight(start: SessionWriteFlight['start']): SessionWriteFlight {
  return { state: { sessionId: 'session-1' as never, phase: 'idle' }, busy: false, start, retry: () => false }
}

describe('S5 delivery workbench', () => {
  it('requires explicit pending confirmation and can choose deterministic generation without Agent narrative', () => {
    const sent: unknown[] = []
    const start = vi.fn<SessionWriteFlight['start']>((_action, build) => {
      sent.push(build('report-command'))
      return true
    })
    render(<TenderReportView sessionId={'session-1' as never} workflow={workflow()} write={writeFlight(start)} download={vi.fn()} t={t} />)
    const generate = screen.getByRole('button', { name: zh['workbench.report.generate'] })
    expect(generate.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: zh['workbench.report.includeNarrative'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: zh['workbench.report.confirmPending'].replace('{count}', '1') }))
    expect(generate.hasAttribute('disabled')).toBe(false)
    fireEvent.click(generate)
    expect(start).toHaveBeenCalledWith('report.create', expect.any(Function))
    expect(sent[0]).toMatchObject({
      kind: 'report.create', commandId: 'report-command', activeDatasetRef: 'normalized',
      reviewArtifactRef: 'review', reviewRevision: 2, projectionRevision: 4,
      confirmPending: true, includeNarrative: false,
    })
  })

  it('shows independent file states, retries only the failed format, and downloads the successful file', () => {
    const pdf = artifact('pdf', 'pdf')
    const report = {
      finalSnapshot: artifact('final-snapshot', 'snapshot-artifact'), finalSnapshotId: 'fs-current',
      completeness: 'partial' as const, createdAt: '2026-09-02T00:00:00.000Z',
      rawRecords: 4, normalizedProjects: 4, reviewed: 3, confirmedTender: 1, priorityProposed: 0,
      watch: 1, pending: 1, exclude: 1, analysisCompleted: 1, analysisTotal: 4,
      excel: { status: 'failed' as const, errorMessage: 'Excel renderer failed' },
      pdf: { status: 'succeeded' as const, artifact: pdf },
    }
    const sent: unknown[] = []
    const start = vi.fn<SessionWriteFlight['start']>((_action, build) => { sent.push(build('retry-command')); return true })
    const download = vi.fn(async () => undefined)
    render(<TenderReportView sessionId={'session-1' as never} workflow={workflow(report)} write={writeFlight(start)} download={download} t={t} />)
    expect(screen.getByText('Excel renderer failed')).toBeTruthy()
    expect(screen.getByText(zh['workbench.report.fileStatus.succeeded'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.report.retry'].replace('{format}', 'Excel') }))
    expect(sent[0]).toEqual({
      schemaVersion: 1, kind: 'report.retry', commandId: 'retry-command', projectionRevision: 5,
      finalSnapshotId: 'fs-current', formats: ['excel'],
    })
    fireEvent.click(screen.getByRole('button', { name: zh['workbench.report.download'].replace('{format}', 'PDF') }))
    expect(download).toHaveBeenCalledWith('session-1', pdf)
    expect(document.body.textContent).not.toMatch(/已完成 Bid\/No-Bid|已决定投标/u)
  })
})
