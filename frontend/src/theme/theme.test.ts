import { describe, expect, it } from 'vitest'
import { accentContrast, applyTheme, contrastRatio, isAccentReadable, onColor } from './theme'

describe('theme', () => {
  it('대비 계산: 흰색과 검은색은 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1)
  })

  it('기본 키 컬러 위에는 흰 글자', () => {
    expect(onColor('#4B3FD6')).toBe('#FFFFFF')
  })

  it('밝은 키 컬러 위에는 진한 글자', () => {
    expect(onColor('#FFD43B')).toBe('#1A1C2B')
  })

  it('흰 글자가 4.5:1에 못 미쳐도 진한 글자보다 대비가 크면 흰 글자', () => {
    expect(contrastRatio('#FFFFFF', '#7A7A7A')).toBeLessThan(4.5)
    expect(onColor('#7A7A7A')).toBe('#FFFFFF')
  })

  it('applyTheme은 사용자 설정 2가지와 글자색을 CSS 변수로 넣는다', () => {
    const el = document.createElement('div')
    applyTheme('#D9590B', '#FFFFFF', el)
    expect(el.style.getPropertyValue('--color-accent')).toBe('#D9590B')
    expect(el.style.getPropertyValue('--color-on-accent')).toBe('#1A1C2B')
    expect(el.style.getPropertyValue('--color-ground')).toBe('#FFFFFF')
  })

  it('프리셋 8색은 배경 4종 모두에서 배경·흰 표면과 3:1 이상(최저 주황·웜 베이지 3.49)', () => {
    const accents = ['#4B3FD6', '#2D6BE4', '#0E8A7E', '#2F8F3E', '#D9590B', '#D1344A', '#C2378B', '#2B2E3B']
    const grounds = ['#F2F4FA', '#F6F2EA', '#EEF4EF', '#FFFFFF']
    for (const a of accents) for (const g of grounds) expect(isAccentReadable(a, g), `${a} on ${g}`).toBe(true)
    expect(accentContrast('#D9590B', '#F6F2EA')).toBeCloseTo(3.49, 2)
  })

  it('흰 키 컬러는 기준 미만이고, applyTheme은 기본 보라로 그린다', () => {
    expect(isAccentReadable('#FFFFFF', '#F2F4FA')).toBe(false)
    const el = document.createElement('div')
    applyTheme('#FFFFFF', '#F2F4FA', el)
    expect(el.style.getPropertyValue('--color-accent')).toBe('#4B3FD6')
    expect(el.style.getPropertyValue('--color-on-accent')).toBe('#FFFFFF')
    expect(el.style.getPropertyValue('--color-ground')).toBe('#F2F4FA')
  })
})
