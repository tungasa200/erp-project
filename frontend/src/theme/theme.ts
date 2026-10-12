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

/** 흰 글자 4.5:1에 못 미치던 예전 프리셋 3색 → 명도만 낮춘 새 값(SET-77, D-212 Q8). 그 프리셋을 쓰던 사용자도 새 값으로 그린다 */
const LEGACY_ACCENTS: Record<string, string> = {
  '#0E8A7E': '#0E857A',
  '#2F8F3E': '#2C873B',
  '#D9590B': '#C7510A',
}

export function normalizeAccent(accent: string): string {
  const hex = accent.toUpperCase()
  return LEGACY_ACCENTS[hex] ?? hex
}

/** 흰 글자 기준(WCAG 1.4.3 본문) */
export const MIN_TEXT_CONTRAST = 4.5

/** 색상은 두고 검정을 1%씩 섞어 흰 글자가 4.5:1을 넘는 첫 색. 직접 고른 색의 제안 값(X-10) */
export function darkenForWhite(hex: string): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (let k = 1; k <= 100; k++) {
    const next =
      '#' +
      rgb
        .map((c) =>
          Math.round(c * (1 - k / 100))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
        .toUpperCase()
    if (contrastRatio(WHITE, next) >= MIN_TEXT_CONTRAST) return next
  }
  return '#000000'
}

/** 흰 글자를 쓰지만 4.5:1에 못 미치는 키 컬러(저장은 막지 않고 조정 색을 제안한다) */
export function isWhiteTextFaint(accent: string): boolean {
  return onColor(accent) === WHITE && contrastRatio(WHITE, accent) < MIN_TEXT_CONTRAST
}

export function applyTheme(accent: string, ground: string, root: HTMLElement = document.documentElement) {
  accent = normalizeAccent(accent)
  // 이미 저장된 값이 기준 미만이면(검사 전에 저장한 값) 앱은 기본 보라로 그린다. 테마 화면은 저장값을 그대로 보여 준다
  if (!isAccentReadable(accent, ground)) accent = DEFAULT_THEME.accent
  root.style.setProperty('--color-accent', accent)
  root.style.setProperty('--color-on-accent', onColor(accent))
  root.style.setProperty('--color-ground', ground)
  // 휴대폰 상태 표시줄이 앱 바탕과 이어지게(COM-26). 테스트처럼 다른 요소에 칠할 때는 건드리지 않는다
  if (root === document.documentElement) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground)
  }
}
