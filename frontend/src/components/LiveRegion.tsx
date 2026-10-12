// 앱 전체에 하나뿐인 낭독 영역(UX-COM-25·13). 처음부터 비어 있는 채로 붙어 있어야 낭독기가 바뀐 글을 읽는다
// (내용과 함께 새로 끼워 넣은 role="status"는 일부 낭독기가 읽지 않는다).
// body 바로 아래에 두어 모달이 바깥을 inert로 막아도 읽힌다(Modal의 inertOutside는 [aria-live]를 남긴다).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { subscribeAnnounce } from './announce'

export function LiveRegion() {
  const [message, setMessage] = useState('')
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const listener = (next: string) => {
      // 비웠다가 다음 틱에 넣어야 같은 글도 바뀐 것으로 읽힌다
      setMessage('')
      clearTimeout(timer)
      timer = setTimeout(() => setMessage(next), 50)
    }
    const unsubscribe = subscribeAnnounce(listener)
    return () => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [])
  return createPortal(
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-live-region>
      {message}
    </div>,
    document.body,
  )
}
