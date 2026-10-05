package com.erp.worklog.tag;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.tag.TagService.TagInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** /api/worklog/tags (P1-02, contracts/worklog.yaml). */
@RestController
@RequestMapping(path = "/api/worklog/tags", produces = MediaType.APPLICATION_JSON_VALUE)
@io.swagger.v3.oas.annotations.tags.Tag(name = "tags")
class TagController {

	/** 공백과 '#' 없음 (빠른 입력의 #태그 문법과 맞춤) */
	static final String NAME = "^[^\\s#]+$";

	@Schema(name = "Tag")
	record TagView(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, description = "#은 붙이지 않는다") String name,
			@Schema(requiredMode = RequiredMode.REQUIRED, minimum = "0", description = "이 태그가 붙은 업무 중 보관하지 않은 업무 수")
			long usageCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant createdAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) long version) {

		static TagView of(TagInfo t) {
			return new TagView(t.id(), t.name(), t.usageCount(), t.createdAt(), t.version());
		}
	}

	record TagList(@Schema(requiredMode = RequiredMode.REQUIRED) List<TagView> items) {
	}

	@Schema(name = "TagCreate")
	record TagCreate(
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 30, pattern = NAME)
			@NotNull(message = "REQUIRED") @Size(max = 30, message = "TOO_LONG")
			@Pattern(regexp = NAME, message = "INVALID_FORMAT") String name) {
	}

	@Schema(name = "TagPatch")
	record TagPatch(
			@Schema(requiredMode = RequiredMode.REQUIRED) @NotNull(message = "REQUIRED") Long version,
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 30, pattern = NAME)
			@NotNull(message = "REQUIRED") @Size(max = 30, message = "TOO_LONG")
			@Pattern(regexp = NAME, message = "INVALID_FORMAT") String name) {
	}

	private final TagService tags;

	TagController(TagService tags) {
		this.tags = tags;
	}

	@GetMapping
	@Operation(operationId = "listTags", summary = "태그 목록 (사용 수 포함)", description = "페이지 없이 전체를 돌려준다. 이름순.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	TagList list(@Parameter(hidden = true) CurrentUser user) {
		return new TagList(tags.list(user.id()).stream().map(TagView::of).toList());
	}

	@PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "createTag", summary = "태그 추가 (같은 이름이 있으면 그 태그를 돌려줌)",
			description = "같은 이름(대소문자 무시)이 이미 있으면 새로 만들지 않고 200으로 기존 태그를 돌려준다. 새로 만들면 201.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "같은 이름의 기존 태그")
	@ApiResponse(responseCode = "201", description = "생성됨")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	ResponseEntity<TagView> create(@Parameter(hidden = true) CurrentUser user, @Valid @RequestBody TagCreate body) {
		var existing = tags.findByName(user.id(), body.name());
		if (existing.isPresent()) {
			return ResponseEntity.ok(TagView.of(existing.get()));
		}
		try {
			return ResponseEntity.status(HttpStatus.CREATED).body(TagView.of(tags.create(user.id(), body.name())));
		} catch (DataIntegrityViolationException e) {
			// 같은 이름이 동시에 들어와 다른 요청이 먼저 만들었다. 실패한 트랜잭션은 끝났으므로 새로 읽는다
			return ResponseEntity.ok(TagView.of(tags.findByName(user.id(), body.name()).orElseThrow(() -> e)));
		}
	}

	@PatchMapping(path = "/{tagId}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "updateTag", summary = "태그 이름 변경",
			description = "다른 태그와 이름이 같아지면 409(DUPLICATE_NAME). 합치기는 하지 않는다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "수정 후 전체")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 태그 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "409", description = "version 불일치(code=VERSION_CONFLICT) 또는 같은 이름(code=DUPLICATE_NAME)",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	TagView rename(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID tagId,
			@Valid @RequestBody TagPatch body) {
		return TagView.of(tags.rename(user.id(), tagId, body.version(), body.name()));
	}

	@DeleteMapping("/{tagId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "deleteTag", summary = "태그 삭제",
			description = "태그를 실제로 지우고 모든 업무에서 뗀다 (보관한 업무 포함). 되돌릴 수 없다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "삭제됨")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 태그 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	void delete(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID tagId) {
		tags.delete(user.id(), tagId);
	}
}
