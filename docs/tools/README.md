# docs/tools

요구사항정의서·작업계획서 docx를 만드는 스크립트입니다. 문서를 고칠 때는 docx를 직접 편집하지 말고 스크립트를 고친 뒤 다시 생성합니다.

| 파일 | 역할 |
|---|---|
| `gen-srs.js` | `../요구사항정의서_<VERSION>.docx` 생성 |
| `gen-plan.js` | `../작업계획서_<VERSION>.docx` 생성 |
| `lib.js` | 공통 서식 (글꼴, 표, 머리글·바닥글) |
| `crosscheck.py` | 요구사항(필수·권장, P단계) 중 WBS에 연결되지 않은 ID 검사, 두 문서가 참조하는 결정 ID(D-nn)가 `../결정기록.md`에 있는지 검사 |

## 사용

```bash
npm install
npm run build                     # 두 문서 생성
PYTHONIOENCODING=utf-8 python crosscheck.py ../요구사항정의서_<VERSION>.docx ../작업계획서_<VERSION>.docx
```

새 버전을 낼 때는 각 스크립트의 `VERSION`, 작성일, 문서 이력 행을 함께 고칩니다. 이전 버전 파일은 덮어쓰지 않고, 발행할 때 `docs/trashcan/`으로 옮깁니다(git 이력이 원본).

같은 이름의 docx가 이미 있으면 스크립트는 덮어쓰지 않고 멈춥니다(종료 코드 1). `VERSION`을 올리지 않은 채 빌드해 발행된 버전을 덮어쓰는 사고를 막기 위함입니다. 아직 커밋하지 않은 버전을 고쳐 다시 만들 때만 `--force`를 붙입니다:

```bash
node gen-srs.js --force
node gen-plan.js --force
```

화면정의서는 하위 폴더 screendoc/에서 따로 만듭니다(담당 WY-design, 사용법은 screendoc/README.md).
