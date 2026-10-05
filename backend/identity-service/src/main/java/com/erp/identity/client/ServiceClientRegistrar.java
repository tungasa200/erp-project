package com.erp.identity.client;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 기동 시 설정의 서비스 클라이언트를 service_clients에 맞춘다. 비밀값이 바뀌었을 때만 해시를 다시 쓴다.
 * 설정에서 빠진 클라이언트는 지운다(설정이 유일한 원본).
 */
@Component
@EnableConfigurationProperties(ServiceClientProperties.class)
public class ServiceClientRegistrar implements ApplicationRunner {

	private final ServiceClientProperties props;

	private final JdbcTemplate jdbc;

	private final PasswordEncoder passwordEncoder;

	private final Clock clock;

	public ServiceClientRegistrar(ServiceClientProperties props, JdbcTemplate jdbc, PasswordEncoder passwordEncoder,
			Clock clock) {
		this.props = props;
		this.jdbc = jdbc;
		this.passwordEncoder = passwordEncoder;
		this.clock = clock;
	}

	@Override
	@Transactional
	public void run(ApplicationArguments args) {
		Map<String, ServiceClientProperties.Client> clients = props.serviceClients();
		clients.forEach((clientId, client) -> {
			List<String> hashes = jdbc.queryForList("SELECT secret_hash FROM service_clients WHERE client_id = ?",
					String.class, clientId);
			String hash = hashes.isEmpty() || !passwordEncoder.matches(client.secret(), hashes.get(0))
					? passwordEncoder.encode(client.secret()) : hashes.get(0);
			jdbc.update("""
					INSERT INTO service_clients (client_id, secret_hash, scopes, created_at) VALUES (?, ?, ?, ?)
					ON CONFLICT (client_id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, scopes = EXCLUDED.scopes
					""", clientId, hash, client.scopes(), OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC));
		});
		if (clients.isEmpty()) {
			jdbc.update("DELETE FROM service_clients");
		}
		else {
			jdbc.update("DELETE FROM service_clients WHERE client_id <> ALL (?)",
					(Object) clients.keySet().toArray(String[]::new));
		}
	}

}
