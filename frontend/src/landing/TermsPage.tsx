// SCR-AUTH-07 이용약관(/terms)
import { LegalPage } from './LegalPage'
import { TERMS } from './legalText'

export function TermsPage() {
  return <LegalPage title="이용약관" doc={TERMS} />
}
