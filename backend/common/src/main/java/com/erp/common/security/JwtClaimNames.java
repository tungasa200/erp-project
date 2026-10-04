package com.erp.common.security;

/**
 * contracts/identity.yaml에서 확정한 JWT 값. identity가 발급하고 각 서비스가 검증할 때 같은 값을 쓴다.
 */
public final class JwtClaimNames {

	public static final String ISSUER = "erp-identity";

	/** 사용자 토큰 aud. 사용자 API는 이 aud만 허용한다. */
	public static final String AUDIENCE_API = "erp-api";

	/** 서비스 토큰 aud. /internal/** 은 이 aud와 필요한 scope를 함께 확인한다. */
	public static final String AUDIENCE_INTERNAL = "erp-internal";

	/** 서비스 토큰 sub 접두사. sub = "service:" + client_id */
	public static final String SERVICE_SUBJECT_PREFIX = "service:";

	public static final String SCOPE = "scope";

	private JwtClaimNames() {
	}

}
