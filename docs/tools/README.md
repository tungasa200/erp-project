# docs/tools

요구사항정의서·작업계획서 docx를 만드는 스크립트입니다. 문서를 고칠 때는 docx를 직접 편집하지 말고 스크립트를 고친 뒤 다시 생성합니다.

| 파일 | 역할 |
|---|---|
| `gen-srs.js` | `../요구사항정의서_<VERSION>.docx` 생성 |
| `gen-plan.js` | `../작업계획서_<VERSION>.docx` 생성 |
| `lib.js` | 공통 서식 (글꼴, 표, 머리글·바닥글) |
| `crosscheck.py` | 요구사항(필수·권장, P단계) 중 WBS에 연결되지 않은 ID 검사 |

## 사용

```bash
npm install
npm run build                     # 두 문서 생성
python crosscheck.py ../요구사항정의서_v1.2.docx ../작업계획서_v1.4.docx
```

새 버전을 낼 때는 각 스크립트의 `VERSION`, 작성일, 문서 이력 행을 함께 고칩니다. 이전 버전 파일은 덮어쓰지 않습니다.

화면정의서는 별도 도구로 만들며 이 폴더에 포함되지 않습니다.
