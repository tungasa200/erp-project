package com.erp.worklog.identity;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.client.RestClient;

import java.time.Clock;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IdentityClientTest {

	@Test
	void prodRejectsMissingOrLocalClientSecret() {
		var prod = new MockEnvironment();
		prod.setActiveProfiles("prod");

		for (String secret : new String[] { null, "", IdentityClient.LOCAL_CLIENT_SECRET }) {
			assertThatThrownBy(() -> client(secret, prod)).isInstanceOf(IllegalStateException.class);
		}
		assertThatCode(() -> client("real-secret", prod)).doesNotThrowAnyException();
		assertThatCode(() -> client(IdentityClient.LOCAL_CLIENT_SECRET, new MockEnvironment())).doesNotThrowAnyException();
	}

	private static IdentityClient client(String secret, MockEnvironment env) {
		return new IdentityClient(RestClient.builder(), new IdentityProperties("http://identity", "worklog", secret),
				Clock.systemUTC(), env);
	}
}
