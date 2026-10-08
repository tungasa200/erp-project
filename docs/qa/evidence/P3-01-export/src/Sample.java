package exp;

import java.util.List;

/** 일간 업무일지 샘플 데이터 (한글·영문·숫자·기호 섞임, 긴 줄 포함). */
public final class Sample {
	public record Row(String no, String task, String result, String time) {}

	public static final String TITLE = "업무일지 (일간)";
	public static final String DATE = "2026-10-08 (목)";
	public static final String WRITER = "홍길동 · 개발팀";
	public static final List<String> APPROVERS = List.of("담당", "팀장", "부서장");
	public static final List<String> HEADERS = List.of("No", "업무", "결과", "소요");

	public static final List<Row> ROWS = List.of(
			new Row("1", "API 계약 검토 — OAuth2 토큰 만료(30초 유예) 처리", "완료 ✔ 100%", "1h 30m"),
			new Row("2", "고객사 A/S 요청 #1234 대응: 로그 분석 → 원인 파악(메모리 누수), 패치 v1.2.3 배포 예정 ※ 재현 조건은 동시 접속 50명 이상, 응답 지연 3.2초 → 0.4초로 개선 확인, 담당자 김철수 님께 메일 회신(“금일 18:00 전 배포”)",
					"진행 중 ① 분석 ② 수정 ③ 배포", "2h 15m"),
			new Row("3", "월간 비용 정산: ₩1,250,000 / $980.50 / €12.30, 서버실 온도 23.5℃ 점검", "확인 ○", "45m"),
			new Row("4", "English-only line: Weekly sync with QA team (bug triage, 12 issues closed)", "Done", "30m"),
			new Row("5", "특수문자: ~!@#$%^&*()_+-=[]{}|;':\",./<>? · ㈜ ㉠ ㎏ ㎡ ½ ¼ ← ↑ → ↓ ★ ☆ ♥ ■ □ ▲ ▶", "기호 표시 확인", "-"));

	public static final List<String> PLAN = List.of(
			"패치 v1.2.3 운영 배포 후 모니터링(오전 10:00)",
			"주간 보고 초안 작성 — 이번 주 실적 12건, 지연 1건 사유 정리");
	public static final String NOTE = "특이사항: 없음. 다음 근무일 2026-10-12(월) — 10-09 한글날 휴무.";

	private Sample() {}
}
