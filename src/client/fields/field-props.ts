import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TenderKey } from '../locales.ts'
import type { TenderFilters } from '../types.ts'

export type TenderTranslate = TranslateNS<'tenderFilter'>

export interface TenderFieldProps {
  readonly filters: TenderFilters
  readonly onChange: <K extends keyof TenderFilters>(key: K, value: TenderFilters[K]) => void
  readonly t: TenderTranslate
}

export function translated(t: TenderTranslate, key: TenderKey): string {
  return t(key)
}
