package com.erp.identity.client;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ServiceClientPropertiesTest {

	@Test
	void 비밀값_환경_변수가_없어_자리표시자가_그대로_들어오면_기동에_실패한다() {
		assertThatThrownBy(() -> new ServiceClientProperties.Client("${WORKLOG_CLIENT_SECRET}", "users:read"))
			.isInstanceOf(IllegalStateException.class);
		assertThatThrownBy(() -> new ServiceClientProperties.Client(" ", "users:read"))
			.isInstanceOf(IllegalStateException.class);
		new ServiceClientProperties.Client("worklog-local-secret", "users:read");
	}

}
