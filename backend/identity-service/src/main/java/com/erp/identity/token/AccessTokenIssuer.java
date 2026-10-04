package com.erp.identity.token;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.nimbusds.jose.jwk.RSAKey;

import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

import com.erp.common.security.JwtClaimNames;

/**
 * 사용자 Access Token 발급: iss=erp-identity, aud=erp-api, sub=사용자 ID, 10분, scope 없음 (contracts/identity.yaml).
 */
@Component
public class AccessTokenIssuer {

	public static final Duration TTL = Duration.ofMinutes(10);

	private final JwtEncoder encoder;

	private final String keyId;

	private final Clock clock;

	public AccessTokenIssuer(JwtEncoder encoder, RSAKey signingKey, Clock clock) {
		this.encoder = encoder;
		this.keyId = signingKey.getKeyID();
		this.clock = clock;
	}

	public String issue(UUID userId) {
		Instant now = clock.instant();
		JwtClaimsSet claims = JwtClaimsSet.builder()
			.issuer(JwtClaimNames.ISSUER)
			.audience(List.of(JwtClaimNames.AUDIENCE_API))
			.subject(userId.toString())
			.issuedAt(now)
			.expiresAt(now.plus(TTL))
			.build();
		JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build();
		return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
	}

}
