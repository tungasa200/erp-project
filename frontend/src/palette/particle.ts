/** 받침이 있으면 "을", 없으면 "를". 한글로 끝나지 않으면 "을(를)" */
export function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  if (code < 0 || code > 11171) return '을(를)'
  return code % 28 === 0 ? '를' : '을'
}
