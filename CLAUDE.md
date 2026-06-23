# CLAUDE.md — 개발/AI용 주의사항 (웹에 노출 안 함)

> 이 파일은 코드 작업하는 다음 AI/개발자를 위한 메모다. 앱은 `data/`만 읽으므로 에디터 UI/트리엔 나타나지 않는다. **여기에 비밀/민감정보는 적지 말 것**(정적 호스팅이라 URL로 접근은 가능).

## 프로젝트 한 줄 요약
PPT로만 보던 몬스터/보스 패턴을 시간축에서 시뮬레이션하는 **순수 정적 웹 에디터**. 빌드 도구·번들러·패키지 매니저 **없음**. 바닐라 ES 모듈.

## 실행
File System Access API가 보안 컨텍스트를 요구 → `file://` 더블클릭 불가. 로컬 서버로 띄운다:
`python -m http.server 8000` 후 크롬/엣지에서 `http://localhost:8000`.

## ⚠️ 가장 헷갈리는 지점: 데이터가 어디에 저장되나 (3갈래)
1. **소유자(편집자)** — `📂 폴더 열기`로 로컬 `data/` 연결 → FSA `handle`로 **실제 .json 파일** 읽기/쓰기. 이게 git에 커밋되는 정식 데이터.
2. **웹 팀원** — 사이트 접속 시 `data/manifest.json` 기반으로 **fetch 읽기 전용** 자동 로드. 편집분은 **localStorage 오버레이**(`bb-editor:web-edits`)에만 저장 → **공유 안 됨**. 노드에 `web:true`, `handle` 없고 `path`로 식별.
3. **기본 유저(하루)** — 플레이백의 `✎ 편집`. **localStorage**(`bb-editor:default-user`)에만 저장 → 파일 아님, 커밋 안 됨, 브라우저별.

→ 코드에서 파일 노드 다룰 땐 항상 `node.web` 분기 확인. 읽기는 `readEntity(node)`(main.js)로 통일돼 있음.

## ⚠️ manifest.json 은 수동 생성물
정적 호스팅은 디렉토리 목록을 못 읽어서, `data/` 안의 엔티티 목록을 `data/manifest.json`에 박아둔다.
**`data/`에 파일을 추가·삭제·이름변경하면 반드시** `node tools/gen-manifest.mjs` 재실행 후 manifest를 함께 커밋. 안 하면 웹 팀원에게 새 파일이 안 보인다.
- `buildTree`(FSA)와 `gen-manifest`는 둘 다 `manifest.json`을 엔티티에서 제외한다(추가 시 주의).

## 배포 (GitHub Pages)
- `main` 브랜치 `/(root)`에서 서빙. **main에 push = 배포.** `.nojekyll` 있음(언더스코어 파일 보존).
- 원격: `github.com/w8err/Pattern-Editor`. URL: `https://w8err.github.io/Pattern-Editor/`.
- **AI(Claude)는 main 직접 push가 자동 차단됨** → 커밋까지만 하고 push는 사용자가 직접 한다. 멋대로 push 시도하지 말 것.

## 코드 지형
- `js/model.js` — 데이터 모델·스키마·마이그레이션 단일 출처. `serialize/deserialize`.
- `js/sim.js` — **순수 시뮬레이션 코어**(캔버스 비의존, 결정론적/헤드리스). 좌표·각도 로직의 진실.
- `js/ui/stage.js` — 플레이백 캔버스 렌더 + 유저 조작(AI/수동). 캔버스는 **y 아래 방향이 +**.
- `js/ui/inspector.js`, `patterns.js`, `bt.js`, `tree.js` — 편집 UI.
- `js/storage.js` — FSA + fetch(웹) + localStorage 영속화.

## 관례
- **UI 문구는 한국어.** 주석도 한국어 톤 유지.
- 빌드/테스트 명령 없음. 검증은 `node --check <file>`(문법) + 브라우저 수동 확인. `tools/verify.mjs`로 데이터 검증 가능.
- 사용자가 명시적으로 요청할 때만 커밋/푸시.
