# BB 몬스터 패턴 에디터

PPT로만 표현하던 몬스터 패턴을 **실제 시간에서 어떻게 동작하는지** 보여주는 에디터.
(레거시 `BB_패턴_시뮬레이터.html`의 전투 시뮬 기능을 걷어내고 패턴 제작·검증 도구로 재설계)

## 실행 방법

File System Access API가 **보안 컨텍스트(localhost/https)** 를 요구하므로 `file://` 더블클릭으론 안 됩니다.
`editor/` 폴더에서 로컬 서버를 띄우세요:

```powershell
# Node가 있으면
npx serve .
# 또는 Python
python -m http.server 8080
```

그 후 **크롬/엣지**에서 `http://localhost:3000`(serve) 또는 `http://localhost:8080`(python) 접속.

## 팀 배포 (GitHub Pages)

설치 없이 **URL 접속만으로** 사용하는 방식. File System Access API는 보안 컨텍스트를 요구하는데, Pages는 https라 그대로 동작한다(단 **크롬/엣지** 권장).

**최초 1회 설정** (저장소 관리자):
1. GitHub → 저장소 → **Settings → Pages**
2. *Build and deployment* → Source: **Deploy from a branch**
3. Branch: **main** / 폴더: **/(root)** → **Save**
4. 1~2분 뒤 배포 완료. 접속 주소:

   ```
   https://w8err.github.io/Pattern-Editor/
   ```

**팀원**: 위 주소를 크롬/엣지로 열기만 하면 끝. 코드 갱신은 main에 push하면 자동 재배포된다.

## 데이터 공유 (git)

패턴 데이터(`data/`의 몬스터·보스 `.json`)는 각자 PC의 로컬 폴더에 저장되므로, 함께 작업하려면 **git으로 공유**한다.

- 작업 전: `git pull` 로 최신 데이터 받기
- 에디터에서 **📂 폴더 열기** → 로컬 clone의 **`data/`** 폴더 선택 → 편집·저장
- 작업 후: `git add data && git commit && git push`

> 주의: 두 사람이 **같은 .json**을 동시에 수정하면 git 충돌이 난다(엔티티 1개 = 파일 1개라 서로 다른 몬스터를 맡으면 충돌 없음). 작업 전 pull 습관화 권장.

## 사용

1. **📂 폴더 열기** → 데이터를 저장할 실제 폴더 선택 (clone한 repo의 `data/`)
2. 사이드 툴바: `📁＋`(폴더) · `👑＋`(보스) · `👾＋`(몬스터) · `🗑`(삭제)
3. 파일 선택 → 우측 인스펙터에서 편집 → **💾 저장** (엔티티 1개 = `.json` 1개)
4. 다음 접속 시 상단 **↻ 다시 열기**로 같은 폴더 재연결

## 구조 (ES 모듈)

```
editor/
  index.html
  css/style.css
  js/
    model.js        데이터 모델(엔티티/패턴/이벤트/BT) 단일 출처
    storage.js      File System Access API 영속화 + 트리 빌드
    main.js         엔트리/툴바 배선
    ui/
      tree.js       디렉토리 트리(유니티 Project 탭 스타일)
      inspector.js  엔티티 속성 폼
```

## 구현 로드맵

- [x] ① 데이터 모델 + 디렉토리 트리 + 저장/로드 + 기본 속성 폼
- [x] ② 패턴 리스트 편집
- [x] ③ 이벤트 인스펙터(공격/걷기/대쉬/투사체/지형/복합) + 미니 타임라인
- [x] ④ 스크럽(플레이백 시간바)
- [x] ⑤ 플레이백 엔진(단일/BT 토글) + 더미 유저 드래그/경로
- [ ] ⑥ BT 병합표 에디터
- [ ] ⑦ 대쉬·투사체 커스텀 경로 에디터(별도 창)
- [x] ⑧ 기존 데이터(적산/천구/아현/유웅/볼케이노) 신포맷 이전
