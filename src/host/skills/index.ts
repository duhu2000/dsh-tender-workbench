import type { SkillRegistration, SkillRegistry } from '@deepseek-ai/dsh-skill'
import { TENDER_ACTION_SKILL_REGISTRATIONS } from './action-skills.ts'
import { TENDER_WORKFLOW_SKILL_REGISTRATION } from './workflow-skill.ts'

export const TENDER_SKILL_REGISTRATIONS = [
  TENDER_WORKFLOW_SKILL_REGISTRATION,
  ...TENDER_ACTION_SKILL_REGISTRATIONS,
] as const satisfies readonly SkillRegistration[]

export function registerTenderWorkflowSkills(skills: Pick<SkillRegistry, 'register'>): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const skill of TENDER_SKILL_REGISTRATIONS) disposers.push(skills.register(skill))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
