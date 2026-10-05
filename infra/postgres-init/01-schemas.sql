-- 서비스별 schema와 DB 계정 (요구사항정의서 5.2: 서비스는 다른 서비스 테이블을 조회하지 않는다).
-- 비밀번호는 로컬 전용 값이다. 운영 계정은 Railway에서 따로 만든다.

CREATE ROLE identity_app LOGIN PASSWORD 'identity_app_local';
CREATE SCHEMA identity AUTHORIZATION identity_app;
ALTER ROLE identity_app SET search_path = identity;

CREATE ROLE worklog_app LOGIN PASSWORD 'worklog_app_local';
CREATE SCHEMA worklog AUTHORIZATION worklog_app;
ALTER ROLE worklog_app SET search_path = worklog;

-- public schema에는 아무도 객체를 만들지 않는다. 서비스 계정은 다른 서비스 schema에 접근 권한이 없다.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE erp FROM PUBLIC;
GRANT CONNECT ON DATABASE erp TO identity_app, worklog_app;
