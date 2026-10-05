package com.erp.identity.user;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.UuidGenerator;

/**
 * 로그인 수단 (D-21). 지금은 PASSWORD만 있고, Google 로그인은 출시 후 같은 테이블에 추가한다.
 */
@Entity
@Table(name = "user_credentials")
public class UserCredential {

	public enum Provider {

		PASSWORD, GOOGLE

	}

	@Id
	@GeneratedValue
	@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
	private UUID id;

	private UUID userId;

	@Enumerated(EnumType.STRING)
	private Provider provider;

	private String providerSubject;

	private String passwordHash;

	@Column(updatable = false)
	private Instant createdAt;

	protected UserCredential() {
	}

	/** 비밀번호 로그인 수단. 이메일은 바뀔 수 있으므로 subject는 사용자 ID로 둔다. */
	public static UserCredential password(UUID userId, String passwordHash, Instant now) {
		UserCredential credential = new UserCredential();
		credential.userId = userId;
		credential.provider = Provider.PASSWORD;
		credential.providerSubject = userId.toString();
		credential.passwordHash = passwordHash;
		credential.createdAt = now;
		return credential;
	}

	public String getPasswordHash() {
		return passwordHash;
	}

}
