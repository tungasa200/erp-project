package com.erp.identity;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.erp.identity.auth.LoginProtection;

@Configuration(proxyBeanMethods = false)
public class ClockConfig {

	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}

	@Bean
	LoginProtection.Sleeper loginDelaySleeper() {
		return duration -> {
			try {
				Thread.sleep(duration);
			}
			catch (InterruptedException ex) {
				Thread.currentThread().interrupt();
			}
		};
	}

}
