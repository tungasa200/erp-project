import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// globals를 켜지 않아 Testing Library의 자동 정리가 동작하지 않으므로 직접 정리한다.
afterEach(() => {
  cleanup()
  localStorage.clear()
})

// 첫 화면 로드가 느린 환경(Windows·CI)에서 findBy 기본 1초가 모자라다.
configure({ asyncUtilTimeout: 5000 })

// jsdom에 없는 브라우저 API. 명령 팔레트(cmdk)가 목록 크기 측정과 선택 항목 스크롤에 쓴다.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= function () {}
