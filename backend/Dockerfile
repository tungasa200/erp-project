# 백엔드 서비스 공통 이미지 (P0-09). Railway 서비스마다 SERVICE 변수(api-gateway·identity-service·worklog-service)를 둔다.
# Railway는 Dockerfile에 선언된 ARG와 같은 이름의 서비스 변수를 빌드 인자로 넘긴다.
# 빌드 문맥은 저장소 루트다(worklog가 shared/holidays/KR.json을 쓴다, D-74). 보내는 파일은 루트 .dockerignore가 backend/·shared/로 줄인다.
# 로컬 빌드: 저장소 루트에서 docker build -f backend/Dockerfile --build-arg SERVICE=worklog-service .
FROM eclipse-temurin:21-jdk AS build
ARG SERVICE
# 저장소 배치(backend/와 shared/가 형제)를 그대로 두어 gradle이 ../shared를 같은 경로로 찾게 한다
WORKDIR /repo/backend
COPY backend/ ./
COPY shared/ ../shared/
# 테스트는 CI가 돌린다 (Testcontainers는 빌드 컨테이너에서 Docker를 쓸 수 없다)
RUN test -n "$SERVICE" && sh ./gradlew ":${SERVICE}:bootJar" --no-daemon --console=plain \
    && cp ${SERVICE}/build/libs/${SERVICE}-*-SNAPSHOT.jar /app.jar

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
USER app
COPY --from=build /app.jar /app/app.jar
# 컨테이너 메모리 한도 기준으로 힙을 잡는다. 포트는 Railway가 PORT로 준다 (application.yml server.port)
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
