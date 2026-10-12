-- 이메일 인증 필수화(D-219, D-20 변경). 필수화 전에 가입한 회원은 모두 인증 완료로 본다.
-- 탈퇴 회원은 users에서 지워져 있으므로(deleted_users만 남음) 따로 거를 행이 없다.
-- 인증 처리(EmailVerificationService)와 같게 version·updated_at도 올린다.
UPDATE users
SET email_verified_at = now(), version = version + 1, updated_at = now()
WHERE email_verified_at IS NULL;
