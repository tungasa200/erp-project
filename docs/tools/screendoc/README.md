# docs/tools/screendoc

화면정의서 docx를 만드는 스크립트입니다. 담당 세션은 `erp-design`입니다. 문서를 고칠 때는 docx를 직접 편집하지 말고 스크립트를 고친 뒤 다시 생성합니다.

| 파일 | 역할 |
|---|---|
| `data.js` | 화면 정의 데이터(영역, 화면 57개, 추적표, WBS 매핑, 결정 사항). 내용 변경은 대부분 여기서 한다 |
| `gen-screen.js` | `../../화면정의서_<VER>.docx` 생성. 문서 구성(장 제목, 공통 규칙, 표 서식)과 `VER`·문서 이력 |

## 사용

```bash
npm install
npm run build                              # docs/화면정의서_<VER>.docx 생성
node gen-screen.js --out ./check.docx      # 검증용 임시 출력
```

새 버전을 낼 때는 `gen-screen.js`의 `VER`, 작성일, 문서 이력 행을 함께 고칩니다. 같은 이름의 docx가 이미 있으면 덮어쓰지 않고 멈춥니다(종료 코드 1). 아직 커밋하지 않은 버전을 고쳐 다시 만들 때만 `--force`를 붙입니다.

화면 목업은 별도 캔버스에 있습니다: https://claude.ai/artifact/5c4S5jtmx2yQtDFqMkF3CN (비공개, 소유자 계정에서 열림)
