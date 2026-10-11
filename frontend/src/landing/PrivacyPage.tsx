// SCR-AUTH-06 개인정보 처리방침(/privacy). 가입 화면 국외 이전 고지(D-33)·랜딩 바닥글이 여기로 보낸다
import { LegalPage } from './LegalPage'
import { PRIVACY } from './legalText'

export function PrivacyPage() {
  return <LegalPage title="개인정보 처리방침" doc={PRIVACY} />
}
