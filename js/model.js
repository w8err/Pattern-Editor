// ============================================================
//  BB 몬스터 패턴 에디터 — 데이터 모델 (단일 출처)
//  파일 1개 = 엔티티(보스/몬스터) 1개. 디렉토리 트리는 자유 분류.
// ============================================================

export const SCHEMA_VERSION = 1;

// ── 상수 ─────────────────────────────────────────
export const KINDS          = ['monster', 'boss', 'user'];
export const MODES          = ['공격', '수비', '특수'];
// '복합'은 타입이 아니라 모든 이벤트의 플래그(composite)로 표현.
export const EVENT_TYPES    = ['대기', '추적', '공격', '걷기', '대쉬', '순간이동', '투사체', '지형', '몸회전', '모드전환', '음표카운터', '공격각도', '회복'];
// 투사체 발사 방향 모드. 유저조준=발사 순간 유저 위치. 랜덤360=무작위 전방위. 균일360=count발 균등 전방위. 공격각도내 랜덤=부채꼴 안 무작위.
export const PROJ_DIRS       = ['직선', '유저조준', '랜덤360', '균일360', '공격각도내 랜덤', '커스텀'];
export const TELEPORT_DEST  = ['유저로부터 랜덤', '유저 위치', '맵 랜덤']; // 순간이동 도착지
export const MODE_SWITCH    = ['토글', '공격', '수비']; // 모드전환 대상
export const TERRAIN_TYPES  = ['지진', '둔화', '용암'];
export const ATTACK_SHAPES  = ['원형', '사각형'];
// 공격 범위 기준
export const ATTACK_AREAS   = ['지름', '길이와폭', '나로부터거리', '특정지역'];
// 특정지역 종류
export const ATTACK_ZONES   = ['맵전체', '유저마지막위치', '유저추적'];
// 대쉬 방향. 뒤대각=유저 반대 ±45° 직선. 뒤곡선=뒤로 빠졌다가 대각으로 휘는 곡선. 좌우=좌/우 랜덤 측면.
// 뒤대각·뒤곡선·좌우의 좌/우는 랜덤(seeded). 모두 진입 시점의 유저 위치 기준으로 축 고정.
export const DASH_DIRS      = ['직선', '후퇴', '뒤대각', '뒤곡선', '좌우', '왼쪽', '오른쪽', '커스텀'];
// 투사체 소멸 후 액션
export const PROJ_EXPIRE    = ['없음', '몬스터소환', '공격', '지형생성'];
// 지형 생성 위치
export const TERRAIN_POS    = ['유저 위치', '몬스터 위치', '맵 랜덤'];

export const uid = () =>
  (crypto?.randomUUID?.() ?? 'id-' + Math.random().toString(36).slice(2, 10));

// ── 팩토리 ───────────────────────────────────────
// 유저(플레이어 AI) 데이터 — 몬스터/보스처럼 .json으로 저장. 스탯 = 레거시 하루 기본값 + 스티어링.
export function newUser() {
  return {
    schema: SCHEMA_VERSION, id: uid(), name: '새 유저', kind: 'user',
    size: 0.5, hp: 2000,
    moveSpeed: 5, rotationSpeed: 720, basicRange: 2.5,
    // 대시(회피)
    dashDist: 4.5, dashDur: 0.5, dashInvuln: 0.12, dashStamina: 100,
    maxStamina: 400, staminaRegen: 125,
    // 회피 AI
    dodgeChance: 0.6, reactionTime: 0.35, dodgeThresh: 0.5,
    // 움직임(컨텍스트 스티어링) 가중치
    lookahead: 0.7, wInterest: 1.0, wDanger: 4.0, wWall: 1.5, wNoise: 0.6, noiseDrift: 0.8,
    description: '',
  };
}

export function newEntity(kind = 'monster') {
  if (kind === 'user') return newUser();
  const isBoss = kind === 'boss';
  const e = {
    schema: SCHEMA_VERSION,
    id: uid(),
    name: isBoss ? '새 보스' : '새 몬스터',
    kind,
    hp: 1000,             // 엔티티 총 체력(페이즈 유무와 무관하게 설정)
    size: 0.6,            // 반경(m) — 2D 원형
    rotationSpeed: 360,   // deg/s
    description: '',       // 설명 텍스트(보스·몬스터 공통)
    // 가변 거리밴드: min~max(m) 구간. 예: 0~3, 3~6 …
    distanceBands: [
      { name: '근거리', min: 0, max: 3 },
      { name: '중거리', min: 3, max: 8 },
      { name: '장거리', min: 8, max: 99 },
    ],
    // 페이즈는 없을 수 있음. transitionPatternId = 이 페이즈로 전환될 때 쓸 패턴.
    phases: [{ name: '기본', hp: 1000, transitionPatternId: null }],
    projectiles: [],   // 투사체 정의(종류) — 이벤트가 defId로 참조
    terrains: [],      // 지형 정의(종류) — 이벤트가 defId로 참조
    patterns: [],
    bt: [],
  };
  if (isBoss) {
    e.specialModePatternIds = []; // 특수모드에 등록된 패턴(보스 전용)
  }
  return e;
}

// 투사체/지형 "종류" 정의 (엔티티 레벨에 저장, 이벤트가 defId로 참조)
export function newProjectileDef() {
  return { id: uid(), name: '새 투사체', damage: 50, speed: 12, lifetime: 1.5, homing: 0 };
}
export function newTerrainDef() {
  return { id: uid(), name: '새 지형', terrain: '둔화', size: 4, duration: 4 };
}

export function newPattern() {
  return {
    id: uid(),
    name: '새 패턴',
    // 패턴은 공격/이동으로 분류하지 않음 — 모드는 BT 표가 결정.
    duration: 1.0,        // 총 시간(s)
    cooldown: 1.0,        // 패턴 단위 쿨타임(s)
    events: [],
  };
}

// time = 패턴 전체 타임라인 기준 글로벌 시간(이 시간까지 완료).
// composite=true 이면 sub[]의 이벤트를 같은 타임라인에서 병렬 수행(중첩 불가).
export function newEvent(type = '대기') {
  const ev = { id: uid(), time: 0.5, type, composite: false, sub: [] };
  switch (type) {
    case '공격':
      Object.assign(ev, {
        indicator: false, indicatorTime: 0.5,
        damage: 0, shape: '원형', area: '지름',
        offset: 0,                    // 전방 거리(몬스터 중심 → facing 방향)에 히트박스 배치
        sizeA: 3, sizeB: 0,            // 원형:지름=sizeA / 사각:길이=sizeA,폭=sizeB
        zone: '유저추적', trackPct: 100, // 특정지역일 때
      });
      break;
    case '걷기':
      // side=true → 유저 정면이 아니라 양옆(랜덤 좌/우)으로 걷기
      // inclusive/exclusive(취소 거리)는 BT 행에서 설정.
      Object.assign(ev, { speed: 4, side: false });
      break;
    case '대쉬':
      // curve = 뒤곡선좌/우의 휘는 정도(0=직선, 0.6 기본)
      Object.assign(ev, { dir: '직선', dist: 4, curve: 0.6, track: false, customPath: null });
      break;
    case '투사체':
      // 종류(피해/속도/소멸/호밍)는 defId로 참조. 이벤트엔 발사 방식만.
      Object.assign(ev, {
        defId: null, count: 1, interval: 0,          // interval>0 이면 count발을 간격마다 연사
        dir: '직선', customSpawns: null,             // [{x,y,angle}]
        expireAction: '없음', expireAttackEventId: null,
      });
      break;
    case '지형':
      // 종류(형태/지름/지속)는 defId로 참조. 이벤트엔 배치(개수/위치)만.
      Object.assign(ev, { defId: null, count: 1, pos: '유저 위치', offset: 0 });
      break;
    case '순간이동':
      // 이 시간에 즉시 점프. dest='유저로부터 랜덤'이면 유저 기준 반경 dist m 랜덤 위치.
      Object.assign(ev, { dest: '유저로부터 랜덤', dist: 7 });
      break;
    case '모드전환':
      // 수행 중 이 시간에 모드 전환(토글/공격/수비). BT 루프에서만 의미.
      ev.toMode = '토글';
      break;
    case '음표카운터':
      // 이 시간에 보스 머리 위 음표 카운터 += amount. 5개 누적 시 특수 패턴 강제.
      ev.amount = 1;
      break;
    case '공격각도':
      // 이 시간의 facing(=유저 응시 후 방향)을 축으로 폭 angle°의 부채꼴 확정.
      // 이후 '공격각도내 랜덤' 투사체가 이 부채꼴 안에서 발사됨. 표시용으로도 사용.
      ev.angle = 90;
      break;
    case '회복':
      // 이 시간에 체력 amount 회복(시뮬은 표시만, HP 계산 없음).
      ev.amount = 500;
      break;
    // 대기 / 추적 / 몸회전 — 추가 필드 없음
  }
  return ev;
}

export function newBTRow() {
  return {
    id: uid(),
    mode: '공격',        // '공격' | '수비' | '특수'
    phaseIdx: -1,        // phases 인덱스 (전체 적용은 -1)
    band: -1,            // distanceBands 인덱스 (전체는 -1)
    patternId: null,
    inclusive: 0,        // 수행 중 이 거리 이하로 가까워지면 패턴 취소
    exclusive: 99,       // 수행 중 이 거리 이상으로 멀어지면 패턴 취소
    desc: '',
  };
}

// ── 직렬화/역직렬화 (마이그레이션 대비) ───────────
export function serialize(entity) {
  return JSON.stringify(entity, null, 2);
}

export function deserialize(text) {
  const data = JSON.parse(text);
  return migrate(data);
}

function migrate(data) {
  if (!data.schema) data.schema = SCHEMA_VERSION;
  if (data.kind === 'user') return data; // 유저는 스탯만 — 패턴/BT 보강 생략
  // 향후 스키마 버전업 시 여기서 단계적 변환
  data.patterns ??= [];
  data.bt ??= [];
  data.phases ??= [];
  data.distanceBands ??= [];
  data.projectiles ??= [];
  data.terrains ??= [];
  // v1 보강: 설명/체력/거리밴드 min
  data.description ??= '';
  if (data.hp == null) data.hp = data.phases.reduce((s, p) => s + (p.hp || 0), 0) || 1000;
  for (const b of data.distanceBands) b.min ??= 0;
  // 패턴: 공격/이동 분류 제거, 이벤트 composite/sub 보강
  for (const p of data.patterns) {
    delete p.type;
    p.events ??= [];
    for (const ev of p.events) normalizeEvent(ev);
  }
  // BT 행: 취소거리(inclusive/exclusive) 보강
  for (const r of (data.bt || [])) { r.inclusive ??= 0; r.exclusive ??= 99; }
  // 이중 무기(해금/대금) 2nd BT — 있을 때만 보강
  if (data.weaponNames || data.bt2) {
    data.bt2 ??= [];
    data.weaponNames ??= ['해금', '대금'];
    for (const r of data.bt2) { r.inclusive ??= 0; r.exclusive ??= 99; }
  }
  return data;
}

// 구버전 '복합' 타입 → 플래그(composite)+sub 로 변환, 필드 보강
function normalizeEvent(ev) {
  if (ev.type === '복합') {
    ev.sub = Array.isArray(ev.composite) ? ev.composite : (ev.sub || []);
    ev.type = '대기';
    ev.composite = true;
  }
  if (typeof ev.composite !== 'boolean') ev.composite = false;
  ev.sub ??= [];
  if (ev.type === '걷기') { delete ev.inclusive; delete ev.exclusive; ev.speed ??= 4; ev.side ??= false; }
  for (const s of ev.sub) { if (typeof s.composite !== 'boolean') s.composite = false; s.sub ??= []; }
  return ev;
}
