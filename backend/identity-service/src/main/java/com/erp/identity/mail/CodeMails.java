package com.erp.identity.mail;

import com.erp.identity.mail.Mailer.Mail;

/**
 * 인증번호 메일(SCR-MAIL-01)과 비밀번호 재설정 메일(SCR-MAIL-02). 목업을 메일 제약에 맞춰 옮겼다:
 * 표 레이아웃과 인라인 CSS만, 시스템 글꼴, 키 컬러 #4B3FD6 고정, 텍스트 버전 동봉. 제목에는 코드를 넣지 않는다 (D-41).
 */
public final class CodeMails {

	private static final String FONT = "-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";

	private CodeMails() {
	}

	public static Mail emailVerification(String to, String code) {
		String intro = "아래 6자리 숫자를 worklog 인증 화면에 입력해 주세요.";
		String ignore = "직접 요청하지 않았다면 이 메일을 무시하세요. 누군가 이메일 주소를 잘못 입력했을 수 있어요.";
		return new Mail(to, "[worklog] 이메일 인증번호 안내",
				text("이메일 인증번호", intro, code, null, ignore),
				html("이메일 인증번호", intro, code, "#F1F0FC", "#292376", null, ignore));
	}

	public static Mail passwordReset(String to, String code) {
		String intro = "비밀번호 재설정 화면에 아래 6자리 숫자를 입력하고 새 비밀번호를 정해 주세요.";
		String notice = "재설정을 마치면 모든 기기에서 로그아웃돼요.";
		String ignore = "직접 요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 바뀌지 않아요.";
		return new Mail(to, "[worklog] 비밀번호 재설정 안내",
				text("비밀번호 재설정", intro, code, notice, ignore),
				html("비밀번호 재설정", intro, code, "#F2F4FA", "#1A1C2B", notice, ignore));
	}

	private static String text(String title, String intro, String code, String notice, String ignore) {
		return title + "\n\n" + intro + "\n\n" + code + "\n\n이 번호는 10분 동안만 쓸 수 있어요.\n"
				+ (notice == null ? "" : "\n" + notice + "\n") + "\n" + ignore + "\n\n이 메일은 발신 전용이에요. · worklog\n";
	}

	private static String html(String title, String intro, String code, String codeBg, String codeColor,
			String notice, String ignore) {
		String noticeRow = notice == null ? "" : """
				<tr><td style="padding:22px 0 0"><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr>\
				<td bgcolor="#FFF0C7" style="background:#FFF0C7;border-radius:10px;padding:12px 14px;font-size:13.5px;line-height:1.6;color:#6B4500">%s</td>\
				</tr></table></td></tr>
				""".formatted(notice);
		return """
				<!doctype html>
				<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>%1$s</title></head>
				<body style="margin:0;padding:0;background:#F2F4FA">
				<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F2F4FA" style="background:#F2F4FA;font-family:%2$s;color:#1A1C2B">
				<tr><td align="center" style="padding:32px 12px 24px">
				<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%%;max-width:520px;background:#FFFFFF;border-radius:16px">
				<tr><td style="padding:36px 40px">
				<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">
				<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>\
				<td width="28" height="28" align="center" bgcolor="#4B3FD6" style="width:28px;height:28px;background:#4B3FD6;border-radius:8px;color:#FFFFFF;font-weight:800;font-size:15px;line-height:28px;text-align:center">w</td>\
				<td style="padding-left:8px;font-size:17px;font-weight:800;color:#1A1C2B">worklog</td></tr></table></td></tr>
				<tr><td style="padding:28px 0 0;font-size:22px;font-weight:800;color:#1A1C2B">%1$s</td></tr>
				<tr><td style="padding:10px 0 0;font-size:15px;line-height:1.65;color:#3B3F52">%3$s</td></tr>
				<tr><td style="padding:24px 0 0"><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr>\
				<td align="center" bgcolor="%5$s" style="background:%5$s;border-radius:12px;padding:22px 0;text-align:center;font-size:38px;font-weight:800;letter-spacing:12px;color:%6$s">%4$s</td>\
				</tr></table></td></tr>
				<tr><td align="center" style="padding:14px 0 0;font-size:14px;color:#3B3F52;text-align:center">이 번호는 <b>10분</b> 동안만 쓸 수 있어요.</td></tr>
				%7$s<tr><td style="padding:%9$dpx 0 0"><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr>\
				<td style="border-top:1px solid #E1E4EE;padding-top:18px;font-size:13px;line-height:1.65;color:#5E6377">%8$s</td></tr></table></td></tr>
				</table>
				</td></tr>
				</table>
				<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.6;color:#8A8FA3;text-align:center">이 메일은 발신 전용이에요. · worklog</p>
				</td></tr>
				</table>
				</body></html>
				""".formatted(title, FONT, intro, code, codeBg, codeColor, noticeRow, ignore, notice == null ? 28 : 24);
	}

}
