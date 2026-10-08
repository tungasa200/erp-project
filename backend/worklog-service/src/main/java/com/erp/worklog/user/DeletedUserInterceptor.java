package com.erp.worklog.user;

import com.erp.common.error.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

/**
 * 탈퇴 사용자의 남은 토큰 요청을 거부한다 (AUTH-06, D-45). 거부 목록은 피드 DELETED를 반영할 때 채운다.
 */
@Component
public class DeletedUserInterceptor implements HandlerInterceptor {

	private final DeletedUserRepository deletedUsers;

	DeletedUserInterceptor(DeletedUserRepository deletedUsers) {
		this.deletedUsers = deletedUsers;
	}

	@Override
	public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
		if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken auth
				&& deletedUsers.contains(UUID.fromString(auth.getToken().getSubject()))) {
			throw userDeleted();
		}
		return true;
	}

	public static ApiException userDeleted() {
		return new ApiException(HttpStatus.UNAUTHORIZED, "USER_DELETED", "탈퇴한 사용자입니다.");
	}
}
