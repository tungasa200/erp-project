package com.erp.common.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

class ApiExceptionHandlerTest {

	private MockMvc mvc;

	@BeforeEach
	void setUp() {
		MDC.put("traceId", "trace-1");
		mvc = MockMvcBuilders.standaloneSetup(new TestController())
			.setControllerAdvice(new ApiExceptionHandler(), new SecurityExceptionHandler())
			.build();
	}

	@AfterEach
	void tearDown() {
		MDC.clear();
	}

	@Test
	void apiException은_code와_확장필드를_담은_Problem으로_응답한다() throws Exception {
		mvc.perform(get("/locked"))
			.andExpect(status().isTooManyRequests())
			.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
			.andExpect(jsonPath("$.status").value(429))
			.andExpect(jsonPath("$.code").value("AUTH_LOCKED"))
			.andExpect(jsonPath("$.retryAfterSeconds").value(900))
			.andExpect(jsonPath("$.traceId").value("trace-1"));
	}

	@Test
	void 검증_실패는_VALIDATION_FAILED와_칸별_errors로_응답한다() throws Exception {
		mvc.perform(post("/signup").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
			.andExpect(jsonPath("$.errors[0].field").value("email"))
			.andExpect(jsonPath("$.errors[0].code").value("REQUIRED"))
			.andExpect(jsonPath("$.traceId").value("trace-1"));
	}

	@Test
	void 인증_예외는_UNAUTHENTICATED로_응답한다() throws Exception {
		mvc.perform(get("/auth-fail"))
			.andExpect(status().isUnauthorized())
			.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
	}

	@Test
	void 처리하지_못한_예외는_내부_정보_없이_INTERNAL_ERROR로_응답한다() throws Exception {
		mvc.perform(get("/boom"))
			.andExpect(status().isInternalServerError())
			.andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
			.andExpect(jsonPath("$.detail").value("일시적인 오류가 발생했습니다."));
	}

	@Test
	void Spring_표준_예외에도_code와_traceId를_붙인다() throws Exception {
		mvc.perform(post("/locked"))
			.andExpect(status().isMethodNotAllowed())
			.andExpect(header().exists("Allow"))
			.andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"))
			.andExpect(jsonPath("$.traceId").value("trace-1"));
	}

	record SignupBody(@NotBlank(message = "REQUIRED") String email) {
	}

	@RestController
	static class TestController {

		@GetMapping("/locked")
		void locked() {
			throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "AUTH_LOCKED", "15분 동안 로그인할 수 없어요.", List.of(),
					Map.of("retryAfterSeconds", 900));
		}

		@PostMapping("/signup")
		void signup(@Valid @RequestBody SignupBody body) {
		}

		@GetMapping("/auth-fail")
		void authFail() {
			throw new BadCredentialsException("x");
		}

		@GetMapping("/boom")
		void boom() {
			throw new IllegalStateException("내부 정보");
		}

	}

}
