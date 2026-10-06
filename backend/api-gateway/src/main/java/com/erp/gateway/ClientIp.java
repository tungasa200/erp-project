package com.erp.gateway;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * 접속자 IP를 X-Client-Ip로 내부 서비스에 넘긴다 (P1-14 로그인 보호, backend1과 합의).
 * Vercel 비밀 헤더를 통과한 요청에서만 Vercel이 준 IP를 쓴다. 외부에서 온 X-Client-Ip는 항상 지운다.
 * 운영에 실제로 오는 헤더가 아직 확인되지 않아(P1 병합 후 확인) 두 후보를 차례로 보고, 처음 쓴 헤더 이름만 한 번 로그에 남긴다(IP 값은 남기지 않는다).
 * 후보가 없거나 IP 형식이 아니면 X-Client-Ip를 보내지 않는다. Gateway 자신의 주소로 채우면 모든 사용자가 한 IP로 묶인다.
 */
final class ClientIp {

	static final String HEADER = "X-Client-Ip";
	static final List<String> SOURCES = List.of("x-vercel-forwarded-for", "x-real-ip");

	private static final Logger log = LoggerFactory.getLogger(ClientIp.class);
	private static final Pattern IPV4 = Pattern.compile("^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$");
	private static final Pattern IPV6_CHARS = Pattern.compile("^[0-9A-Fa-f:.]+$");

	private final AtomicBoolean sourceLogged = new AtomicBoolean();
	private final AtomicBoolean missingLogged = new AtomicBoolean();

	/** 비밀 헤더를 통과한 요청: X-Client-Ip를 Vercel 값으로 바꾸거나 지운다. */
	void forward(HttpHeaders headers) {
		headers.remove(HEADER);
		for (String source : SOURCES) {
			String value = headers.getFirst(source);
			if (value == null) {
				continue;
			}
			String ip = parse(value);
			if (ip != null) {
				headers.set(HEADER, ip);
				if (sourceLogged.compareAndSet(false, true)) {
					log.info("접속자 IP 헤더로 {}를 쓴다", source);
				}
				return;
			}
		}
		if (missingLogged.compareAndSet(false, true)) {
			log.warn("Vercel 접속자 IP 헤더({})가 없거나 IP 형식이 아니라 {}를 보내지 않는다", SOURCES, HEADER);
		}
	}

	/** 쉼표로 여러 개면 첫 값(원래 접속자). IP 리터럴이 아니면 null. DNS 조회는 하지 않는다. */
	static String parse(String value) {
		String first = value.split(",", 2)[0].trim();
		if (IPV4.matcher(first).matches()) {
			return first;
		}
		if (first.contains(":") && first.length() <= 45 && IPV6_CHARS.matcher(first).matches()) {
			try {
				// ':'가 있는 문자열은 IPv6 리터럴로만 해석하므로 이름 조회가 일어나지 않는다
				return InetAddress.getByName(first).getHostAddress();
			} catch (UnknownHostException e) {
				return null;
			}
		}
		return null;
	}
}
