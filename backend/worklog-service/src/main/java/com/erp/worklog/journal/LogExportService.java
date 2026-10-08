package com.erp.worklog.journal;

import com.erp.common.error.FieldErrorDetail;
import com.erp.worklog.journal.LogViews.WorkLogView;
import com.erp.worklog.user.Profile;
import com.erp.worklog.workrecord.TimeViews.TaskMinutes;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 일지·기간 기록 파일 내보내기 (P3-10, EXP-02~04, AUTH-08). 서식은 docs/업무일지_서식명세.md. */
@Service
class LogExportService {

	enum Format {
		PDF("pdf", MediaType.APPLICATION_PDF_VALUE),
		DOCX("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
		XLSX("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

		final String ext;
		final String mediaType;

		Format(String ext, String mediaType) {
			this.ext = ext;
			this.mediaType = mediaType;
		}
	}

	/** 내보낼 파일. contentDisposition은 RFC 6266 (ASCII 대체 이름 + filename*=UTF-8''). */
	record ExportFile(byte[] body, String mediaType, String contentDisposition) {
	}

	private final WorkLogService logs;
	private final LogSources sources;
	private final RecordExportRows records;
	private final EmailVerification verification;
	private final Clock clock;

	LogExportService(WorkLogService logs, LogSources sources, RecordExportRows records, EmailVerification verification,
			Clock clock) {
		this.logs = logs;
		this.sources = sources;
		this.records = records;
		this.verification = verification;
		this.clock = clock;
	}

	/** 확정 일지는 스냅샷, 초안·미리보기는 지금 내용(WorkLogService.get이 주는 것과 같다). */
	ExportFile exportLog(UUID ownerId, String userToken, Function<UUID, Profile> profile, String typePath, LocalDate periodStart,
			String format) {
		Format f = format(format);
		verification.require(ownerId, userToken);
		Profile p = profile.apply(ownerId);
		ZoneId zone = ZoneId.of(p.timezone());
		WorkLogView log = logs.get(ownerId, p, typePath, periodStart);
		Map<UUID, String> projectNames = Map.of();
		if (log.content().time() != null) {
			projectNames = sources.projectNames(ownerId, log.content().time().tasks().stream()
				.map(TaskMinutes::projectId).filter(Objects::nonNull).collect(Collectors.toSet()));
		}
		LogDocument d = LogDocument.of(log, zone, LocalDate.ofInstant(clock.instant(), zone), projectNames);
		String start = log.periodStart().toString();
		String name = "업무일지_" + start + suffix(d.author()) + "." + f.ext;
		byte[] body = switch (f) {
			case PDF -> LogPdf.write(d, d.title());
			case DOCX -> LogDocx.write(d);
			case XLSX -> LogXlsx.write(d, records.find(ownerId, log.periodStart(), log.periodEnd()), zone);
		};
		return new ExportFile(body, f.mediaType, disposition("worklog_" + start + "." + f.ext, name));
	}

	/** 기간 업무 기록 Excel (GET /records/export). */
	ExportFile exportRecords(UUID ownerId, String userToken, Function<UUID, Profile> profile, LocalDate from, LocalDate to) {
		List<FieldErrorDetail> errors = new ArrayList<>();
		LogPeriods.checkRange(from, to, errors);
		WorkLogService.throwIfAny(errors);
		verification.require(ownerId, userToken);
		Profile p = profile.apply(ownerId);
		byte[] body = LogXlsx.writeRecords(records.find(ownerId, from, to), ZoneId.of(p.timezone()));
		String name = "업무기록_" + from + "_" + to + suffix(p.name()) + ".xlsx";
		return new ExportFile(body, Format.XLSX.mediaType, disposition("records_" + from + "_" + to + ".xlsx", name));
	}

	private static Format format(String value) {
		try {
			return Format.valueOf(value);
		} catch (IllegalArgumentException | NullPointerException e) {
			WorkLogService.throwIfAny(List.of(WorkLogService.error("format", "INVALID_FORMAT")));
			throw e;
		}
	}

	/** 파일명의 "_{이름}": / \ : * ? " < > |와 제어 문자는 _로, 비어 있으면 뺀다. */
	static String suffix(String name) {
		if (name == null || name.isBlank()) {
			return "";
		}
		return "_" + name.strip().replaceAll("[/\\\\:*?\"<>|\\p{Cntrl}]", "_");
	}

	static String disposition(String ascii, String name) {
		return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encode(name);
	}

	/** RFC 5987 attr-char 밖은 UTF-8 바이트를 %XX로. */
	private static String encode(String s) {
		StringBuilder b = new StringBuilder();
		for (byte x : s.getBytes(StandardCharsets.UTF_8)) {
			char c = (char) (x & 0xFF);
			if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || "!#$&+-.^_`|~".indexOf(c) >= 0) {
				b.append(c);
			}
			else {
				b.append('%').append(String.format("%02X", x & 0xFF));
			}
		}
		return b.toString();
	}
}
