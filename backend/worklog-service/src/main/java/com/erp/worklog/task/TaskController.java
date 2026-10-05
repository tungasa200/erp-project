package com.erp.worklog.task;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.error.Errors;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.task.TaskService.TaskInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.ArraySchema;
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
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
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
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** /api/worklog/tasks (P1-03, 목록 필터 P1-04, contracts/worklog.yaml). */
@RestController
@RequestMapping(path = "/api/worklog/tasks", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "tasks")
class TaskController {

	static final String STATUS = "^(TODO|IN_PROGRESS|DONE|ON_HOLD)$";
	static final String PRIORITY = "^(HIGH|NORMAL|LOW)$";
	private static final Set<String> STATUSES = Set.of("TODO", "IN_PROGRESS", "DONE", "ON_HOLD");

	@Schema(name = "Task")
	record TaskView(
			@Schema(requiredMode = RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = RequiredMode.REQUIRED, maxLength = 200) String title,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "TODO", "IN_PROGRESS", "DONE", "ON_HOLD" })
			String status,
			@Schema(requiredMode = RequiredMode.REQUIRED, allowableValues = { "HIGH", "NORMAL", "LOW" }) String priority,
			@Schema(types = { "string", "null" }, format = "date",
					description = "마감 임박·초과 표시는 프론트가 사용자 시간대의 오늘과 비교해 계산한다") LocalDate dueDate,
			@Schema(requiredMode = RequiredMode.REQUIRED, minimum = "0", maximum = "100", multipleOf = 10) int progress,
			@Schema(types = { "string", "null" }, format = "date-time", description = "status가 DONE일 때만 값이 있다")
			Instant completedAt,
			@Schema(types = { "string", "null" }, format = "uuid") UUID projectId,
			@Schema(requiredMode = RequiredMode.REQUIRED) List<UUID> tagIds,
			@Schema(types = { "string", "null" }, maxLength = 5000) String memo,
			@Schema(types = { "string", "null" }, format = "uuid", description = "이월 원본 업무 (읽기 전용, 이월 기능은 P3)")
			UUID carriedOverFromId,
			@Schema(types = { "string", "null" }, format = "date-time", description = "보관(소프트 삭제) 시각. 값이 있으면 읽기 전용")
			Instant deletedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant createdAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) Instant updatedAt,
			@Schema(requiredMode = RequiredMode.REQUIRED) long version) {

		static TaskView of(TaskInfo t) {
			return new TaskView(t.id(), t.title(), t.status(), t.priority(), t.dueDate(), t.progress(), t.completedAt(),
					t.projectId(), t.tagIds(), t.memo(), t.carriedOverFromId(), t.deletedAt(), t.createdAt(),
					t.updatedAt(), t.version());
		}
	}

	record TaskList(
			@Schema(requiredMode = RequiredMode.REQUIRED) List<TaskView> items,
			@Schema(types = { "string", "null" }, description = "다음 페이지가 없으면 null") String nextCursor) {
	}

	@Schema(name = "TaskCreate", description = "status 기본 TODO, priority 기본 NORMAL. status=DONE으로 만들면 completedAt을 기록한다.")
	record TaskCreate(
			@Schema(requiredMode = RequiredMode.REQUIRED, minLength = 1, maxLength = 200, description = "앞뒤 공백은 빼고 저장한다")
			@NotNull(message = "REQUIRED") @Size(max = 200, message = "TOO_LONG") String title,
			@Schema(allowableValues = { "TODO", "IN_PROGRESS", "DONE", "ON_HOLD" })
			@Pattern(regexp = STATUS, message = "INVALID_FORMAT") String status,
			@Schema(allowableValues = { "HIGH", "NORMAL", "LOW" })
			@Pattern(regexp = PRIORITY, message = "INVALID_FORMAT") String priority,
			@Schema(types = { "string", "null" }, format = "date") LocalDate dueDate,
			@Schema(minimum = "0", maximum = "100", multipleOf = 10, defaultValue = "0") Integer progress,
			@Schema(types = { "string", "null" }, format = "uuid") UUID projectId,
			List<UUID> tagIds,
			@Schema(types = { "string", "null" }, maxLength = 5000) @Size(max = 5000, message = "TOO_LONG") String memo) {
	}

	private final TaskService tasks;
	private final TaskQueries queries;

	TaskController(TaskService tasks, TaskQueries queries) {
		this.tasks = tasks;
		this.queries = queries;
	}

	@GetMapping
	@Operation(operationId = "listTasks", summary = "업무 목록 (cursor, 필터·검색)",
			description = """
					기본 조회는 보관(소프트 삭제)하지 않은 업무 중 보관한 프로젝트에 속하지 않은 것이다. projectId로 거르면 보관한 프로젝트의 업무도 돌려준다.
					정렬: sort=due는 마감일 오름차순(마감일 없음은 뒤) → 생성순, sort=created는 생성 역순.
					필터를 바꾸면 cursor 없이 처음부터 조회한다.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "400", description = "값 형식 오류(code=VALIDATION_FAILED) 또는 cursor 형식이 틀림(code=INVALID_CURSOR)",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	TaskList list(@Parameter(hidden = true) CurrentUser user,
			@Parameter(description = "이전 응답의 nextCursor. 처음이면 생략.") @RequestParam(required = false) String cursor,
			@Parameter(schema = @Schema(minimum = "1", maximum = "100", defaultValue = "50"))
			@RequestParam(defaultValue = "50") int limit,
			@Parameter(description = "여러 개면 OR (?status=TODO&status=IN_PROGRESS)",
					array = @ArraySchema(schema = @Schema(allowableValues = { "TODO", "IN_PROGRESS", "DONE", "ON_HOLD" })))
			@RequestParam(name = "status", required = false) List<String> statuses,
			@Parameter(description = "여러 개면 OR") @RequestParam(name = "projectId", required = false) List<UUID> projectIds,
			@Parameter(description = "여러 개면 OR (태그 중 하나라도 붙은 업무)") @RequestParam(name = "tagId", required = false)
			List<UUID> tagIds,
			@Parameter(description = "마감일 >= dueFrom") @RequestParam(required = false)
			@DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dueFrom,
			@Parameter(description = "마감일 <= dueTo") @RequestParam(required = false)
			@DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate dueTo,
			@Parameter(description = "완료 업무는 완료 시각이 이 시각 이후인 것만 (완료가 아닌 업무에는 영향 없음)")
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant completedSince,
			@Parameter(description = "제목 부분 일치 검색 (대소문자 무시)", schema = @Schema(maxLength = 100))
			@RequestParam(required = false) String q,
			@Parameter(description = "true면 보관(소프트 삭제)한 업무만 돌려준다") @RequestParam(defaultValue = "false") boolean deleted,
			@Parameter(schema = @Schema(allowableValues = { "due", "created" }, defaultValue = "due"))
			@RequestParam(defaultValue = "due") String sort) {
		if (limit < 1 || limit > 100) {
			throw Errors.invalid("limit", "OUT_OF_RANGE", "limit은 1~100이에요.");
		}
		if (q != null && q.length() > 100) {
			throw Errors.invalid("q", "TOO_LONG", "검색어는 100자까지예요.");
		}
		List<String> statusList = statuses == null ? List.of() : statuses;
		if (!STATUSES.containsAll(statusList)) {
			throw Errors.invalid("status", "INVALID_FORMAT", "알 수 없는 상태예요.");
		}
		TaskQueries.Sort order;
		try {
			order = TaskQueries.Sort.valueOf(sort);
		} catch (IllegalArgumentException e) {
			throw Errors.invalid("sort", "INVALID_FORMAT", "sort는 due 또는 created예요.");
		}
		var filter = new TaskQueries.Filter(deleted, statusList, projectIds == null ? List.of() : projectIds,
				tagIds == null ? List.of() : tagIds, dueFrom, dueTo, completedSince, q, order);
		TaskQueries.Page page = queries.list(user.id(), filter, cursor, limit);
		return new TaskList(page.items().stream().map(TaskView::of).toList(), page.nextCursor());
	}

	@PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
	@ResponseStatus(HttpStatus.CREATED)
	@Operation(operationId = "createTask", summary = "업무 추가",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "201", description = "생성됨")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED). 참조한 프로젝트·태그가 없으면 errors[].code=NOT_FOUND",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	TaskView create(@Parameter(hidden = true) CurrentUser user, @Valid @RequestBody TaskCreate body) {
		return TaskView.of(tasks.create(user.id(), new TaskService.NewTask(body.title(), body.status(), body.priority(),
				body.dueDate(), body.progress(), body.projectId(), body.tagIds(), body.memo())));
	}

	@GetMapping("/{taskId}")
	@Operation(operationId = "getTask", summary = "업무 조회 (보관한 업무 포함)",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 업무 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	TaskView get(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID taskId) {
		return TaskView.of(tasks.get(user.id(), taskId));
	}

	@PatchMapping(path = "/{taskId}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(operationId = "updateTask", summary = "업무 수정 (항목별 자동 저장)",
			description = """
					보낸 칸만 바꾼다. dueDate·projectId·memo는 null을 보내면 비운다. tagIds는 보낸 목록으로 통째로 바꾼다.
					DONE으로 바꾸면 completedAt을 기록하고, DONE에서 벗어나면 비운다. 상태 전이 제한은 없고 진행률은 자동으로 바꾸지 않는다.
					보관한 업무는 수정할 수 없다(409 TASK_DELETED).""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "수정 후 전체")
	@ApiResponse(responseCode = "400", description = "입력 오류 (code=VALIDATION_FAILED)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 업무 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	@ApiResponse(responseCode = "409", description = "version 불일치(code=VERSION_CONFLICT) 또는 보관한 업무(code=TASK_DELETED)",
			content = @Content(mediaType = "application/problem+json",
					schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	TaskView update(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID taskId,
			@Valid @RequestBody TaskPatch body) {
		return TaskView.of(tasks.update(user.id(), taskId, body.toChange()));
	}

	@DeleteMapping("/{taskId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Operation(operationId = "deleteTask", summary = "업무 보관 (소프트 삭제)",
			description = "이미 보관한 업무면 그대로 204. version을 받지 않는다.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "204", description = "보관됨")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 업무 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	void delete(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID taskId) {
		tasks.delete(user.id(), taskId);
	}

	@PostMapping("/{taskId}/restore")
	@Operation(operationId = "restoreTask", summary = "보관한 업무 복원 (되돌리기 토스트, 보관함)",
			description = "보관하지 않은 업무면 그대로 200.",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "복원 후 전체")
	@ApiResponse(responseCode = "404", description = "없거나 다른 사용자의 업무 (code=NOT_FOUND)", content = @Content(
			mediaType = "application/problem+json", schema = @Schema(ref = OpenApiAutoConfiguration.PROBLEM_REF)))
	TaskView restore(@Parameter(hidden = true) CurrentUser user, @PathVariable UUID taskId) {
		return TaskView.of(tasks.restore(user.id(), taskId));
	}
}
