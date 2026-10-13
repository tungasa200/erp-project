import { describe, expect, it } from 'vitest'
import {
  applyTheme,
  contrastRatio,
  darkenForWhite,
  isAccentReadable,
  isAccentTextFaint,
  isWhiteTextFaint,
  menuTextContrast,
  normalizeAccent,
  onColor,
} from './theme'

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
    applyTheme('#DA5A0C', '#FFFFFF', el)
    expect(el.style.getPropertyValue('--color-accent')).toBe('#DA5A0C')
    expect(el.style.getPropertyValue('--color-on-accent')).toBe('#1A1C2B')
    expect(el.style.getPropertyValue('--color-ground')).toBe('#FFFFFF')
  })

  it('프리셋 8색은 배경 4종 모두에서 배경·흰 표면과 3:1 이상이고, 흰 글자 4.5:1 이상(SET-77)', () => {
    const accents = ['#4B3FD6', '#2D6BE4', '#0E857A', '#2C873B', '#C7510A', '#D1344A', '#C2378B', '#2B2E3B']
    const grounds = ['#F2F4FA', '#F6F2EA', '#EEF4EF', '#FFFFFF']
    for (const a of accents) for (const g of grounds) expect(isAccentReadable(a, g), `${a} on ${g}`).toBe(true)
    for (const a of accents) {
      expect(onColor(a), a).toBe('#FFFFFF')
      expect(contrastRatio('#FFFFFF', a), a).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('예전 프리셋 3색으로 저장했어도 새 값으로 그리고, 흐린 직접 색은 흰 글자 4.5:1이 되는 조정 색을 준다', () => {
    const el = document.createElement('div')
    applyTheme('#d9590b', '#FFFFFF', el)
    expect(el.style.getPropertyValue('--color-accent')).toBe('#C7510A')
    expect(el.style.getPropertyValue('--color-on-accent')).toBe('#FFFFFF')
    expect(normalizeAccent('#0E8A7E')).toBe('#0E857A')
    expect(isWhiteTextFaint('#0F8A7F')).toBe(true)
    const adjusted = darkenForWhite('#0F8A7F')
    expect(contrastRatio('#FFFFFF', adjusted)).toBeGreaterThanOrEqual(4.5)
    expect(isWhiteTextFaint(adjusted)).toBe(false)
  })

  it('현재 메뉴 글자 대비는 ink-strong(키 55%+검정) 대 selected 면(키 28%+흰색)으로 센다(D-236 ①)', () => {
    // 기본 보라: #292376 대 #CDC9F4
    expect(menuTextContrast('#4B3FD6')).toBeCloseTo(contrastRatio('#292376', '#CDC9F4'), 1)
    const presets = ['#4B3FD6', '#2D6BE4', '#0E857A', '#2C873B', '#C7510A', '#D1344A', '#C2378B', '#2B2E3B']
    for (const a of presets) expect(menuTextContrast(a), a).toBeGreaterThanOrEqual(4.5)
    expect(menuTextContrast('#FFD43B')).toBeLessThan(4.5)
    expect(isAccentTextFaint('#FFD43B')).toBe(true)
    expect(menuTextContrast(darkenForWhite('#FFD43B'))).toBeGreaterThanOrEqual(4.5)
  })

  it('COM-26 문서 전체에 칠하면 theme-color가 바탕색을 따른다', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#4B3FD6'
    document.head.append(meta)
    applyTheme('#4B3FD6', '#F6F2EA')
    expect(meta.content).toBe('#F6F2EA')
    meta.remove()
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
