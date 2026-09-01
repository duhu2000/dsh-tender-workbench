import { describe, expect, it } from 'vitest'
import { AREA_OPTIONS, type AreaOption } from '../src/client/area-data.ts'
import {
  formatAreaPath, formatAreaSelections, searchAreas, toggleAreaSelection,
} from '../src/client/area-utils.ts'

describe('area utils', () => {
  it('bundles all province-level entries with unique administrative codes', () => {
    const values: string[] = []
    const collect = (options: readonly AreaOption[]): void => {
      for (const option of options) {
        values.push(option.value)
        if (option.children !== undefined) collect(option.children)
      }
    }
    collect(AREA_OPTIONS)
    expect(AREA_OPTIONS).toHaveLength(34)
    expect(new Set(values).size).toBe(values.length)
  })

  it('formats complete province-city-district paths', () => {
    expect(formatAreaPath('130102')).toBe('河北省-石家庄市-长安区')
    expect(formatAreaSelections(['BJ', '130102'])).toBe('北京市、河北省-石家庄市-长安区')
  })

  it('keeps parent and descendant selections canonical', () => {
    expect(toggleAreaSelection(['HB'], '1301')).toEqual(['1301'])
    expect(toggleAreaSelection(['1301'], '130102')).toEqual(['130102'])
    expect(toggleAreaSelection(['BJ', '130102'], 'HB')).toEqual(['BJ', 'HB'])
    expect(toggleAreaSelection(['HB'], 'HB')).toEqual([])
  })

  it('searches districts by name and returns their full path', () => {
    const result = searchAreas('长安区').find(record => record.option.value === '130102')
    expect(result?.path.map(option => option.label)).toEqual(['河北省', '石家庄市', '长安区'])
  })
})
