package com.erp.worklog.project;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.project.ProjectService.ProjectInfo;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.media.Schema.RequiredMode;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** /api/worklog/projects (P1-02, contracts/worklog.yaml). 삭제 API는 없고 보관만 한다. */
@RestController
@RequestMapping(path = "/api/worklog/projects", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "projects")
class ProjectController {

	static final String COLOR = "^P[1-8]$";

	@Schema(name = "Project")
	record ProjectView(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, maxLength = 50) String name,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8" },
					description = "프로젝트 전용 팔레트 8색의 키 (실제 색 값은 프론트 디자인 토큰)") String color,
			@Schema(requiredMode = RequiredMode.REQUIRED) boolean archived,
			@Schema(types = { "string", "null" }, format = "date-time") Instant archivedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED, minimum = "0", description = "보관(소프트 삭제)하지 않은 업무 수 (상태 무관)")
			long taskCount,
			@Schema(requiredMode = RequiredMode.REQUIRED, minimum = "0",
					description = "남은 업무 수: 보관하지 않았고 완료(DONE)가 아닌 업무 (사이드바 프로젝트 목록, SCR-COM-01)")
			long openTaskCount,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant createdAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) long version) {

		static ProjectView of(ProjectInfo p) {
			return new ProjectView(p.id(), p.name(), p.color(), p.archivedAt() != null, p.archivedAt(), p.taskCount(),
					p.openTaskCount(), p.createdAt(), p.version());
		}
	}

	record ProjectList(@Schema(requiredMode = RequiredMode.REQUIRED) List<ProjectView> items) {
	}

	@Schema(name = "ProjectCreate")
	record ProjectCreate(
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 50, description = "앞뒤 공백은 빼고 저장한다")
			@NotNull(message = "REQUIRED") @Size(max = 50, message = "TOO_LONG") String name,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8" })
			@NotNull(message = "REQUIRED") @Pattern(regexp = COLOR, message = "INVALID_FORMAT") String color) {
	}

	@Schema(name = "ProjectPatch")
	record ProjectPatch(
			@Schema(requiredMode = RequiredMode.REQUIRED) @NotNull(message = "REQUIRED") Long version,
			@Schema(minLength = 1, maxLength = 50) @Size(max = 50, message = "TOO_LONG") String name,
			@Schema(allowableValues = { "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8" })
			@Pattern(regexp = COLOR, message = "INVALID_FORMAT") String color,
			Boolean archived) {
	}

	private final ProjectService projects;

	ProjectController(ProjectService projects) {
		this.projects = projects;
	}

	@GetMapping
	@Operation(operationId = "listProjects", summary = "프로젝트 목록",
			description = "페이지 없이 전체를 돌려준다. 만든 순서.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	ProjectList list(@Parameter(hidden = true) CurrentUser user,
			@Parameter(description = "true면 보관한 프로젝트도 포함") @RequestParam(defaultValue = "false") boolean includeArchived) {
		return new ProjectList(projects.list(user.id(), includeArchived).stream().map(ProjectView::of).toList());
	}

	@PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
	@ResponseStatus(HttpStatus.CREATED)
	@Operation(operationId = "createProject", summary = "프로젝트 추가",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "201", description = "생성됨")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "409", description = "같은 이름이 이미 있음 (code=DUPLICATE_NAME)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	ProjectView create(@Parameter(hidden = true) CurrentUser user, @Valid @RequestBody ProjectCreate body) {
		return ProjectView.of(projects.create(user.id(), body.name(), body.color()));
	}

	@GetMapping("/{projectId}")
	@Operation(operationId = "getProject", summary = "프로젝트 조회",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 프로젝트 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	ProjectView get(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID projectId) {
		return ProjectView.of(projects.get(user.id(), projectId));
	}

	@PatchMapping(path = "/{projectId}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "updateProject", summary = "프로젝트 수정·보관·보관 해제",
			description = "보낸 칸만 바꾼다. 보관한 프로젝트의 업무는 업무 목록 기본 조회에서 빠진다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "수정 후 전체")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 프로젝트 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "409", description = "version 불일치(code=VERSION_CONFLICT) 또는 같은 이름(code=DUPLICATE_NAME)",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	ProjectView update(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID projectId,
			@Valid @RequestBody ProjectPatch body) {
		return ProjectView.of(projects.update(user.id(), projectId,
				new ProjectService.Change(body.version(), body.name(), body.color(), body.archived())));
	}
}
