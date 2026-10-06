package com.erp.identity.verification;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.erp.common.error.ApiException;
import com.erp.common.error.Problems;
import com.erp.identity.auth.IpLoginLimiter;

/**
 * 코드 메일 요청의 IP 단위 제한: 1시간에 10회(이메일 인증·비밀번호 재설정 합산). 가입하지 않은 주소로 재설정 요청을 쏟아내
 * Gmail 하루 발송 한도를 다 써 버리는 것을 막는다. 접속자 IP를 모르면(null) 제한하지 않는다 (D-61).
 */
@Component
public class IpSendLimiter {

	static final int SENDS_PER_HOUR = 10;

	private final Cache<String, Bucket> buckets = Caffeine.newBuilder()
		.expireAfterAccess(Duration.ofHours(1))
		.maximumSize(100_000)
		.build();

	public void consume(String ip) {
		if (ip == null) {
			return;
		}
		ConsumptionProbe probe = buckets.get(ip, key -> newBucket()).tryConsumeAndReturnRemaining(1);
		if (!probe.isConsumed()) {
			long seconds = Math.max(1, TimeUnit.NANOSECONDS.toSeconds(probe.getNanosToWaitForRefill() + 999_999_999));
			throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, IpLoginLimiter.TOO_MANY_REQUESTS,
					"요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", List.of(), Map.of(Problems.RETRY_AFTER_SECONDS, seconds));
		}
	}

	private static Bucket newBucket() {
		return Bucket.builder()
			.addLimit(Bandwidth.builder().capacity(SENDS_PER_HOUR).refillGreedy(SENDS_PER_HOUR, Duration.ofHours(1)).build())
			.build();
	}

}
