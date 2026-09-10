import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  TENDER_ACTION_SKILLS,
  TENDER_SKILL_CONTRACT_MARKER,
  type TenderActionSkillName,
} from '../contracts/orchestration.ts'

interface SkillCatalogEntry {
  readonly name: string
  readonly description: string
  readonly modelInvocable: boolean
}

type SkillCatalogResult =
  | { readonly ok: true; readonly value: { readonly skills: readonly SkillCatalogEntry[] } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export interface TenderSkillCatalogConnection {
  readonly skills: {
    list(
      payload: { readonly sessionId: SessionId },
      signal?: AbortSignal,
    ): Promise<SkillCatalogResult>
  }
}

export type TenderSkillPreflightErrorCode =
  | 'catalog-unavailable'
  | 'skill-missing'
  | 'skill-incompatible'

export class TenderSkillPreflightError extends Error {
  constructor(readonly code: TenderSkillPreflightErrorCode, message: string) {
    super(message)
    this.name = 'TenderSkillPreflightError'
  }
}

function assertActionSkillName(value: string): asserts value is TenderActionSkillName {
  if (!(TENDER_ACTION_SKILLS as readonly string[]).includes(value)) {
    throw new TenderSkillPreflightError('skill-incompatible', `未知招投标行为 Skill：${value}`)
  }
}

/** Validate the winning user-invocable Skill through the public session-addressed catalog. */
export async function assertTenderActionSkillAvailable(
  connection: TenderSkillCatalogConnection,
  sessionId: SessionId,
  requestedSkill: string,
  signal?: AbortSignal,
): Promise<void> {
  assertActionSkillName(requestedSkill)
  let response: SkillCatalogResult
  try {
    response = await connection.skills.list({ sessionId }, signal)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    throw new TenderSkillPreflightError('catalog-unavailable', `无法读取当前 Session 的 Skill 目录：${reason}`)
  }
  if (!response.ok) {
    throw new TenderSkillPreflightError(
      'catalog-unavailable',
      `无法读取当前 Session 的 Skill 目录：${response.error.code}`,
    )
  }
  const skill = response.value.skills.find(entry => entry.name === requestedSkill)
  if (skill === undefined) {
    throw new TenderSkillPreflightError('skill-missing', `当前 Session 缺少行为 Skill：${requestedSkill}`)
  }
  if (!skill.description.includes(`[${TENDER_SKILL_CONTRACT_MARKER}]`)) {
    throw new TenderSkillPreflightError('skill-incompatible', `当前 Session 的行为 Skill 契约不兼容：${requestedSkill}`)
  }
}
