// 테마 (UX-07, 화면정의서 2.2). 사용자가 고른 키 컬러·배경 2가지만 받고 나머지는 tokens.css에서 계산한다.
// 키 컬러 위 글자색만 대비 계산이 필요해 여기서 정한다.
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

// 흰 글자로 4.5:1이 되면 흰색, 아니면 진한 글자색
export function onColor(background: string): string {
  return contrastRatio(WHITE, background) >= 4.5 ? WHITE : DARK
}

export function applyTheme(accent: string, ground: string, root: HTMLElement = document.documentElement) {
  root.style.setProperty('--color-accent', accent)
  root.style.setProperty('--color-on-accent', onColor(accent))
  root.style.setProperty('--color-ground', ground)
}
