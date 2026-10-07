package com.erp.worklog.schedule;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 확인 대기 기록(P2-03, REC-03)을 만들 회차 찾기. 지금까지 끝났고 회차 날짜(시작의 일정 시간대 날짜, NFR-04)가
 * [fromDate, toDate]인 회차. 취소한 회차는 빠진다. 업무 연결 여부는 부르는 쪽이 본다(확인 대기 목록의 계획 값에도 쓴다).
 */
@Component
public class EndedOccurrences {

	/** 회차 하나와 지금의 계획 값. 시간 일정은 startAt·endAt, 종일은 startDate·endDate(포함)만 있다. */
	public record Ended(UUID scheduleId, Instant key, UUID taskId, LocalDate workDate, String title, boolean allDay,
			Instant startAt, Instant endAt, LocalDate startDate, LocalDate endDate) {
	}

	private final ScheduleRepository schedules;

	EndedOccurrences(ScheduleRepository schedules) {
		this.schedules = schedules;
	}

	/** 호출하는 쪽의 트랜잭션 안에서 부른다. */
	public List<Ended> find(UUID ownerId, LocalDate fromDate, LocalDate toDate, Instant now) {
		// 날짜는 일정마다 시간대가 달라 하루씩 넓혀 겹치는 일정을 고르고, 회차 날짜로 정확히 자른다
		Instant from = fromDate.minusDays(2).atStartOfDay(ZoneOffset.UTC).toInstant();
		Instant to = toDate.plusDays(2).atStartOfDay(ZoneOffset.UTC).toInstant();
		if (now.isBefore(to)) {
			to = now;
		}
		List<Ended> result = new ArrayList<>();
		if (!from.isBefore(to)) {
			return result;
		}
		for (Schedule s : schedules.findOverlapping(ownerId, from, to)) {
			ZoneId zone = ZoneId.of(s.getTimezone());
			for (Schedule.Occurrence o : s.occurrences(from, to)) {
				LocalDate workDate = LocalDate.ofInstant(o.key(), zone);
				Instant end = o.allDay() ? o.endDate().plusDays(1).atStartOfDay(zone).toInstant() : o.endAt();
				if (workDate.isBefore(fromDate) || workDate.isAfter(toDate) || end.isAfter(now)) {
					continue;
				}
				result.add(new Ended(s.getId(), o.key(), s.getTaskId(), workDate, o.title(), o.allDay(), o.startAt(),
						o.endAt(), o.startDate(), o.endDate()));
			}
		}
		return result;
	}
}
