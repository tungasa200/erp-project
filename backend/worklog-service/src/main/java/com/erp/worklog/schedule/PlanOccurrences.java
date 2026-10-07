package com.erp.worklog.schedule;

import com.erp.worklog.schedule.EndedOccurrences.Ended;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 타이머·빈 시간이 쓰는 계획 회차 (P2-06 이어달리기, P2-07 빈 시간 후보). 끝났는지와 관계없이 취소하지 않은 회차.
 * 호출하는 쪽의 트랜잭션 안에서 부른다.
 */
@Component
public class PlanOccurrences {

	private final ScheduleRepository schedules;

	PlanOccurrences(ScheduleRepository schedules) {
		this.schedules = schedules;
	}

	/** 내 일정의 (취소하지 않은) 회차 하나. */
	public Optional<Ended> find(UUID ownerId, UUID scheduleId, Instant key) {
		return schedules.findByIdAndOwnerId(scheduleId, ownerId)
			.filter(s -> s.hasOccurrence(key))
			.map(s -> ended(s, s.occurrence(key)));
	}

	/** [from, to)와 겹치는 시간 일정 회차 (종일 제외). */
	public List<Ended> timed(UUID ownerId, Instant from, Instant to) {
		List<Ended> result = new ArrayList<>();
		for (Schedule s : schedules.findOverlapping(ownerId, from, to)) {
			for (Schedule.Occurrence o : s.occurrences(from, to)) {
				if (!o.allDay()) {
					result.add(ended(s, o));
				}
			}
		}
		return result;
	}

	private static Ended ended(Schedule s, Schedule.Occurrence o) {
		LocalDate workDate = LocalDate.ofInstant(o.key(), ZoneId.of(s.getTimezone()));
		return new Ended(s.getId(), o.key(), s.getTaskId(), workDate, o.title(), o.allDay(), o.startAt(), o.endAt(),
				o.startDate(), o.endDate());
	}
}
