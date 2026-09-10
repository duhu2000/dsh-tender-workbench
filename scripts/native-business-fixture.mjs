// Test-only driver copied into an isolated diagnostic plugin, never into npm.
// Real registered tools + real Agent/Session/projection/artifact persistence;
// only the QCC data source and direct user messages are synthetic. No model call.
import assert from 'node:assert/strict'

export async function runBusinessFixture(ctx, sessionId) {
  assert.ok(process.env.TENDER_FIXTURE_HOME && process.env.DSH_HOME === process.env.TENDER_FIXTURE_HOME)
  assert.ok(sessionId.startsWith('session-dsh-tender-workbench-'))
  const agent = ctx.agents.get(sessionId)
  assert.ok(agent, 'A real native Agent must own the fixture Session')
  const session = agent.session
  const tools = ctx.tools.schemas(agent).map(t => t.name).filter(n => n.startsWith('tender_workbench_'))
  assert.equal(tools.length, 13)
  const calls = []
  const payload = { 查询摘要: { 命中总数: 2, 结果说明: '隔离合成数据，非真实MCP', 生效筛选: {} }, 标讯列表: [
    { 标讯ID: 'fixture-1', 标题: '隔离数据治理项目', 信息类型: '招标公告', 发布时间: '2026-09-01' },
    { 标讯ID: 'fixture-2', 标题: '隔离物业项目', 信息类型: '招标公告', 发布时间: '2026-09-02' },
  ] }
  const name = 'mcp__qcc-tender__search_tenders'
  assert.equal(ctx.tools.get(name, agent), undefined, 'Never replace an installed real MCP tool')
  const stop = ctx.tools.register({ name, description: 'Isolated synthetic QCC fixture only',
    parameters: { type: 'object', properties: {}, additionalProperties: true },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute() { calls.push(name); return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload } },
  })
  let turn = 0, step = 0
  const begin = text => {
    turn++; step = 0
    session.append('turn/start', { turn })
    session.append('user/message', { role: 'user', id: 'fixture-user-' + turn, source: { kind: 'user' }, content: [{ type: 'text', text: '[隔离测试消息] ' + text }] }, { surfaceOp: 'append' })
  }
  const end = () => session.append('turn/end', { turn, reason: { kind: 'completed' } })
  const invoke = async (tool, args) => {
    step++
    const callId = 'fixture-' + turn + '-' + step
    session.append('tool/call', { turn, step, callId, name: tool, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ name: tool, arguments: args, callId, agent, signal: AbortSignal.timeout(30000) })
    assert.equal(result.isError, false, tool + ': ' + JSON.stringify(result.error ?? result.content))
    session.append('tool/result', { turn, step,
      message: { source: { type: 'tool-result', callId }, content: [{ type: 'tool-result', content: result.content }] },
      ...(result.meta === undefined ? {} : { meta: result.meta }),
    }, { surfaceOp: 'append' })
    return result.value
  }
  const state = () => ctx.sessionProjections.stateOf(session, 'dshTenderWorkflow')
  const binding = () => ({ schemaVersion: 2, origin: { kind: 'conversation' }, activeDatasetRef: state().query.normalizedData.id, projectionRevision: state().revision })
  try {
    begin('查询隔离数据项目')
    const query = await invoke('tender_workbench_run_query', { schemaVersion: 2, origin: { kind: 'conversation' }, projectionRevision: 0, scope: 'tender', target: '隔离演练', tender: { keywords: ['隔离'] } })
    assert.equal(query.outcome, 'succeeded', JSON.stringify(query))
    assert.equal(query.state.query.total, 2); end()
    assert.equal(state().query.total, 2, 'Real Session projection must consume the tool result')
    begin('请生成规则建议并预览，不确认')
    const context = await invoke('tender_workbench_get_rule_drafting_context', binding())
    const preview = await invoke('tender_workbench_preview_rules', { ...binding(),
      mode: { kind: 'agent-proposal', contextFingerprint: context.context.contextFingerprint },
      rules: [{ id: 'include-data', name: '数据项目', enabled: true, action: 'include', sources: ['tender'], scope: 'title', keywords: ['数据'], priority: 100, exceptions: [], reason: '合成用户需求' }],
    }); end()
    assert.equal(preview.result.counts.include, 1)
    assert.equal(state().classification, undefined, 'Preview must not confirm rules')
    begin('确认已预览的规则')
    const confirm = await invoke('tender_workbench_confirm_rules', { ...binding(), previewArtifactRef: preview.result.previewArtifactRef, draftFingerprint: preview.result.draftFingerprint }); end()
    assert.equal(confirm.state.classification.include, 1)
    // Read the bounded source context instead of inventing normalized record IDs.
    begin('读取当前规则上下文')
    const records = await invoke('tender_workbench_get_rule_drafting_context', { ...binding(), origin: { kind: 'autonomous' } }); end()
    const recordRef = records.context.samples[0].recordId
    assert.ok(recordRef)
    const basis = { kind: 'classified', classificationArtifactRef: state().classification.data.id, ruleSetVersion: state().rules.ruleSetVersion }
    begin('将首条项目列为候选，确认人工复核')
    const review = await invoke('tender_workbench_apply_review', { ...binding(), basis, reviewRevision: 0, decisions: [{ recordRef, decision: 'confirmed-candidate', note: '隔离人工确认' }] }); end()
    assert.equal(review.state.review.confirmedCandidate, 1)
    begin('确认仍有待复核项，导出当前进度，不添加模型叙述')
    const report = await invoke('tender_workbench_create_report', { ...binding(), basis, reviewArtifactRef: state().review.data.id, reviewRevision: state().review.revision, scope: 'current-progress', confirmPending: true, narrative: { kind: 'none' } }); end()
    assert.equal(report.state.report.excel.status, 'succeeded')
    assert.equal(report.state.report.pdf.status, 'succeeded')
    assert.equal(report.state.report.completeness, 'partial')
    begin('只读查看工作流状态')
    const current = await invoke('tender_workbench_get_workflow_state', {}); end()
    assert.equal(current.context.query.total, 2)
    assert.deepEqual(calls, [name], 'Navigation/report must not repeat the source query')
    await ctx.sessions.flush(session)
    return { status: 'PASS', tools, sourceCalls: calls.length, queryTotal: 2, previewInclude: 1, confirmedInclude: 1,
      reviewed: 1, report: state().report, sessionId, revision: state().revision,
      scope: 'Real registered Host tool pipeline, Agent, Session projection, local Excel/PDF artifacts; synthetic QCC/user data, no model or real MCP' }
  } finally { stop() }
}
