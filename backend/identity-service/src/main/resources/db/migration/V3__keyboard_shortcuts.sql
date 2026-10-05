-- 프로필 수정 (P1-01). 키보드 단축키 사용(UX-09)은 테마처럼 앱 전체 화면 설정이라 identity에 둔다. 피드에는 넣지 않는다.
ALTER TABLE users ADD COLUMN keyboard_shortcuts_enabled BOOLEAN NOT NULL DEFAULT TRUE;
