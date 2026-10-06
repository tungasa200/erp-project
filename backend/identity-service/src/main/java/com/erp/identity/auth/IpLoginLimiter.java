package com.erp.identity.auth;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import jakarta.servlet.http.HttpServletRequest;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.EstimationProbe;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.erp.common.error.ApiException;
import com.erp.common.error.Problems;

/**
 * IP 단위 로그인 시도 제한 (AUTH-09 보조 수단). 실패만 센다: IP당 분당 10회.
 * 메모리에 두므로 인스턴스마다 따로 센다. 인스턴스가 여러 개가 되면 Redis로 옮긴다 (D-17).
 */
@Component
public class IpLoginLimiter {

	public static final String TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS";

	/** Gateway가 Vercel 비밀 헤더를 통과한 요청에만 넣는 접속자 IP. 외부에서 온 값은 Gateway가 지운다. */
	public static final String CLIENT_IP_HEADER = "X-Client-Ip";

	static final int FAILURES_PER_MINUTE = 10;

	private static final Logger log = LoggerFactory.getLogger(IpLoginLimiter.class);

	private static final AtomicBoolean missingHeaderWarned = new AtomicBoolean();

	private final Cache<String, Bucket> buckets = Caffeine.newBuilder()
		.expireAfterAccess(Duration.ofMinutes(10))
		.maximumSize(100_000)
		.build();

	/** 이 IP의 실패가 한도에 닿았으면 429. ip가 null이면(접속자 IP를 모름) 제한하지 않는다. */
	public void rejectIfLimited(String ip) {
		Bucket bucket = ip == null ? null : buckets.getIfPresent(ip);
		if (bucket == null) {
			return;
		}
		EstimationProbe probe = bucket.estimateAbilityToConsume(1);
		if (!probe.canBeConsumed()) {
			long seconds = Math.max(1, TimeUnit.NANOSECONDS.toSeconds(probe.getNanosToWaitForRefill() + 999_999_999));
			throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, TOO_MANY_REQUESTS, "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
					List.of(), Map.of(Problems.RETRY_AFTER_SECONDS, seconds));
		}
	}

	public void recordFailure(String ip) {
		if (ip != null) {
			buckets.get(ip, key -> newBucket()).tryConsume(1);
		}
	}

	/**
	 * 접속자 IP. Gateway가 넣은 X-Client-Ip를 쓰고, 없으면 직접 호출한 쪽이 이 PC(로컬 개발)일 때만 remoteAddr를 쓴다.
	 * 운영에서 헤더가 없을 때 remoteAddr(Gateway 내부 주소)를 쓰면 모든 사용자가 한 IP로 묶여 전원이 막히므로 제한하지 않는다.
	 */
	public static String clientIp(HttpServletRequest request) {
		String header = request.getHeader(CLIENT_IP_HEADER);
		if (header != null && !header.isBlank()) {
			return header.strip();
		}
		if (isLoopback(request.getRemoteAddr())) {
			return request.getRemoteAddr();
		}
		if (missingHeaderWarned.compareAndSet(false, true)) {
			log.warn("{} 헤더 없이 로그인 요청이 왔습니다. IP 단위 제한을 건너뜁니다 (Gateway 설정 확인, 인스턴스당 1회 기록).",
					CLIENT_IP_HEADER);
		}
		return null;
	}

	private static boolean isLoopback(String address) {
		return address != null
				&& (address.startsWith("127.") || address.equals("::1") || address.equals("0:0:0:0:0:0:0:1"));
	}

	private static Bucket newBucket() {
		return Bucket.builder()
			.addLimit(Bandwidth.builder()
				.capacity(FAILURES_PER_MINUTE)
				.refillGreedy(FAILURES_PER_MINUTE, Duration.ofMinutes(1))
				.build())
			.build();
	}

}
