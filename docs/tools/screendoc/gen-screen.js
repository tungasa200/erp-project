const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, HeadingLevel, BorderStyle, Header, Footer, PageNumber, LevelFormat, PageBreak
} = require('docx');
const { areas, screens, gaps, decisions, trace, wbs } = require('./data');
const VER = 'v1.4';
const order = areas.map((a) => a[0]);
screens.sort((x, y) => (order.indexOf(x.id.split('-')[1]) - order.indexOf(y.id.split('-')[1])) || x.id.localeCompare(y.id));

const FONT = 'Malgun Gothic';
const NAVY = '1F4E79';
const HEAD_FILL = 'DCE6F1';
const SUB_FILL = 'F2F5FA';
const W = 9026;

const run = (text, o = {}) => new TextRun({ text, font: FONT, ...o });
const p = (text, o = {}) => new Paragraph({ children: [run(text, o.run || {})], spacing: { after: 100, line: 300 }, ...o.para });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(t)] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(t)] });
const bullet = (t) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, children: [run(t)], spacing: { after: 60, line: 300 } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const border = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(content, width, o = {}) {
  const lines = Array.isArray(content) ? content : [content];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: o.span,
    shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    borders,
    children: (lines.length ? lines : ['']).map((l) => new Paragraph({
      alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 20, line: 276 },
      children: [run(l, { size: 18, bold: !!o.bold })]
    }))
  });
}

function table(widths, header, rows) {
  const trs = [];
  if (header) trs.push(new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, widths[i], { fill: HEAD_FILL, bold: true, center: true })) }));
  rows.forEach((r) => trs.push(new TableRow({ children: r.map((c, i) => cell(c, widths[i])) })));
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows: trs });
}

// 화면 상세 표: 4열(라벨·값·라벨·값), 긴 항목은 값 3열 병합
function screenTable(s) {
  const L = 1300, V = 3213;
  const widths = [L, V, L, V];
  const lab = (t) => cell(t, L, { fill: SUB_FILL, bold: true });
  const full = (label, content) => new TableRow({ children: [lab(label), cell(content, V * 2 + L, { span: 3 })] });
  const rows = [
    new TableRow({ children: [lab('화면 ID'), cell(s.id, V, { bold: true }), lab('화면명'), cell(s.name, V, { bold: true })] }),
    new TableRow({ children: [lab('유형'), cell(s.type, V), lab('경로'), cell(s.path, V)] }),
    new TableRow({ children: [lab('단계'), cell(s.phase, V), lab('요구사항'), cell(s.req, V)] }),
    full('목적', s.purpose),
    full('진입 경로', s.entry),
    full('구성 요소', s.parts)
  ];
  if (s.actions.length) rows.push(full('주요 동작', s.actions.map((a) => '· ' + a)));
  if (s.states.length) rows.push(full('상태·예외', s.states.map((a) => '· ' + a)));
  if (s.note) rows.push(full('비고', s.note));
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows });
}

const gap = () => new Paragraph({ children: [], spacing: { after: 160 } });
const body = [];

// ── 표지
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 3000, after: 200 }, children: [run('화면 정의서', { bold: true, color: NAVY, size: 52 })] }));
body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1600 }, children: [run('개인용 업무기록 · 업무일지 · 스케줄 관리 모듈 (worklog)', { size: 28 })] }));
body.push(table([2200, 6826], ['항목', '내용'], [
  ['문서 버전', VER],
  ['작성일', '2026-10-04'],
  ['문서 상태', '확정 — 요구사항정의서 v1.6·작업계획서 v1.8 기준'],
  ['근거 문서', '요구사항정의서_v1.6.docx, 작업계획서_v1.8.docx'],
  ['화면 목업', 'worklog 화면 목업 캔버스 (57개 화면) — https://claude.ai/artifact/5c4S5jtmx2yQtDFqMkF3CN'],
  ['디자인 시안', 'worklog 디자인 시안 캔버스 (C안 채택 근거) — https://claude.ai/artifact/S6uPnFkrq77jibZMkcwyzM'],
  ['정의 화면 수', `${screens.length}개 (MVP ${screens.filter((s) => s.ph !== 'U1').length}개 + 출시 후 ${screens.filter((s) => s.ph === 'U1').length}개)`]
]));
body.push(gap());
body.push(p('문서 이력', { run: { bold: true } }));
body.push(table([1200, 1600, 6226], ['버전', '일자', '변경 내용'], [
  ['v1.0', '2026-10-03', '최초 작성. 요구사항 v1.1 전체와 디자인 결정(C안, 홈 대시보드, 연·월·주·일·목록 캘린더, 테마 설정)을 반영해 전체 화면 정의, 요구사항 대비 누락 항목 분석'],
  ['v1.1', '2026-10-04', '요구사항 v1.2 ID 반영(G-01~G-14 해소), 결정 D-22~D-26 반영(글꼴 Pretendard, 반복 일정 범위 2가지, 공휴일 정적 데이터). 인증 결정(D-16~D-21) 반영: 이메일 인증 코드 입력·미인증 배너·내보내기 전 인증·메일 2종 추가, 비밀번호 찾기·재설정 P1 이동, 로그인 지연·잠금 안내. 7장 WBS 대비 화면 매핑 신설(작업계획서 v1.4 P1-11~14, P4-08~12, U1-03 기준). 비밀번호 재설정을 코드 방식으로 정의(AUTH-03)'],
  ['v1.2', '2026-10-04', '요구사항 v1.4·작업계획서 v1.6 기준으로 갱신(정합성 점검 결정 반영: 비밀번호 규칙, 확인 대기 7일, 시간대 변경 시 날짜 유지, 메일 제목에서 인증번호 제외, 결재란, UX-03 예외 3종, UX-09 단축키). 업무 요일·테마 저장 위치를 identity 프로필로 변경, 가입 화면 국외 보관 안내와 처리방침 국외 이전 항목 추가, 2.6 문구 말투(D-36) 신설, 2.5에 칸별 오류·문의 코드(D-35)·동시 수정 충돌(D-30) 규칙 추가, 화면 목업 캔버스 링크 추가'],
  ['v1.3', '2026-10-04', '요구사항 v1.5·작업계획서 v1.7 기준. 2.2에 키 컬러 파생 토큰 9종(공식·기본값) 추가, 2.3에 확인 대기 색 값 명시, 2.5에 인증 오류 코드별 문구(탈퇴 계정 재가입 안내 포함)와 프로필 미로딩(503) 자동 재시도 규칙 추가, SCR-SYS-02 점검 화면에 Retry-After 시각 표시. 목업 57개 렌더링 검증 완료(캔버스 v18)'],
  ['v1.4', '2026-10-04', '요구사항 v1.6·작업계획서 v1.8 기준. 오프라인 띠를 로그인 전 화면에도 표시하고 배치(화면을 밀어냄, 모바일 한 줄) 명시(NFR-13), 점검 화면은 MAINTENANCE 응답일 때만(D-48), 전체 화면 오류 페이지 치수는 SCR-SYS-01 기준, 문의 코드가 없는 오류(502·네트워크)는 문의 코드 줄 숨김, 모바일 하단 탭 아이콘은 P4-03에서 추가. 8.1에 D-48·D-49 추가']
]));
body.push(pageBreak());

// ── 1. 개요
body.push(h1('1. 개요'));
body.push(h2('1.1 목적'));
body.push(p('본 문서는 worklog의 모든 화면을 정의한다. 각 화면의 목적, 진입 경로, 구성 요소, 동작, 예외 상태를 정해 프론트엔드 구현(P0-07 이후)과 테스트의 기준으로 삼는다. 요구사항 ID와 화면 ID를 연결해(6장) 빠진 기능이 없는지 확인한다.'));
body.push(h2('1.2 범위'));
body.push(bullet('반응형 웹(데스크톱·태블릿·모바일 360px 이상)과 P4의 PWA'));
body.push(bullet('MVP(P0~P4) 화면 전체, 서비스가 보내는 메일, 출시 후 1차 업데이트(U1) 회사 양식 매핑 화면'));
body.push(bullet('요구사항에서 "선택"·"폐기"로 분류된 기능(하위 업무, 외부 캘린더, AI 요약, 한글 내보내기 등)은 제외'));
body.push(h2('1.3 화면 ID 체계'));
body.push(p('SCR-{영역}-{번호} 형식을 쓴다. 번호는 영역 안에서 두 자리로 매기며, 삭제된 ID는 재사용하지 않는다.'));
body.push(table([1300, 1800, 4126, 1800], ['영역 코드', '영역', '설명', '화면 수'], areas.map((a) => [a[0], a[1], a[2], String(screens.filter((s) => s.id.split('-')[1] === a[0]).length)])));
body.push(h2('1.4 화면 유형'));
body.push(table([2000, 7026], ['유형', '정의'], [
  ['페이지', '고유 URL을 가진 전체 화면'],
  ['패널', '화면 한쪽에서 열리는 시트. 데스크톱은 우측, 모바일은 전체 화면'],
  ['모달·다이얼로그', '화면 위에 뜨는 창. 다이얼로그는 선택·확인만 받는 작은 모달'],
  ['팝오버', '클릭한 요소 옆에 붙어 뜨는 작은 창'],
  ['바텀시트', '모바일 하단에서 올라오는 시트'],
  ['토스트', '잠시 나타났다 사라지는 알림'],
  ['전역 컴포넌트', '여러 화면에 공통으로 들어가는 요소(빠른 입력창 등)']
]));

// ── 2. 디자인 기준
body.push(h1('2. 디자인 기준'));
body.push(h2('2.1 디자인 방향'));
body.push(p('C안 "친근한 플래너"를 채택한다. 둥근 카드(모서리 16~24px), 넉넉한 여백, 굵은 숫자로 현황을 먼저 보여 주고, 프로젝트를 색으로 구분한다. UI 글꼴은 Pretendard(D-26, 시안은 Gothic A1로 그렸으나 느낌이 같다)이며, 내보내기 문서는 NFR-11에 따라 별도 한글 폰트를 내장한다.'));
body.push(h2('2.2 색 체계'));
body.push(table([2200, 2000, 4826], ['구분', '값', '규칙'], [
  ['키 컬러', '사용자 설정 (기본 #4B3FD6)', '버튼, 선택된 메뉴, 오늘 표시, 현재 시각선. 설정 > 테마에서 변경'],
  ['배경', '사용자 설정 (기본 #F2F4FA)', '카드 뒤 바탕. 카드는 흰색 고정'],
  ['파생 색', '키 컬러에서 자동 계산', '아래 "키 컬러 파생 토큰" 표. 키 컬러 위 글자색은 대비 4.5:1 이상이 되도록 흰색/검은색 자동 선택'],
  ['프로젝트 색', '전용 팔레트 8색', '프로젝트마다 지정. 테마와 무관하게 고정'],
  ['기록 상태 색', '2.3 참조', '테마와 무관하게 고정'],
  ['텍스트', '#1A1C2B / 보조 #5E6377', '보조 텍스트도 흰 배경 대비 4.5:1 이상'],
  ['위험', '#A02613', '마감 초과, 공휴일, 삭제']
]));
body.push(p('키 컬러 파생 토큰 (혼합 = 각 RGB 채널을 비율만큼 섞음. 괄호는 기본 키 컬러 #4B3FD6일 때 값)', { run: { bold: true } }));
body.push(table([2300, 3000, 3726], ['토큰', '계산', '용도'], [
  ['accent', '사용자 선택 (#4B3FD6)', '주 버튼, 선택된 메뉴, 오늘 표시, 현재 시각선'],
  ['on-accent', '흰색/#1A1C2B 중 대비 큰 쪽 (#FFFFFF)', 'accent 위 글자'],
  ['accent-soft', '흰색 88% 혼합 (#E9E8FA)', '선택된 탭·칩·아이콘 배경, 안내 띠'],
  ['accent-softer', '흰색 92% 혼합 (#F1F0FC)', '선택된 목록 행·라디오 카드 배경'],
  ['accent-faint', '흰색 95% 혼합 (#F6F5FD)', '캘린더 오늘 열·오늘 칸 배경'],
  ['accent-light', '흰색 45% 혼합 (#9C95E8)', '어두운 카드(#1A1C2B) 위 강조 버튼·진행 막대, 토스트 되돌리기 버튼'],
  ['accent-ink', '검정 20% 혼합 (#3C32AB)', 'accent-soft 계열 배경 위 글자, 링크 hover'],
  ['accent-ink-strong', '검정 45% 혼합 (#292376)', 'accent-soft 안내 띠 본문 글자'],
  ['accent-shadow', 'accent RGB + 투명도 0.3', '주 버튼·떠 있는 버튼 그림자']
]));
body.push(p('구현 시 사용자가 고른 2가지 값만 저장하고, 나머지는 프론트엔드에서 CSS 변수로 계산한다.', { run: { size: 18, color: '595959' } }));
body.push(h2('2.3 기록 상태 표현'));
body.push(p('앱 전체(홈, 캘린더, 업무 상세, 일지)에서 같은 표현을 쓴다. 색만으로 구분하지 않도록 테두리 모양과 문구를 함께 바꾼다.'));
body.push(table([1600, 4000, 3426], ['상태', '표현', '의미'], [
  ['계획', '프로젝트 연한 색 + 점선 테두리, "예정"', '아직 시작 전인 일정'],
  ['진행 중', '프로젝트 연한 색 + 실선 테두리, "지금"', '현재 시각이 포함된 일정'],
  ['확인 대기', '배경 #FFE9B8 + 2px 실선 #E0A100, 글자 #4A3000, "확인해 주세요" 태그(#E0A100 위 #2A1B00). 목록 카드형(확인 대기 목록·하루 마감)은 배경 #FFF7E3 + 테두리 #F2C54A', '끝났지만 사용자가 아직 확인하지 않음. 일지에 넣지 않음'],
  ['확정', '프로젝트 진한 색 채움 + 흰 글자, "완료"', '업무 기록으로 확정. 일지 실적에 반영'],
  ['하지 않음', '회색 + 취소선', '사용자가 "안 했어요"로 처리']
]));
body.push(h2('2.4 반응형 기준'));
body.push(table([1700, 1900, 5426], ['구간', '폭', '레이아웃'], [
  ['모바일', '360~767px', '하단 탭, 카드 세로 1열, 패널·모달은 전체 화면, 캘린더 기본 보기는 일 보기'],
  ['태블릿', '768~1023px', '아이콘 사이드바, 카드 2열, 캘린더 업무 패널은 접힘'],
  ['데스크톱', '1024px 이상', '전체 사이드바, 카드 3열, 캘린더 좌측 사이드바 + 우측 업무 패널']
]));
body.push(h2('2.5 공통 상호작용 규칙'));
body.push(bullet('삭제·변경은 확인창 없이 바로 실행하고 되돌리기 토스트를 띄운다(UX-03). 예외: 일지 확정 해제, 회원 탈퇴, 일지 원본에서 다시 채우기'));
body.push(bullet('입력은 자동 저장한다. 저장 버튼은 새로 만드는 모달에만 둔다'));
body.push(bullet('로딩은 스켈레톤으로 표시하고, 0.3초 안에 끝나면 표시하지 않는다'));
body.push(bullet('모든 목록은 빈 상태 문구와 다음 행동(버튼 또는 입력 안내)을 갖는다'));
body.push(bullet('입력 오류는 해당 칸 아래에 표시한다. 서버가 돌려준 칸별 오류(errors[])도 같은 자리에 표시하고, 화면에 없는 칸의 오류만 토스트로 알린다'));
body.push(bullet('저장·통신 오류는 토스트로 알리고 다시 시도 버튼을 둔다. 서버 오류(5xx)에는 문의 코드(traceId)와 복사 버튼을 함께 보여 준다(D-35, 오류 추적 도구 없이 로그를 찾는 단서). 응답에 traceId가 없으면(Gateway 앞단 502, 네트워크 오류 등) 문의 코드 줄은 표시하지 않는다'));
body.push(bullet('동시 수정 충돌(409, D-30): 편집 화면 상단에 "다른 곳에서 먼저 수정됐어요. 이 변경은 저장되지 않았어요" 띠와 [새로 불러오기]를 표시한다. 긴 글을 고치는 일지 편집은 [내 수정 내용 복사]도 함께 둔다'));
body.push(bullet('터치 영역 44px 이상, 키보드만으로 모든 동작 가능, 포커스 표시는 키 컬러 테두리'));
body.push(p('키보드 단축키', { run: { bold: true } }));
body.push(table([2600, 6426], ['키', '동작'], [
  ['Ctrl+K / ⌘K', '명령 팔레트'],
  ['N', '빠른 입력창으로 이동 (단축키 전체: UX-09)'],
  ['Ctrl+Z / ⌘Z', '되돌리기'],
  ['D · W · M · Y · A', '캘린더 일 · 주 · 월 · 연 · 목록 보기'],
  ['T / J · K', '캘린더 오늘로 / 이전 · 다음 기간'],
  ['C / P', '캘린더 일정 만들기 / 업무 패널 열고 닫기'],
  ['공통 규칙', '수식키 없는 한 글자 단축키는 입력창에 포커스가 있으면 동작하지 않고, 설정 › 일반에서 끌 수 있다. 한글 입력 상태에서도 동작하도록 물리 키(event.code)로 판별한다. 보기 전환 D/W/M/Y/A는 SCH-01, 나머지는 UX-09'],
  ['Esc', '팝오버·모달 닫기, 입력 취소']
]));

body.push(p('인증 오류 코드별 문구 (원본 코드 목록은 contracts/identity.yaml). 가입 화면은 사무적인 말투, 그 외 화면은 친근한 말투를 쓴다(2.6).', { run: { bold: true } }));
body.push(table([2700, 1900, 4426], ['오류 코드', '표시 위치', '문구'], [
  ['INVALID_CREDENTIALS', '로그인 폼 위 안내', '이메일 또는 비밀번호가 맞지 않아요 (어느 쪽인지 밝히지 않음. 탈퇴한 계정으로 로그인을 시도해도 이 문구)'],
  ['AUTH_LOCKED', '로그인 폼 위 안내 + 버튼', '15분 동안 로그인할 수 없어요. / 비밀번호를 10번 잘못 입력했어요. 비밀번호가 기억나지 않으면 재설정하세요.(재설정 링크) / 버튼: 로그인 · m:ss 후 가능'],
  ['TOO_MANY_REQUESTS', '로그인: 폼 위 안내 + 버튼 카운트다운 / 그 외: 토스트', '잠시 후 다시 시도해 주세요'],
  ['EMAIL_INVALID', '이메일 칸 아래', '가입: 이메일 형식이 올바르지 않습니다. / 로그인·비밀번호 찾기: 이메일 형식이 맞지 않아요'],
  ['PASSWORD_LENGTH, PASSWORD_LETTER_DIGIT_REQUIRED, PASSWORD_SAME_AS_EMAIL', '비밀번호 칸 아래 + 규칙 목록', '가입: 비밀번호 규칙을 확인해 주십시오. / 재설정·변경: 비밀번호 규칙을 확인해 주세요. — 어긴 규칙만 규칙 목록에서 빨간색으로 표시'],
  ['PASSWORD_TOO_LONG_BYTES', '비밀번호 칸 아래', '가입: 비밀번호가 너무 깁니다. 한글은 한 글자가 영문보다 많은 자리를 차지합니다. / 재설정·변경: 비밀번호가 너무 길어요. 한글은 한 글자가 더 많은 자리를 차지해요.'],
  ['EMAIL_ALREADY_EXISTS', '이메일 칸 아래', '이미 가입된 이메일입니다. + [로그인하기] 링크'],
  ['AGREEMENT_REQUIRED', '동의 영역 아래', '필수 항목에 모두 동의해야 가입할 수 있습니다.'],
  ['REQUIRED', '해당 칸 아래', '가입: 필수 입력 항목입니다. / 그 외: 입력해 주세요'],
  ['REFRESH_INVALID, UNAUTHENTICATED', '로그인 화면 위 (로그인 중이던 사용자에게만)', '다시 로그인해 주세요. 로그인 후 보던 화면으로 돌아가요.'],
  ['USER_DELETED', '로그인 화면 위 (다른 기기에서 탈퇴해 이 기기의 세션이 끊긴 경우에만 발생)', '탈퇴 처리된 계정입니다. 같은 이메일로 다시 가입할 수 있습니다. + [회원가입] 링크 (탈퇴 안내라 사무적인 말투. 탈퇴한 이메일은 보관하지 않으므로 즉시 재가입 가능)']
]));
body.push(p('프로필을 아직 불러오지 못함(503 PROFILE_UNAVAILABLE, 가입 직후 첫 요청 등): 오류 화면을 바로 띄우지 않고 스켈레톤을 유지한 채 자동으로 최대 3번 다시 시도한다(1초·2초·4초 간격). 그래도 실패하면 서버 오류 공통 규칙(문의 코드 + 다시 시도)을 따른다. 첫 화면에서 오류부터 보이지 않게 하려는 것이다.'));

body.push(h2('2.6 문구 말투'));
body.push(p('화면 성격에 따라 말투를 나눈다(D-36).'));
body.push(table([2400, 2200, 4426], ['구분', '말투', '적용 화면'], [
  ['기본', '친근한 존댓말 (~해요)', '홈, 캘린더, 업무, 업무일지, 설정 등 대부분의 화면과 토스트·안내 문구'],
  ['법적 고지·계정 처리', '사무적인 말투 (~합니다)', '회원가입(SCR-AUTH-03), 개인정보 처리방침(SCR-AUTH-06), 이용약관(SCR-AUTH-07), 국외 이전 안내, 회원 탈퇴(SCR-SET-07)']
]));

// ── 3. 화면 구조
body.push(h1('3. 화면 구조'));
body.push(h2('3.1 사이트맵'));
body.push(table([2200, 6826], ['구역', '화면'], [
  ['공개(비로그인)', '랜딩(/) · 로그인 · 회원가입 · 비밀번호 찾기 · 비밀번호 재설정 · 개인정보 처리방침 · 이용약관'],
  ['홈', '홈 대시보드 ─ 확인 대기 목록 · 빈 시간 메우기 · 하루 마감'],
  ['캘린더', '일 · 주 · 월 · 연 · 목록 보기 ─ 일정 빠른 생성 · 일정 상세 · 반복 범위 선택 · 업무 패널'],
  ['업무', '업무 목록 ─ 업무 상세 · 완료 결과 입력 · 보관함'],
  ['업무일지', '일지 목록 ─ 일지 상세(일간·주간·월간) · 확정 해제·이력 · 내보내기'],
  ['통계', '통계'],
  ['설정', '프로필 · 일반 · 기록 옵션 · 테마 · 알림 · 계정(회원 탈퇴) · 프로젝트·태그 · 회사 양식(U1)'],
  ['전역', '앱 셸 · 빠른 입력창 · 명령 팔레트 · 되돌리기 토스트 · 알림 센터 · 타이머 · 미인증 배너 · 이메일 인증 코드 입력 · 기록 추가·수정 · 프로필 입력 요청'],
  ['모바일', '하단 탭 · 빠른 기록 바텀시트 · PWA 설치 안내'],
  ['시스템', '404 · 오류·연결 끊김'],
  ['메일', '인증번호 메일 · 비밀번호 재설정 메일']
]));
body.push(h2('3.2 내비게이션'));
body.push(bullet('데스크톱 사이드바: 홈 · 캘린더 · 업무 · 업무일지 · 통계 / 프로젝트 목록 / 설정'));
body.push(bullet('모바일 하단 탭: 홈 · 캘린더 · [빠른 기록] · 일지 · 더보기(업무, 통계, 설정). P0~P3은 글자만 두고, 탭 아이콘은 P4-03에서 추가한다(빠른 기록 버튼은 처음부터 아이콘)'));
body.push(bullet('어느 화면에서든 명령 팔레트(Ctrl+K)로 이동과 동작 실행'));
body.push(h2('3.3 핵심 사용자 흐름'));
body.push(table([2000, 7026], ['흐름', '화면 순서'], [
  ['첫 사용', '회원가입 → 홈(첫 실행 빈 상태 + 미인증 배너) → 빠른 입력으로 첫 업무 → 캘린더에 배치'],
  ['이메일 인증', '가입 → 인증번호 메일 → (원할 때) 배너의 인증하기 → 코드 입력 / 미인증 상태로 첫 내보내기 → 인증 요구 → 코드 입력 → 내보내기 이어서 진행'],
  ['계정 되찾기', '비밀번호 찾기 → 재설정 인증번호 메일 → 코드 입력 → 새 비밀번호 저장 → 이메일 인증 완료 + 모든 기기 로그아웃 → 로그인'],
  ['하루 기록', '빠른 입력 → (캘린더 배치) → 일정 종료 → 확인 대기 → 했어요 → 일지 카드 자동 갱신'],
  ['업무 완료', '업무 체크 → 완료 결과 입력(결과 한 줄) → 일지 실적 반영'],
  ['하루 마감', '홈 하루 마감 버튼 또는 알림 → 1단계 확인 대기 → 2단계 이월 → 3단계 이슈 → 확정 → (주 마지막 근무일) 주간 일지 제안'],
  ['제출', '일지 목록 → 일지 상세 확인·수정 → 확정 → 내보내기(Word·PDF·Excel·복사)'],
  ['과거 기록 수정', '캘린더 일 보기 → 이날의 기록 → 기록 수정 (확정 일지에는 영향 없음 안내)']
]));

// ── 4. 화면 목록
body.push(h1('4. 화면 목록'));
body.push(table([1450, 2150, 1500, 2026, 900, 1000], ['화면 ID', '화면명', '유형', '경로', '단계', '목업'],
  screens.map((s) => [s.id, s.name, s.type.replace(/\(.*\)/, ''), s.path.length > 40 ? s.path.slice(0, 38) + '…' : s.path, s.ph, '있음'])));
body.push(gap());
body.push(p('단계별 화면 수(주 구현 단계 기준)', { run: { bold: true } }));
const phases = ['P0', 'P1', 'P2', 'P3', 'P4', 'U1'];
body.push(table([1500, 1100, 6426], ['단계', '화면 수', '화면'], phases.map((ph) => {
  const list = screens.filter((s) => s.ph === ph);
  return [ph, String(list.length), list.map((s) => s.name).join(', ')];
})));
body.push(p('홈 대시보드는 P1에 화면을 만들고 P2·P3에서 영역을 채워 나간다(SCR-HOME-01 비고 참조).', { run: { size: 18, color: '595959' } }));

// ── 5. 화면 상세
body.push(h1('5. 화면 상세 정의'));
areas.forEach((a, ai) => {
  const list = screens.filter((s) => s.id.split('-')[1] === a[0]);
  body.push(h2(`5.${ai + 1} ${a[1]} (${a[0]})`));
  list.sort((x, y) => x.id.localeCompare(y.id)).forEach((s) => {
    body.push(h3(`${s.id} ${s.name}`));
    body.push(screenTable(s));
    body.push(gap());
  });
});

// ── 6. 요구사항 추적표
body.push(h1('6. 요구사항 대비 화면 추적표'));
body.push(p('요구사항정의서 v1.6의 필수·권장 요구사항이 어느 화면에서 구현되는지 연결한다. 선택·폐기·출시 후 항목(AUTH-10 Google 로그인, EXP-08 내 데이터 내려받기 등)은 제외한다. 모든 필수·권장 요구사항이 하나 이상의 화면에 연결되어 있다.'));
body.push(table([1500, 2800, 4726], ['요구사항 ID', '요구사항', '화면'], trace));

// ── 7. WBS 대비 화면
body.push(h1('7. 작업계획 WBS 대비 화면'));
body.push(p('작업계획서 v1.8의 WBS 항목별로 구현할 화면이다. API만 다루는 항목(P0-01~06, P0-08~11, P3-01, P4-13 등)은 제외한다.'));
body.push(table([1300, 2700, 5026], ['WBS', '작업', '화면'], wbs));

// ── 8. 결정 사항과 v1.0 분석 반영
body.push(h1('8. 결정 사항과 v1.0 분석 반영 현황'));
body.push(h2('8.1 화면 관련 결정 사항'));
body.push(table([1200, 2000, 5826], ['번호', '항목', '결정'], decisions));
body.push(h2('8.2 v1.0 분석 결과 반영 현황'));
body.push(p('v1.0에서 찾은 요구사항 누락·변경 항목 14건은 모두 요구사항정의서 v1.2에 반영되었다(저장 위치는 v1.3 기준).'));
body.push(table([800, 2300, 3426, 2500], ['ID', '항목', '반영 결과', '관련 화면'], gaps));

const doc = new Document({
  creator: 'worklog',
  title: '화면 정의서 ' + VER,
  styles: {
    default: { document: { run: { font: FONT, size: 20 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 30, bold: true, color: NAVY },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 24, bold: true, color: '262626' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 21, bold: true, color: NAVY },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2, keepNext: true } }
    ]
  },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run('worklog 화면 정의서 ' + VER + '', { size: 16, color: '808080' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT, size: 16, color: '808080', children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES] })] })] }) },
    children: body
  }]
});

// 기본 출력: docs/화면정의서_<VER>.docx. 발행된 버전을 덮어쓰지 않도록 이미 있으면 멈춘다(--force로 허용).
// --out <경로>는 검증용 임시 출력.
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : path.join(__dirname, '..', '..', `화면정의서_${VER}.docx`);
if (outIdx < 0 && fs.existsSync(out) && !args.includes('--force')) {
  console.error(`이미 있음: ${out}\nVER를 올리거나, 아직 커밋하지 않은 버전이면 --force로 다시 만드세요.`);
  process.exit(1);
}
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log('written', out, buf.length);
});
