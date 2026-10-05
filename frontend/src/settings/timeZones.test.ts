import { describe, expect, it } from 'vitest'
import { canonicalZone, matchZone, zoneOptions } from './timeZones'

// 서머타임이 없는 1월 기준
const options = zoneOptions(new Date('2026-01-15T00:00:00Z'))
const find = (zone: string) => options.find((o) => o.zone === zone)
const search = (q: string) => options.filter((o) => matchZone(o, q)).map((o) => o.zone)

describe('zoneOptions', () => {
  it('"IANA 이름 (UTC±hh:mm)"로 표기한다', () => {
    expect(find('Asia/Seoul')?.label).toBe('Asia/Seoul (UTC+09:00)')
    expect(find('Asia/Kolkata')?.label).toBe('Asia/Kolkata (UTC+05:30)')
    expect(find('America/New_York')?.label).toBe('America/New_York (UTC-05:00)')
    expect(find('UTC')?.label).toBe('UTC (UTC+00:00)')
  })

  it('지금 시점의 오프셋(서머타임 반영)을 쓴다', () => {
    const summer = zoneOptions(new Date('2026-07-15T00:00:00Z'))
    expect(summer.find((o) => o.zone === 'America/New_York')?.label).toBe('America/New_York (UTC-04:00)')
  })

  it('옛 이름은 정식 이름으로 바꾸고 하나만 남긴다', () => {
    for (const old of ['Asia/Calcutta', 'Asia/Saigon', 'Asia/Katmandu', 'Asia/Rangoon', 'Europe/Kiev']) {
      expect(find(old)).toBeUndefined()
    }
    expect(find('Asia/Ho_Chi_Minh')).toBeDefined()
    expect(new Set(options.map((o) => o.zone)).size).toBe(options.length)
  })

  it('지역/도시 형식과 UTC 하나만 남긴다', () => {
    expect(
      options
        .filter((o) => !/^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//.test(o.zone))
        .map((o) => o.zone),
    ).toEqual(['UTC'])
  })

  it('오프셋 순, 같은 오프셋 안에서는 이름순', () => {
    const i = options.findIndex((o) => o.zone === 'Asia/Seoul')
    expect(options[i - 1].offset).toBeLessThanOrEqual(options[i].offset)
    const plus9 = options.filter((o) => o.offset === 540).map((o) => o.zone)
    expect(plus9).toEqual([...plus9].sort((a, b) => a.localeCompare(b)))
    expect(options[0].offset).toBeLessThanOrEqual(options.at(-1)!.offset)
  })
})

describe('matchZone', () => {
  it('IANA 이름·도시 이름·한국어 이름으로 찾는다', () => {
    expect(search('seoul')).toEqual(['Asia/Seoul'])
    expect(search('new york')).toContain('America/New_York')
    expect(search('도쿄')).toEqual(['Asia/Tokyo'])
  })

  it('오프셋으로 찾는다', () => {
    expect(search('+9')).toContain('Asia/Seoul')
    expect(search('UTC+09')).toContain('Asia/Tokyo')
    expect(search('+5:30')).toContain('Asia/Kolkata')
    expect(search('+9')).not.toContain('Asia/Kolkata')
  })
})

describe('canonicalZone', () => {
  it('저장된 옛 이름을 정식 이름으로', () => {
    expect(canonicalZone('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(canonicalZone('Asia/Seoul')).toBe('Asia/Seoul')
  })
})
