import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TenderQueryIntentV1Schema, type TenderQueryIntentV1 } from '../../contracts/query-schema.ts'
import { serializeTenderQueryIntent } from './query-intent.ts'

export class TenderSessionUnavailableError extends Error {
  override readonly name = 'TenderSessionUnavailableError'
}

/** Send one validated, user-visible Intent directly through the addressed Session service. */
export async function sendSessionTenderQueryIntent(
  sessions: Pick<ISessions, 'scope'>,
  sessionId: SessionId,
  intent: TenderQueryIntentV1,
): Promise<void> {
  const parsed = TenderQueryIntentV1Schema.parse(intent)
  const scoped = sessions.scope(sessionId)
  if (scoped === undefined) {
    throw new TenderSessionUnavailableError(`Tender Session is unavailable: ${sessionId}`)
  }
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new TenderSessionUnavailableError(`Tender conversation is unavailable: ${sessionId}`)
  }
  await conversation.send(serializeTenderQueryIntent(parsed))
}
