# P3-01 한글 내보내기 선행 검증 (2026-10-08, WY-backend1)

저장소 밖의 별도 gradle 프로젝트(Java 21, Gradle 9.8.0, Spring Boot BOM 4.0.8)에서 시험했다. 코드는 `src/`에 있으며, worklog 구현(P3-10) 때 그대로 옮겨 쓸 수 있다. 실행 heap은 `-Xmx256m`, 환경은 Windows 10이다.

## 샘플

일간 일지 모양으로 만들었다. 제목, 결재란(담당·팀장·부서장), 일자·작성자, 실적 표 5행, 다음 근무일 계획, 특이사항으로 구성된다. 실적 표에는 한글·영문·숫자·기호(₩ € ℃ ①②③ ※ → ㈜ ㉠ ㎏ ㎡ ✔ ★ 등)를 섞었고, 표 칸 안에서 줄이 바뀌는 긴 줄도 넣었다.

## 글꼴 (jar 리소스로 포함, 시스템 글꼴 미사용)

| 글꼴 | 라이선스 | Regular+Bold 크기 | 내장 허용(fsType) | 샘플 중 없는 글자 |
|---|---|---|---|---|
| Pretendard 1.3.9 | OFL 1.1 (예약 이름 Pretendard) | 5.4 MB | 0x0000 (설치 가능) | ✔ ㉠ |
| 나눔고딕 | OFL 1.1 | 4.1 MB | 0x0000 | ℃ ①②③ ㈜ ㉠ ㎏ ㎡ ✔ |

## 라이브러리 측정

같은 JVM에서 차례로 생성해 쟀다. cold는 첫 생성(클래스 로딩 포함)이고, warm은 이어서 5번 생성한 평균이다. alloc은 생성 1번에 할당된 양(대부분 곧 수거되는 임시 객체)이다.

| 형식·라이브러리 | 라이선스 | 런타임 jar | cold | warm | alloc | 파일 크기 |
|---|---|---|---|---|---|---|
| PDF OpenPDF 3.0.5 (Pretendard) | LGPL-2.1 / MPL-2.0 중 선택 | 2.2 MB | 0.9 s | 87 ms | 28 MB | 50 KB |
| PDF Apache PDFBox 3.0.8 (Pretendard) | Apache-2.0 | 3.7 MB | 1.9 s | 745 ms | 190 MB | 27 KB |
| PDF openhtmltopdf 1.1.93 (Pretendard, PDFBox 3.0.7 기반) | LGPL-2.1+ | 5.1 MB | 3.6~5.4 s | ~1.0 s | 291 MB | 28 KB |
| (참고) PDFBox·openhtmltopdf + 나눔고딕 | | | 0.2 s | 230~280 ms | 36 MB | 48~50 KB |
| Word POI 5.5.1 XWPF, 맑은 고딕 지정·내장 없음 | Apache-2.0 | 18.7 MB (Excel과 공용) | 2.4 s | 86 ms | 74 MB | 3.5 KB |
| Word POI + Pretendard 부분 내장 | | | 0.4 s | 350 ms | 47 MB | 160 KB |
| Word POI + Pretendard 전체 내장 | | | 1.1 s | 1.8 s | 25 MB | 2.3 MB |
| Excel POI 5.5.1 SXSSF, 맑은 고딕 지정 | Apache-2.0 | (위와 공용) | 2.3 s | 216 ms | 17 MB | 4.8 KB |

## PDF 확인 (PDFBox로 다시 읽어 검사, 1쪽을 PNG로 렌더링)

- 세 라이브러리 모두 Pretendard를 **부분 내장**(subset, `ABCDEF+Pretendard-Regular`)했다. 내장되지 않은 글꼴은 없다.
- 글자 추출(검색·복사)도 셋 다 정상이다. 다만 openhtmltopdf에 나눔고딕을 쓰면 없는 글자 대신 Times-Roman(내장 안 됨)을 끌어와 추출 검사에 실패했다.
- 글꼴에 없는 글자를 다루는 방식이 라이브러리마다 다르다.
  - OpenPDF: 그 글자를 **말없이 뺀다**(✔·㉠가 사라짐). `FontSelector`로 대체 글꼴을 쓸 수 있다.
  - openhtmltopdf: `#`으로 표시한다. CSS `font-family`에 대체 글꼴을 나열하면 된다.
  - PDFBox: **예외가 나서 생성이 실패한다**(`No glyph for U+2714`). 직접 걸러 □로 바꿔 통과시켰다.
- 줄바꿈 방식도 다르다.
  - OpenPDF: 낱말 단위로 바꾼다(가장 자연스러움).
  - openhtmltopdf: 한글 낱말 중간에서 끊는다(`패\n치`). `word-break: keep-all`도 먹지 않았다.
  - PDFBox: 줄바꿈·쪽 넘김을 모두 직접 짜야 한다. 시험 코드는 글자 단위로 끊었다(`issue\ns`).
- PDFBox 계열(PDFBox·openhtmltopdf)은 Pretendard를 다룰 때만 무겁다. 생성 1번에 0.7~1.0초, 할당 190~290 MB였고, 나눔고딕은 가볍다. 파싱 결과를 캐시해도 줄지 않았으므로 글꼴 파일 읽기가 아니라 글리프 처리 쪽 비용으로 보인다. OpenPDF는 Pretendard로도 가볍다.

## Word·Excel

- docx·xlsx는 UTF-8 XML이라 글꼴이 없어도 **글자가 깨지지 않는다**(□·물음표로 바뀌지 않음). 보는 PC에 그 글꼴이 없으면 다른 글꼴로 대신 보일 뿐이다.
- Word 글꼴 내장: POI에는 고수준 API가 없다. 저장한 zip에 `word/fontTable.xml`과 `word/fonts/*.odttf`(ECMA-376 17.8.1 방식으로 난독화)를 붙이고 settings에 `embedTrueTypeFonts`를 넣어 구현했다(약 80줄). 부분 내장은 fontbox `TTFSubsetter`로 쓴 글자만 남긴다.
  - 부분 내장 문서를 Word에서 고치면, 내장에 없던 글자는 다른 글꼴로 보인다.
  - **Word에서 실제로 열어 보는 확인은 아직 안 했다**(이 PC에 Office가 없음).
- Excel: xlsx는 글꼴을 내장할 수 없다. 글꼴 이름 `맑은 고딕`과 charset 129(HANGEUL)만 지정했다. Mac Excel은 다른 고딕으로 대신 보인다.
- 열 너비는 고정값으로 정했다. `autoSizeColumn`은 AWT 글꼴 측정을 쓰기 때문에, 글꼴이 없는 Linux 컨테이너에서는 실패하거나 너비를 잘못 잰다.

## 하지 못한 것

- **글꼴 없는 Linux 컨테이너 시험**: Docker Desktop이 꺼져 있어 eclipse-temurin 이미지에서 돌리지 못했다. PDF 경로는 jar 리소스의 글꼴 바이트만 쓰므로 시스템 글꼴과 무관하다는 것은 코드로 확인했다. 실제 컨테이너 실행은 구현 PR의 CI(ubuntu)나 Docker 차례 때 확인한다.
- Noto Sans KR: google/fonts에는 가변 글꼴(10 MB)만 있다. 고정 굵기 TTF를 따로 받아야 해서 비교하지 않았다.

## 사용자가 직접 열어 확인할 파일

1. `pdf-openpdf-Pretendard.pdf`: 추천안. 한글·기호·표·결재란 모양을 본다.
2. `docx-malgun-noembed.docx`: Word에서 연다.
3. `docx-pretendard-embed-subset.docx`, `docx-pretendard-embed-full.docx`: **Pretendard가 설치되지 않은 PC**의 Word에서 Pretendard 모양으로 보이는지 본다(파일 → 옵션 → 저장의 "파일의 글꼴 포함" 상태도 함께).
4. `xlsx-malgun.xlsx`: Excel에서 연다.
5. 비교용: `pdf-openhtmltopdf-Pretendard.pdf`, `pdf-pdfbox-Pretendard.pdf`, `*.png`
