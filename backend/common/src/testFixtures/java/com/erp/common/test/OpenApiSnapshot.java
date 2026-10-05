package com.erp.common.test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * springdoc 출력(/v3/api-docs)을 저장소의 contracts/generated/{이름}.json 스냅샷과 맞춘다.
 * 이름은 모듈 이름에서 -service를 뺀 것이다(identity-service → identity).
 * 루트 빌드가 넘기는 시스템 속성으로 동작이 바뀐다.
 * - openapi.snapshot.write=true (openApiSnapshot 작업): 파일을 새로 쓴다.
 * - 그 밖(일반 test): 파일과 다르면 실패한다. API를 바꾸고 스냅샷을 갱신하지 않은 채 커밋하는 것을 막는다.
 */
public final class OpenApiSnapshot {

	private static final JsonMapper MAPPER = JsonMapper.builder()
		.enable(SerializationFeature.INDENT_OUTPUT)
		.enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
		.build();

	private OpenApiSnapshot() {
	}

	public static void verifyOrWrite(String apiDocsJson) {
		String dir = System.getProperty("openapi.snapshot.dir");
		String name = System.getProperty("openapi.snapshot.name");
		if (dir == null || name == null) {
			throw new IllegalStateException("openapi.snapshot.* 시스템 속성이 없습니다. Gradle로 실행하세요.");
		}
		Path file = Path.of(dir, name + ".json");
		String actual = normalize(apiDocsJson);
		try {
			if (Boolean.getBoolean("openapi.snapshot.write")) {
				Files.createDirectories(file.getParent());
				Files.writeString(file, actual, StandardCharsets.UTF_8);
				return;
			}
			if (!Files.exists(file)) {
				throw new AssertionError(file + " 이 없습니다. ./gradlew openApiSnapshot 으로 만드세요.");
			}
			// Windows 체크아웃에서 줄바꿈이 CRLF로 바뀌어도 같은 것으로 본다.
			String expected = Files.readString(file, StandardCharsets.UTF_8).replace("\r\n", "\n");
			if (!expected.equals(actual)) {
				Path actualFile = Files.createTempFile("openapi-" + name + "-", ".json");
				Files.writeString(actualFile, actual, StandardCharsets.UTF_8);
				throw new AssertionError(file + " 이 현재 API와 다릅니다(현재 출력: " + actualFile
						+ "). ./gradlew openApiSnapshot 으로 갱신하고 함께 커밋하세요.");
			}
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	/**
	 * 키 순서와 들여쓰기를 고정해 실행할 때마다 같은 파일이 나오게 한다.
	 * Jackson 들여쓰기는 OS 줄바꿈을 쓰므로(Windows는 CRLF) LF로 맞춰 Windows와 CI(Linux)의 결과를 같게 한다.
	 */
	private static String normalize(String json) {
		JsonNode tree = MAPPER.readTree(json);
		Object sorted = MAPPER.treeToValue(tree, Object.class);
		return MAPPER.writeValueAsString(sorted).replace("\r\n", "\n") + "\n";
	}

}
