# E2E 시험 (P4-06)

Playwright로 실제 서버에 붙어 핵심 흐름을 돈다: 가입 → 빠른 입력 → 계획 기반 기록 확정 → 하루 마감 → 이메일 인증 → 내보내기.
CI(`.github/workflows/ci.yml`의 e2e job)는 Chromium·WebKit·모바일 크기(iPhone 13)를 모두 돌리고, 로컬은 Chromium 하나만 돌린다(D-175 ③).

## 로컬 실행

1. `docker compose -f infra/docker-compose.yml --profile e2e up -d --wait` (PostgreSQL·Mailpit)
2. identity(8081) → worklog(8082)·gateway(8080) 순서로 띄운다. identity에는 `MAIL_HOST=localhost MAIL_PORT=1025 MAIL_SMTP_AUTH=false MAIL_SMTP_STARTTLS=false MAIL_USERNAME=e2e@worklog.test`, 세 서비스 모두 `ALLOWED_ORIGINS=http://localhost:4173`
3. `npm run build && npx vite preview --port 4173 --strictPort` (`/api`는 gateway로 프록시됨)
4. 처음 한 번 `npx playwright install chromium`, 그 뒤 `npm run test:e2e -- --project=chromium`
5. 끝나면 서비스·미리보기를 끄고 `docker compose -f infra/docker-compose.yml --profile e2e down`

## 선택자 원칙

역할과 화면 글자(접근 가능한 이름)로 찾는다. 같은 이름이 여러 곳에 있으면 대화상자(`getByRole('dialog', { name })`)나 h2가 있는 `section`으로 좁힌다.

| 단계        | 화면                   | 선택자                                                                                         |
| ----------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| 가입        | `/signup`              | 레이블 `이메일`·`비밀번호`(exact)·`비밀번호 확인`, 체크박스 `전체 동의`, 버튼 `회원가입`       |
| 빠른 입력   | 홈                     | 텍스트 상자 `빠른 기록` + Enter. 모바일은 하단 탭 버튼 `빠른 기록` → 시트의 `한 줄 입력`       |
| 기록 확정   | 홈 `오늘 일정`         | 버튼 `{업무 제목} 했어요`. 확인 대기는 끝난 계획만, 기록 목록을 불러올 때 생겨서 다시 연다     |
| 하루 마감   | 홈 `오늘 일지` 카드    | `하루 마감` → `다음` → `이슈 및 특이사항 (선택)` → `마감하고 확정` → 작성자 정보 물음 `나중에` |
| 이메일 인증 | 대화상자 `이메일 인증` | 레이블 `인증번호`(6자리를 넣으면 바로 확인). 코드는 Mailpit에서 가장 새 메일                   |
| 내보내기    | 대화상자 `내보내기`    | 라디오 `PDF`(기본), 버튼 `내려받기`. 미인증이면 `이메일 인증이 필요해요` → `인증 코드 받기`    |

서울 시각 0시 32분 전에는 오늘 안에 끝난 계획을 만들 수 없어 시험을 건너뛴다.
