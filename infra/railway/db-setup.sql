-- 운영 PostgreSQL(Railway)에 서비스별 schema와 계정을 만든다 (P0-09, infra/postgres-init/01-schemas.sql의 운영판).
-- Railway PostgreSQL 서비스의 Data → Query에서 한 번 실행한다. <...> 자리는 사용자가 직접 넣고, 값은 저장소에 남기지 않는다.
-- 같은 비밀번호를 identity-service·worklog-service의 DB_PASSWORD 변수에 넣는다.
-- 데이터베이스 이름은 Railway 기본값 railway 기준이다.

CREATE ROLE identity_app LOGIN PASSWORD '<IDENTITY_DB_PASSWORD>';
CREATE SCHEMA identity AUTHORIZATION identity_app;
ALTER ROLE identity_app SET search_path = identity;

CREATE ROLE worklog_app LOGIN PASSWORD '<WORKLOG_DB_PASSWORD>';
CREATE SCHEMA worklog AUTHORIZATION worklog_app;
ALTER ROLE worklog_app SET search_path = worklog;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE railway FROM PUBLIC;
GRANT CONNECT ON DATABASE railway TO identity_app, worklog_app;
