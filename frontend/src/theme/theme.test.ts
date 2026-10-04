import { describe, expect, it } from 'vitest'
import { applyTheme, contrastRatio, onColor } from './theme'

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

  it('applyTheme은 사용자 설정 2가지와 글자색을 CSS 변수로 넣는다', () => {
    const el = document.createElement('div')
    applyTheme('#FFD43B', '#FFFFFF', el)
    expect(el.style.getPropertyValue('--color-accent')).toBe('#FFD43B')
    expect(el.style.getPropertyValue('--color-on-accent')).toBe('#1A1C2B')
    expect(el.style.getPropertyValue('--color-ground')).toBe('#FFFFFF')
  })
})
