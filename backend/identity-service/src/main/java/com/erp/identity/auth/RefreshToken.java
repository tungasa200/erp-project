package com.erp.identity.auth;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

/**
 * Refresh Token 한 개. 원문은 쿠키에만 있고 여기에는 SHA-256만 둔다. family = 로그인 세션 1개.
 */
@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;

	private UUID userId;

	private UUID familyId;

	@JdbcTypeCode(SqlTypes.CHAR)
	private String tokenHash;

	private Instant expiresAt;

	private Instant revokedAt;

	@Column(updatable = false)
	private Instant createdAt;

	protected RefreshToken() {
	}

	RefreshToken(UUID userId, UUID familyId, String tokenHash, Instant expiresAt, Instant now) {
		this.userId = userId;
		this.familyId = familyId;
		this.tokenHash = tokenHash;
		this.expiresAt = expiresAt;
		this.createdAt = now;
	}

	boolean isExpired(Instant now) {
		return !expiresAt.isAfter(now);
	}

	void revoke(Instant now) {
		revokedAt = now;
	}

	UUID getUserId() {
		return userId;
	}

	UUID getFamilyId() {
		return familyId;
	}

	Instant getRevokedAt() {
		return revokedAt;
	}

}
