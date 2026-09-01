import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TenderClientContext } from './client-context.ts'
import { mergeDraft } from './merge-draft.ts'

/** Resolve one Session input facade and append generated text through its public draft API. */
export function writeSessionDraft(
  ctx: TenderClientContext,
  sessionId: SessionId,
  generatedText: string,
): boolean {
  try {
    const sessionContext = ctx.sessions.scope(sessionId)
    if (sessionContext === undefined) return false
    const input = ctx.conversation.input.for(sessionContext)
    const current = input.state.getSnapshot().draft
    input.setDraft(mergeDraft(current, generatedText))
    return true
  } catch (error) {
    console.error('[dsh-tender-workbench] draft write failed', error)
    return false
  }
}
