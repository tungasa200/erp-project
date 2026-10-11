package com.erp.gateway;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.util.HashMap;
import java.util.Map;

/**
 * 오류 수집 요청 제한 (P4-13, 카드 20261011-0400: 서버 메모리에서 셈). 1분 고정 창으로 IP당 10건, 전체 300건.
 * 인스턴스 하나라 메모리로 충분하고, 재시작하면 초기화된다. 넘긴 요청은 로그에 남기지 않고 창이 바뀔 때 개수만 한 번 남긴다.
 */
final class ClientErrorLimiter {

	static final int PER_IP = 10;
	static final int TOTAL = 300;
	private static final long WINDOW_MS = 60_000;

	private static final Logger log = LoggerFactory.getLogger(ClientErrorLimiter.class);

	private final Clock clock;
	private final Map<String, Integer> perIp = new HashMap<>();
	private long window = -1;
	private int total;
	private int rejected;

	ClientErrorLimiter(Clock clock) {
		this.clock = clock;
	}

	/** 받을 수 있으면 0, 넘었으면 다음 창까지 남은 초(1 이상). ip가 없으면 한 묶음으로 센다. */
	synchronized long tryAcquire(String ip) {
		long now = clock.millis();
		long current = now / WINDOW_MS;
		if (current != window) {
			if (rejected > 0) {
				log.warn("오류 수집 요청 제한으로 지난 1분 동안 {}건을 버렸다", rejected);
			}
			window = current;
			perIp.clear();
			total = 0;
			rejected = 0;
		}
		String key = ip == null ? "" : ip;
		int count = perIp.getOrDefault(key, 0);
		if (total >= TOTAL || count >= PER_IP) {
			rejected++;
			long left = (current + 1) * WINDOW_MS - now;
			return Math.max(1, (left + 999) / 1000);
		}
		perIp.put(key, count + 1);
		total++;
		return 0;
	}
}
