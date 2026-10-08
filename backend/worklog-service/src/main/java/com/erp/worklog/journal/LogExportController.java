package com.erp.worklog.journal;

import com.erp.common.autoconfigure.OpenApiAutoConfiguration;
import com.erp.worklog.journal.LogExportService.ExportFile;
import com.erp.worklog.security.CurrentUser;
import com.erp.worklog.security.SecurityConfig;
import com.erp.worklog.user.UserProfileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/** 파일 내보내기 (P3-10, contracts/worklog.yaml exportLog·exportRecords). */
@RestController
class LogExportController {

	private static final String PROBLEM = OpenApiAutoConfiguration.PROBLEM_REF;
	private static final String DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
	private static final String DISPOSITION = "attachment; filename=\"{ASCII 대체 이름}\"; filename*=UTF-8''{퍼센트 인코딩한 파일명} (RFC 6266)";

	private final LogExportService exports;
	private final UserProfileService profiles;

	LogExportController(LogExportService exports, UserProfileService profiles) {
		this.exports = exports;
		this.profiles = profiles;
	}

	@GetMapping("/api/worklog/logs/{type}/{periodStart}/export")
	@Tag(name = "logs")
	@Operation(operationId = "exportLog", summary = "일지 파일 내보내기 — PDF·Word·Excel (EXP-02~04, P3-10, SCR-LOG-05)",
			description = """
					확정 일지는 스냅샷으로, 초안·미리보기는 지금 내용으로 만든다(초안 경고는 화면 몫, 서버는 허용).
					서식은 docs/업무일지_서식명세.md(결재란 담당·팀장·부서장 빈칸). XLSX는 시트 1 "업무일지", 시트 2 "기록"(그 기간 원본 기록,
					열·규칙은 GET /records/export와 같다). PDF는 Pretendard 하위 집합을 넣고, Word·Excel은 '맑은 고딕'을 지정한다(D-111).
					이메일 인증(AUTH-08): 기억한 인증이 없으면 사용자 토큰으로 identity GET /api/users/me의 emailVerified를 보고 true만 기억한다.
					인증 전이면 403(EMAIL_NOT_VERIFIED), 확인하지 못하면 503(IDENTITY_UNAVAILABLE).
					파일명: 업무일지_{기간 시작일}_{이름}.{pdf|docx|xlsx} — 이름의 / \\ : * ? " < > |와 제어 문자는 _, 이름이 비면 "_{이름}"을 뺀다.
					ASCII 대체 이름은 worklog_{기간 시작일}.{확장자}.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "파일",
			headers = @Header(name = HttpHeaders.CONTENT_DISPOSITION, required = true, description = DISPOSITION,
					schema = @Schema(type = "string")),
			content = { @Content(mediaType = MediaType.APPLICATION_PDF_VALUE, schema = @Schema(type = "string", format = "binary")),
					@Content(mediaType = DOCX, schema = @Schema(type = "string", format = "binary")),
					@Content(mediaType = XLSX, schema = @Schema(type = "string", format = "binary")) })
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "403", description = "이메일 인증 전 (code=EMAIL_NOT_VERIFIED, AUTH-08). 화면은 SCR-LOG-06으로 인증을 받고 같은 요청을 다시 보낸다.",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity에서 인증 여부·프로필을 확인하지 못함 (code=IDENTITY_UNAVAILABLE 또는 PROFILE_UNAVAILABLE). 잠시 후 재시도.",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	ResponseEntity<byte[]> exportLog(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@Parameter(description = "경로에서는 소문자", schema = @Schema(allowableValues = { "daily", "weekly", "monthly" })) @PathVariable String type,
			@Parameter(description = "기간 시작일") @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodStart,
			@Parameter(required = true, schema = @Schema(allowableValues = { "PDF", "DOCX", "XLSX" })) @RequestParam String format) {
		String token = jwt.getTokenValue();
		return file(exports.exportLog(user.id(), token, id -> profiles.snapshotOf(id, token).profile(), type, periodStart, format));
	}

	@GetMapping("/api/worklog/records/export")
	@Tag(name = "records")
	@Operation(operationId = "exportRecords", summary = "기간 업무 기록 Excel (EXP-03, SCR-LOG-05 ② \"기간 업무 기록\")",
			description = """
					workDate가 [from, to](최대 400일)인 보관하지 않은 기록(세 상태 모두, 상태 열 포함)을 한 행씩. 실행 중 타이머는 뺀다.
					열: 날짜, 내용, 업무, 프로젝트, 상태, 결과, 결과 칩, 진행률, 시작·종료·소요시간(분, 값이 있으면 — 옵션과 관계없이).
					Excel만. 이메일 인증은 exportLog와 같다. 파일명은 업무기록_{from}_{to}_{이름}.xlsx, ASCII 대체 이름은 records_{from}_{to}.xlsx.""",
			security = @SecurityRequirement(name = SecurityConfig.COOKIE_SCHEME))
	@ApiResponse(responseCode = "200", description = "파일",
			headers = @Header(name = HttpHeaders.CONTENT_DISPOSITION, required = true, description = DISPOSITION,
					schema = @Schema(type = "string")),
			content = @Content(mediaType = XLSX, schema = @Schema(type = "string", format = "binary")))
	@ApiResponse(responseCode = "400", description = "값 형식 오류 (code=VALIDATION_FAILED: to INVALID_ORDER·OUT_OF_RANGE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "403", description = "이메일 인증 전 (code=EMAIL_NOT_VERIFIED, AUTH-08)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	@ApiResponse(responseCode = "503", description = "identity에서 인증 여부·프로필을 확인하지 못함 (code=IDENTITY_UNAVAILABLE 또는 PROFILE_UNAVAILABLE)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(ref = PROBLEM)))
	ResponseEntity<byte[]> exportRecords(@Parameter(hidden = true) CurrentUser user, @AuthenticationPrincipal Jwt jwt,
			@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
			@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
		String token = jwt.getTokenValue();
		return file(exports.exportRecords(user.id(), token, id -> profiles.snapshotOf(id, token).profile(), from, to));
	}

	private static ResponseEntity<byte[]> file(ExportFile f) {
		return ResponseEntity.ok()
			.contentType(MediaType.parseMediaType(f.mediaType()))
			.header(HttpHeaders.CONTENT_DISPOSITION, f.contentDisposition())
			.header(HttpHeaders.CACHE_CONTROL, "no-store")
			.body(f.body());
	}
}
