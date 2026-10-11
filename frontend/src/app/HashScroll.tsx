import { useLayoutEffect } from 'react'
import { Outlet, useLocation } from 'react-router'

// 주소에 #id가 있으면 화면을 그린 뒤 그 요소로 스크롤한다(예: 가입 화면 → /privacy#legal-3, 새 탭).
// 브라우저는 문서를 받을 때 한 번만 #id를 찾는데, 그때는 React가 아직 화면을 그리기 전이라 맨 위에 머문다.
export function HashScroll() {
  const { hash } = useLocation()

  useLayoutEffect(() => {
    if (hash.length > 1) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
  }, [hash])

  return <Outlet />
}
