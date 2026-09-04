import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  TenderWorkbenchIntentV2Schema,
  type TenderWorkbenchIntentV2,
} from '../../contracts/intents.ts'
import {
  assertTenderActionSkillAvailable,
  type TenderSkillCatalogConnection,
} from '../skill-catalog.ts'
import { serializeTenderWorkbenchIntent } from './screening-intent.ts'

export class TenderSessionUnavailableError extends Error {
  override readonly name = 'TenderSessionUnavailableError'
}

export async function sendSessionTenderWorkbenchIntent(
  sessions: Pick<ISessions, 'scope'>,
  connection: TenderSkillCatalogConnection,
  sessionId: SessionId,
  intent: TenderWorkbenchIntentV2,
): Promise<void> {
  const parsed = TenderWorkbenchIntentV2Schema.parse(intent)
  const scoped = sessions.scope(sessionId)
  if (scoped === undefined) throw new TenderSessionUnavailableError(`Tender Session is unavailable: ${sessionId}`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) throw new TenderSessionUnavailableError(`Tender conversation is unavailable: ${sessionId}`)
  await assertTenderActionSkillAvailable(connection, sessionId, parsed.skill)
  await conversation.send(serializeTenderWorkbenchIntent(parsed))
}
