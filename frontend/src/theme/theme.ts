// 테마 (UX-07, 화면정의서 2.2). 사용자가 고른 키 컬러·배경 2가지만 받고 나머지는 tokens.css에서 계산한다.
// 키 컬러 위 글자색과 키 컬러 자체가 배경에서 보이는지(3:1)를 여기서 계산한다.
export const DEFAULT_THEME = { accent: '#4B3FD6', ground: '#F2F4FA' }

const WHITE = '#FFFFFF'
const DARK = '#1A1C2B'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// 흰색과 진한 글자색 중 대비가 큰 쪽 (화면정의서 2.2 on-accent)
export function onColor(background: string): string {
  return contrastRatio(WHITE, background) >= contrastRatio(DARK, background) ? WHITE : DARK
}

/** 키 컬러가 선택 표시·버튼 모양으로 보이려면 배경과 흰 표면 둘 다에 3:1 이상(WCAG 1.4.11 비텍스트 대비) */
export const MIN_ACCENT_CONTRAST = 3

/** 고른 배경과 흰 표면(카드·하단 탭) 중 대비가 낮은 쪽 */
export function accentContrast(accent: string, ground: string): number {
  return Math.min(contrastRatio(accent, ground), contrastRatio(accent, WHITE))
}

export function isAccentReadable(accent: string, ground: string): boolean {
  return accentContrast(accent, ground) >= MIN_ACCENT_CONTRAST
}

export function applyTheme(accent: string, ground: string, root: HTMLElement = document.documentElement) {
  // 이미 저장된 값이 기준 미만이면(검사 전에 저장한 값) 앱은 기본 보라로 그린다. 테마 화면은 저장값을 그대로 보여 준다
  if (!isAccentReadable(accent, ground)) accent = DEFAULT_THEME.accent
  root.style.setProperty('--color-accent', accent)
  root.style.setProperty('--color-on-accent', onColor(accent))
  root.style.setProperty('--color-ground', ground)
}
