# erp-project
MSA ERP 제작 프로젝트

## 버전 (P0-01)

2026-10-04 확정. 버전을 바꿀 때는 이 표와 `backend/gradle/libs.versions.toml`을 함께 고친다.

| 항목 | 버전 | 비고 |
|---|---|---|
| JDK | 21 | Gradle toolchain으로 지정 (D-06). JAVA_HOME은 17이어도 됨 |
| Gradle | 9.8.0 | Wrapper (`backend/gradlew`). JDK 17 이상에서 실행 |
| Spring Boot | 4.0.8 | |
| Spring Cloud | 2025.1.3 | Boot 4.0.x 지원 계열 |
| springdoc-openapi | 3.0.3 | Boot 4.0 공식 호환 계열 |
| ShedLock | 7.10.1 | D-31 |
| Flyway · Hibernate · PostgreSQL JDBC | Spring Boot 관리 버전 | |
| PostgreSQL | 18 | 로컬 docker-compose. 운영은 P0-09에서 Railway 제공 버전에 맞춤 |
| JSON 로그 | Spring Boot 기본 구조화 로그 | 별도 라이브러리 없음 |

**UUIDv7**: Hibernate 내장 `@UuidGenerator(style = VERSION_7)`로 애플리케이션에서 생성한다. JPA 엔티티가 아닌 곳에서 필요해지면 uuid-creator 추가를 검토한다.

## 백엔드 빌드

```sh
cd backend
./gradlew build
```

JDK 21은 Gradle이 자동으로 찾는다(`./gradlew javaToolchains`로 확인). 찾지 못하면 PC의 `~/.gradle/gradle.properties`에 `org.gradle.java.installations.paths=<JDK 21 경로>`를 적는다. 이 경로는 PC마다 다르므로 저장소에 넣지 않는다.
