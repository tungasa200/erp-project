package com.erp.worklog.schedule;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.EnumSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 반복 규칙 (SCH-03): 매일 / 매주(요일) / 매월(시작일과 같은 날짜), 종료는 없음·날짜(until, 포함)·횟수(count).
 * 화면이 쓰는 부분만 라이브러리 없이 직접 구현한다(INTERVAL=1, D-69). 저장은 RFC 5545 RRULE 문자열이다.
 * UNTIL은 일정 시간대의 날짜(YYYYMMDD)로 저장한다. 시간 일정에 RFC는 UTC 시각을 요구하므로, 외부 연동 때 변환한다.
 */
public record Recurrence(Frequency frequency, Set<DayOfWeek> weekdays, LocalDate until, Integer count) {

	public enum Frequency {
		DAILY, WEEKLY, MONTHLY
	}

	private static final DateTimeFormatter BASIC_DATE = DateTimeFormatter.BASIC_ISO_DATE;

	private static final Map<DayOfWeek, String> BYDAY = new LinkedHashMap<>();

	static {
		BYDAY.put(DayOfWeek.MONDAY, "MO");
		BYDAY.put(DayOfWeek.TUESDAY, "TU");
		BYDAY.put(DayOfWeek.WEDNESDAY, "WE");
		BYDAY.put(DayOfWeek.THURSDAY, "TH");
		BYDAY.put(DayOfWeek.FRIDAY, "FR");
		BYDAY.put(DayOfWeek.SATURDAY, "SA");
		BYDAY.put(DayOfWeek.SUNDAY, "SU");
	}

	public Recurrence {
		weekdays = weekdays == null || weekdays.isEmpty() ? Set.of() : Set.copyOf(EnumSet.copyOf(weekdays));
		// 요청 검증이 먼저 막지만, 빈 요일로 만들어지면 dates()가 끝나지 않으므로 여기서도 막는다.
		if (frequency == Frequency.WEEKLY && weekdays.isEmpty()) {
			throw new IllegalArgumentException("WEEKLY에는 요일이 하나 이상 필요합니다.");
		}
	}

	/** FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10 형태. 요일은 월→일 순서로 쓴다. */
	public String toRrule() {
		StringBuilder rule = new StringBuilder("FREQ=").append(frequency.name());
		if (frequency == Frequency.WEEKLY) {
			rule.append(";BYDAY=")
				.append(BYDAY.entrySet()
					.stream()
					.filter(e -> weekdays.contains(e.getKey()))
					.map(Map.Entry::getValue)
					.collect(Collectors.joining(",")));
		}
		if (until != null) {
			rule.append(";UNTIL=").append(until.format(BASIC_DATE));
		}
		if (count != null) {
			rule.append(";COUNT=").append(count);
		}
		return rule.toString();
	}

	/** {@link #toRrule()}가 쓴 문자열만 읽는다. */
	public static Recurrence parse(String rrule) {
		Frequency frequency = null;
		Set<DayOfWeek> weekdays = EnumSet.noneOf(DayOfWeek.class);
		LocalDate until = null;
		Integer count = null;
		for (String part : rrule.split(";")) {
			String[] kv = part.split("=", 2);
			switch (kv[0]) {
				case "FREQ" -> frequency = Frequency.valueOf(kv[1]);
				case "BYDAY" -> {
					for (String code : kv[1].split(",")) {
						weekdays.add(BYDAY.entrySet()
							.stream()
							.filter(e -> e.getValue().equals(code))
							.map(Map.Entry::getKey)
							.findFirst()
							.orElseThrow(() -> new IllegalArgumentException("BYDAY " + code)));
					}
				}
				case "UNTIL" -> until = LocalDate.parse(kv[1], BASIC_DATE);
				case "COUNT" -> count = Integer.valueOf(kv[1]);
				default -> throw new IllegalArgumentException("지원하지 않는 RRULE 항목: " + kv[0]);
			}
		}
		if (frequency == null) {
			throw new IllegalArgumentException("FREQ 없음: " + rrule);
		}
		return new Recurrence(frequency, weekdays, until, count);
	}

	/**
	 * 회차 날짜를 오래된 순으로 준다. 첫 날은 항상 start이고(매주는 start의 요일이 weekdays에 있어야 한다),
	 * count·until에서 끝난다. 끝 조건이 없으면 끝없이 이어지므로 호출하는 쪽이 범위에서 멈춘다.
	 * 매월은 start와 같은 날짜이며, 그 날짜가 없는 달은 건너뛰고 횟수에도 넣지 않는다(RFC 5545와 같다).
	 */
	public Iterator<LocalDate> dates(LocalDate start) {
		return new Iterator<>() {

			private int emitted;

			private int step; // DAILY·WEEKLY는 지난 날 수, MONTHLY는 지난 달 수

			private LocalDate next = start;

			@Override
			public boolean hasNext() {
				return next != null && (count == null || emitted < count) && (until == null || !next.isAfter(until));
			}

			@Override
			public LocalDate next() {
				if (!hasNext()) {
					throw new NoSuchElementException();
				}
				LocalDate current = next;
				emitted++;
				next = following();
				return current;
			}

			private LocalDate following() {
				switch (frequency) {
					case DAILY -> {
						return start.plusDays(++step);
					}
					case WEEKLY -> {
						LocalDate candidate;
						do {
							candidate = start.plusDays(++step);
						}
						while (!weekdays.contains(candidate.getDayOfWeek()));
						return candidate;
					}
					default -> {
						// 31일처럼 없는 달은 건너뛴다. 4년 안에 반드시 같은 날짜가 있는 달이 나온다.
						for (int i = 0; i < 48; i++) {
							LocalDate month = start.plusMonths(++step);
							if (month.getDayOfMonth() == start.getDayOfMonth()) {
								return month;
							}
						}
						return null;
					}
				}
			}
		};
	}

	/** 매주 규칙에서 첫 회차(start)가 회차가 되려면 start의 요일이 weekdays에 있어야 한다. */
	public boolean admitsStart(LocalDate start) {
		return frequency != Frequency.WEEKLY || weekdays.contains(start.getDayOfWeek());
	}

	public List<DayOfWeek> weekdaysInOrder() {
		return BYDAY.keySet().stream().filter(weekdays::contains).toList();
	}

}
