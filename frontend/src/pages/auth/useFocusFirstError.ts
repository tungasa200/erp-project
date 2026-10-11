import { useEffect, useRef, useState } from 'react'

// 화면정의서 2.5(REL-09): 제출 때 오류가 있으면 화면 순서상 첫 오류 칸(aria-invalid)으로 포커스를 옮긴다.
// 오류 문구가 그려진 뒤(aria-describedby가 붙은 뒤) 옮겨야 화면 읽기 도구가 문구까지 읽으므로 렌더 뒤 effect에서 옮긴다.
export function useFocusFirstError<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [request, setRequest] = useState(0)

  useEffect(() => {
    if (request) ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [request])

  return { ref, focusFirstError: () => setRequest((n) => n + 1) }
}
