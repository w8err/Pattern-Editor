// 런타임 검증: jsdom으로 실제 DOM에서 UI를 렌더/조작하며 에러 수집
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, '..', 'data');

const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost:8080/' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
global.alert = () => {};
global.confirm = () => true;
global.prompt = () => '테스트';

const errors = [];
const ok = [];
function step(name, fn) { try { fn(); ok.push(name); } catch (e) { errors.push(`${name}: ${e.message}\n${(e.stack || '').split('\n')[1] || ''}`); } }
const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));

const model = await import('../js/model.js');
const { Inspector } = await import('../js/ui/inspector.js');
const { PatternEditor } = await import('../js/ui/patterns.js');

// ── 1) 모든 데이터 파일 deserialize + 렌더 ────────
for (const sub of ['보스', '몬스터']) {
  for (const f of readdirSync(join(DATA, sub))) {
    step(`render ${sub}/${f}`, () => {
      const ent = model.deserialize(readFileSync(join(DATA, sub, f), 'utf8'));
      const el = document.createElement('div');
      const insp = new Inspector(el, { onSave: async () => {} });
      insp.load(ent, { name: f, parent: { handle: {} } });
      if (!el.querySelector('#patterns-host')) throw new Error('patterns-host 없음');
      // 첫 패턴 선택 → 상세/이벤트/타임라인 렌더
      if (ent.patterns.length) {
        insp.patternEditor.selPat = ent.patterns[0];
        insp.patternEditor._renderList();
        insp.patternEditor._renderDetail();
        if (!el.querySelector('.tl')) throw new Error('타임라인 없음');
      }
    });
  }
}

// ── 2) 모든 이벤트 타입 + 복합(체크박스) 렌더/필드 ──
step('all-event-types render', () => {
  const ent = model.newEntity('boss');
  const p = model.newPattern(); p.duration = 3;
  for (const t of model.EVENT_TYPES) p.events.push(model.newEvent(t));
  // 첫 이벤트를 복합으로 + 하위 이벤트 1개
  p.events[0].composite = true; p.events[0].sub.push(model.newEvent('공격'));
  ent.patterns.push(p);
  const el = document.createElement('div');
  const insp = new Inspector(el, { onSave: async () => {} });
  insp.load(ent, { name: 't.json', parent: { handle: {} } });
  insp.patternEditor.selPat = p;
  insp.patternEditor._renderDetail();
  const cards = el.querySelectorAll('#ev-list > .ev');
  if (cards.length !== model.EVENT_TYPES.length) throw new Error(`카드수 ${cards.length} != ${model.EVENT_TYPES.length}`);
  if (!el.querySelector('#ev-list .sub-events .ev')) throw new Error('복합 하위 카드 없음');
  if (el.querySelector('.ev-type option[value="복합"]')) throw new Error('복합이 아직 타입으로 존재');
});

// ── 3) 타입 변경 핸들러(모든 타입으로 전환) ───────
step('event type-switch handler', () => {
  const ent = model.newEntity('monster');
  const p = model.newPattern('공격');
  p.events.push(model.newEvent('대기'));
  ent.patterns.push(p);
  const el = document.createElement('div');
  const insp = new Inspector(el, { onSave: async () => {} });
  insp.load(ent, { name: 't.json', parent: { handle: {} } });
  insp.patternEditor.selPat = p; insp.patternEditor._renderDetail();
  for (const t of model.EVENT_TYPES) {
    const sel = el.querySelector('#ev-list .ev-type');
    sel.value = t; fire(sel, 'change');
    if (p.events[0].type !== t) throw new Error(`타입전환 실패 -> ${t}`);
  }
});

// ── 4) 필드 입력 핸들러(공격 전 분기) ─────────────
step('attack field handlers + branches', () => {
  const ent = model.newEntity('monster');
  const p = model.newPattern('공격');
  const ev = model.newEvent('공격'); p.events.push(ev); ent.patterns.push(p);
  const el = document.createElement('div');
  const insp = new Inspector(el, { onSave: async () => {} });
  insp.load(ent, { name: 't.json', parent: { handle: {} } });
  insp.patternEditor.selPat = p; insp.patternEditor._renderDetail();
  // 인디케이터 on
  const chk = el.querySelector('#ev-list [data-f="indicator"]'); chk.checked = true; fire(chk, 'change');
  if (!ev.indicator) throw new Error('indicator 토글 실패');
  // 형태 사각형 → 폭 필드 등장
  let shape = el.querySelector('#ev-list [data-f="shape"]'); shape.value = '사각형'; fire(shape, 'change');
  if (!el.querySelector('#ev-list [data-f="sizeB"]')) throw new Error('사각형 폭 필드 없음');
  // 범위기준 특정지역 → 지역 등장, 유저추적 → 추적% 등장
  let area = el.querySelector('#ev-list [data-f="area"]'); area.value = '특정지역'; fire(area, 'change');
  let zone = el.querySelector('#ev-list [data-f="zone"]'); if (!zone) throw new Error('지역 셀렉트 없음');
  zone.value = '유저추적'; fire(zone, 'change');
  if (!el.querySelector('#ev-list [data-f="trackPct"]')) throw new Error('추적% 없음');
});

// ── 5) 버튼: 패턴추가/이벤트추가/정렬/삭제, 밴드/페이즈 ─
step('buttons add/sort/delete', () => {
  const ent = model.newEntity('boss');
  const el = document.createElement('div');
  const insp = new Inspector(el, { onSave: async () => {} });
  insp.load(ent, { name: 't.json', parent: { handle: {} } });
  el.querySelector('#add-pat').click();
  el.querySelector('#add-pat').click();
  if (ent.patterns.length !== 2) throw new Error('패턴 추가 실패');
  insp.patternEditor.selPat = ent.patterns[0]; insp.patternEditor._renderDetail();
  el.querySelector('#add-ev').click(); el.querySelector('#add-ev').click();
  if (ent.patterns[0].events.length !== 2) throw new Error('이벤트 추가 실패');
  el.querySelector('#sort-ev').click();
  el.querySelector('#add-band').click();
  el.querySelector('#add-phase').click();
  if (ent.distanceBands.length !== 4) throw new Error('밴드 추가 실패');
  if (ent.phases.length !== 2) throw new Error('페이즈 추가 실패');
});

// ── 6) entity 필드 입력(hp/size/desc) ─────────────
step('entity scalar fields', () => {
  const ent = model.newEntity('monster');
  const el = document.createElement('div');
  const insp = new Inspector(el, { onSave: async () => {} });
  insp.load(ent, { name: 't.json', parent: { handle: {} } });
  const hp = el.querySelector('#f-hp'); hp.value = '555'; fire(hp, 'input');
  const desc = el.querySelector('#f-desc'); desc.value = '설명테스트'; fire(desc, 'input');
  if (ent.hp !== 555 || ent.description !== '설명테스트') throw new Error('스칼라 반영 실패');
  if (!insp.dirty) throw new Error('dirty 미설정');
});

// ── 7) 시뮬 코어(sim.js) 실데이터 검증 ────────────
const sim = await import('../js/sim.js');

step('sim: 모든 패턴 시뮬 무에러 + 유한값', () => {
  for (const sub of ['보스', '몬스터']) {
    for (const f of readdirSync(join(DATA, sub))) {
      const ent = model.deserialize(readFileSync(join(DATA, sub, f), 'utf8'));
      for (const p of ent.patterns) {
        const r = sim.simulateUpTo(p, p.duration, { rotationSpeed: ent.rotationSpeed, user: () => ({ x: 4, y: 1 }) });
        if (!Number.isFinite(r.state.mx) || !Number.isFinite(r.state.my) || !Number.isFinite(r.state.facing))
          throw new Error(`${f}/${p.name} 비유한 상태`);
        for (const fr of r.fires) if (fr.type === '공격' && typeof fr.geom.hit !== 'boolean')
          throw new Error(`${f}/${p.name} 공격 hit 판정 없음`);
      }
    }
  }
});

step('sim: 걷기 정면 유저 도달(초과 안 함)', () => {
  const p = { id: 'p', name: 'w', duration: 5, cooldown: 0,
    events: [{ id: 'e', time: 5, type: '걷기', speed: 4, side: false }] };
  const r = sim.simulateUpTo(p, 5, { user: () => ({ x: 10, y: 0 }), rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  const d = Math.hypot(r.state.mx - 10, r.state.my);
  if (d > 0.3) throw new Error(`유저 도달 실패/초과 d=${d.toFixed(2)}`);
});

step('sim: 공격 명중/빗나감 판정', () => {
  const near = { id: 'p', name: 'a', type: '공격', duration: 1, cooldown: 0,
    events: [{ id: 'e', time: 1, type: '공격', area: '나로부터거리', sizeA: 3, shape: '원형', damage: 10 }] };
  const hitR = sim.simulateUpTo(near, 1, { user: () => ({ x: 2, y: 0 }), rotationSpeed: 360 });
  const missR = sim.simulateUpTo(near, 1, { user: () => ({ x: 9, y: 0 }), rotationSpeed: 360 });
  if (!hitR.fires[0].geom.hit) throw new Error('근접 HIT 실패');
  if (missR.fires[0].geom.hit) throw new Error('원거리 MISS 실패');
});

step('sim: 걷기 양옆(측면 이동)', () => {
  const p = { id: 'p', name: 's', duration: 2, cooldown: 0,
    events: [{ id: 'side1', time: 2, type: '걷기', speed: 4, side: true, inclusive: 0, exclusive: 99 }] };
  const r = sim.simulateUpTo(p, 2, { user: () => ({ x: 8, y: 0 }), rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  // 유저는 +x 방향 → 측면이동이면 y 변위가 주(±), x 변위는 작아야
  if (Math.abs(r.state.my) < 1) throw new Error('측면 변위 없음');
  if (Math.abs(r.state.mx) > Math.abs(r.state.my)) throw new Error('정면으로 이동함(측면 아님)');
});

step('sim: 대쉬 방향=이벤트 시작 유저 위치 고정(중간 재조준 X)', () => {
  // 응시0.5 → 대쉬(직선5)@1.0. 대쉬 구간(0.5~1.0). 0.7에 유저가 점프해도 방향 불변.
  const p = { id: 'p', name: 'd', duration: 1.0, cooldown: 0,
    events: [{ id: 'g', time: 0.5, type: '추적' }, { id: 'dd', time: 1.0, type: '대쉬', dir: '직선', dist: 5 }] };
  const user = (t) => t <= 0.7 ? { x: 10, y: 0 } : { x: 0, y: 10 }; // 0.7에 +x→+y로 점프
  const r = sim.simulateUpTo(p, 1.0, { user, rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  // 시작 시점 유저(+x) 방향으로 5m → mx≈5, my≈0. 재조준이면 +y로 휘어 my>1.
  if (Math.abs(r.state.mx - 5) > 0.3) throw new Error(`전방 5m 아님 mx=${r.state.mx.toFixed(2)}`);
  if (Math.abs(r.state.my) > 0.5) throw new Error(`재조준됨(휨) my=${r.state.my.toFixed(2)}`);
});

step('sim: 투사체는 몸 방향으로 발사(고정)', () => {
  // facing=+y(PI/2). 유저가 +x에 있어도 투사체는 몸 방향(+y)으로 나감.
  const p = { id: 'p', name: 's', duration: 0.3, cooldown: 0,
    events: [{ id: 'pr', time: 0.3, type: '투사체', defId: null, count: 1, dir: '직선' }] };
  const r = sim.simulateUpTo(p, 0.3, { user: () => ({ x: 10, y: 0 }), rotationSpeed: 360, init: { mx: 0, my: 0, facing: Math.PI / 2 } });
  const pr = r.fires.find((f) => f.type === '투사체');
  if (!pr || Math.abs(pr.dir - Math.PI / 2) > 0.01) throw new Error(`투사체 방향 몸 기준 아님 ${pr?.dir}`);
});

step('유웅 중: 투사체 정의 분리(defId 참조)', () => {
  const ent = model.deserialize(readFileSync(join(DATA, '몬스터', '유웅 중.json'), 'utf8'));
  if (!ent.projectiles.length) throw new Error('투사체 정의 없음');
  const projEv = ent.patterns.find((p) => p.id === 'shoot').events.find((e) => e.type === '투사체');
  if (projEv.defId == null) throw new Error('이벤트 defId 없음');
  if (projEv.damage != null) throw new Error('인라인 damage 잔존');
  const def = ent.projectiles.find((p) => p.id === projEv.defId);
  if (!def || def.damage !== 60) throw new Error('정의 데미지 60 아님');
});

step('sim: 대쉬 중 보는 방향 고정', () => {
  // 추적 없이 대쉬만 → 진입 facing(0) 유지. 유저가 +y에 있어도 안 돌아봄.
  const p = { id: 'p', name: 'd', duration: 0.5, cooldown: 0,
    events: [{ id: 'dd', time: 0.5, type: '대쉬', dir: '직선', dist: 5 }] };
  const r = sim.simulateUpTo(p, 0.5, { user: () => ({ x: 0, y: 10 }), rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  if (Math.abs(r.state.facing) > 0.01) throw new Error(`대쉬 중 facing 변함 ${r.state.facing.toFixed(2)}`);
});

step('sim: 대쉬 커스텀 경로 도달', () => {
  const p = { id: 'p', name: 'd', duration: 1, cooldown: 0,
    events: [{ id: 'dc', time: 1, type: '대쉬', dir: '커스텀', customPath: [{ x: 0, y: 3 }, { x: 3, y: 3 }] }] };
  const r = sim.simulateUpTo(p, 1, { user: () => ({ x: 5, y: 0 }), rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  if (Math.hypot(r.state.mx - 3, r.state.my - 3) > 0.2) throw new Error(`도착점 오차 (${r.state.mx.toFixed(1)},${r.state.my.toFixed(1)})`);
});

step('sim: 복합 하위 공격 발생', () => {
  const p = { id: 'p', name: 'c', duration: 1, cooldown: 0,
    events: [{ id: 'w', time: 1, type: '걷기', speed: 4, inclusive: 0, exclusive: 99, composite: true,
      sub: [{ id: 'a', time: 0.5, type: '공격', area: '나로부터거리', sizeA: 5, shape: '원형', damage: 10 }] }] };
  const r = sim.simulateUpTo(p, 1, { user: () => ({ x: 3, y: 0 }), rotationSpeed: 360 });
  if (!r.fires.some((f) => f.type === '공격')) throw new Error('복합 하위 공격 미발생');
});

step('sim: pathAt 보간', () => {
  const mid = sim.pathAt([{ x: 4, y: 0 }], 0.5);
  if (Math.abs(mid.x - 2) > 0.01 || Math.abs(mid.y) > 0.01) throw new Error('pathAt 중간점 오류');
});

step('sim: BT pickPattern 거리밴드/모드/특수', () => {
  const ent = {
    distanceBands: [{ name: '근', min: 0, max: 3 }, { name: '원', min: 3, max: 99 }],
    bt: [
      { mode: '특수', phaseIdx: -1, band: -1, patternId: 'ult' },
      { mode: '공격', phaseIdx: -1, band: 0, patternId: 'melee' },
      { mode: '공격', phaseIdx: -1, band: 1, patternId: 'ranged' },
    ],
  };
  if (sim.bandFor(ent, 2) !== 0 || sim.bandFor(ent, 5) !== 1) throw new Error('밴드 계산 오류');
  const pid = (ctx) => sim.pickPattern(ent, ctx)?.patternId;
  if (pid({ mode: '공격', phaseIdx: 0, distance: 2, cd: {} }) !== 'ult') throw new Error('특수 우선 실패');
  if (pid({ mode: '공격', phaseIdx: 0, distance: 2, cd: { ult: 5 } }) !== 'melee') throw new Error('근접 선택 실패');
  if (pid({ mode: '공격', phaseIdx: 0, distance: 6, cd: { ult: 5 } }) !== 'ranged') throw new Error('원거리 선택 실패');
});

// ── 8) BT 에디터 + 유웅 소 정합 ───────────────────
step('BT 에디터 렌더/추가/모드변경', async () => {
  const { BTEditor } = await import('../js/ui/bt.js');
  const ent = model.deserialize(readFileSync(join(DATA, '몬스터', '유웅 소.json'), 'utf8'));
  const el = document.createElement('div');
  const bt = new BTEditor(el, { onChange: () => {} });
  bt.setEntity(ent);
  if (el.querySelectorAll('#bt-body tr').length !== ent.bt.length) throw new Error('BT 행 수 불일치');
  const before = ent.bt.length;
  el.querySelector('#bt-add').click();
  if (ent.bt.length !== before + 1) throw new Error('BT 행 추가 실패');
  const mSel = el.querySelector('#bt-body tr select'); mSel.value = '수비'; fire(mSel, 'change');
  if (ent.bt[0].mode !== '수비') throw new Error('BT 모드 변경 실패');
});

step('유웅 소: 5패턴 + BT 동작(모드전환 포함)', () => {
  const ent = model.deserialize(readFileSync(join(DATA, '몬스터', '유웅 소.json'), 'utf8'));
  if (ent.patterns.length !== 5) throw new Error('패턴 5개 아님');
  const names = ent.patterns.map((p) => p.name);
  for (const n of ['할퀴기1(2연)', '러쉬', '달리기', '좌우걷기', '공격모드 전환']) if (!names.includes(n)) throw new Error('누락: ' + n);
  if (!ent.patterns.find((p) => p.id === 'sidewalk').events[0].side) throw new Error('좌우걷기 side 아님');
  if (ent.patterns.find((p) => p.id === 'run').events[0].side) throw new Error('달리기가 side임');
  if (sim.modeSwitches(ent.patterns.find((p) => p.id === 'toatk')).length !== 1) throw new Error('공격모드전환 이벤트 없음');
  const pick = (mode, d) => sim.pickPattern(ent, { mode, phaseIdx: 0, distance: d, cd: {} })?.patternId;
  if (pick('공격', 1) !== 'claw1') throw new Error('근접 할퀴기 선택 실패');
  if (pick('공격', 9) !== 'rush') throw new Error('원거리 러쉬 선택 실패');
  if (pick('수비', 1) !== 'toatk') throw new Error('초근접 수비→공격모드전환 실패');
  if (pick('수비', 5) !== 'sidewalk') throw new Error('중거리 좌우걷기 실패');
  if (pick('수비', 9) !== 'run') throw new Error('원거리 달리기 실패');
});

// ── 9) Inspector 전체 흐름에서 BT 표 렌더 확인 ─────
step('Inspector 안에 BT 표가 렌더됨', () => {
  const ent = model.deserialize(readFileSync(join(DATA, '몬스터', '유웅 소.json'), 'utf8'));
  const el = document.createElement('div');
  const insp = new Inspector(el, { onSave: async () => {} });
  insp.load(ent, { name: 't.json', parent: { handle: {} } });
  const rows = el.querySelectorAll('#bt-host #bt-body tr');
  if (!el.querySelector('#bt-host .bt-table')) throw new Error('BT 표 미렌더');
  if (rows.length !== ent.bt.length) throw new Error(`BT 행 ${rows.length} != ${ent.bt.length}`);
});

step('sim: 모드전환 이벤트 추출/해석', () => {
  const p = { id: 'p', name: 'sw', duration: 0.3, cooldown: 0,
    events: [{ id: 's', time: 0.1, type: '모드전환', toMode: '공격' }] };
  const sws = sim.modeSwitches(p);
  if (sws.length !== 1 || sws[0].toMode !== '공격') throw new Error('모드전환 추출 실패');
  if (sim.resolveMode('토글', '수비') !== '공격') throw new Error('토글 해석 실패');
  if (sim.resolveMode('수비', '공격') !== '수비') throw new Error('지정 해석 실패');
});

// ── 10) 순간이동(텔레포트) + 유웅 중 ──────────────
step('sim: 순간이동 즉시 점프(유저로부터 랜덤 7m)', () => {
  const p = { id: 'p', name: 'tp', duration: 1.0, cooldown: 0,
    events: [{ id: 'wait', time: 0.5, type: '대기' },
             { id: 'tp1', time: 0.8, type: '순간이동', dest: '유저로부터 랜덤', dist: 7 },
             { id: 'wait2', time: 1.0, type: '대기' }] };
  const u = { x: 3, y: 0 };
  // 0.7s 시점: 아직 점프 전 → 원점 근처
  const before = sim.simulateUpTo(p, 0.7, { user: () => u, rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  if (Math.hypot(before.state.mx, before.state.my) > 0.01) throw new Error('점프 전 이미 이동함');
  // 0.9s 시점: 점프 후 → 유저로부터 정확히 7m
  const after = sim.simulateUpTo(p, 0.9, { user: () => u, rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  const r = Math.hypot(after.state.mx - u.x, after.state.my - u.y);
  if (Math.abs(r - 7) > 0.05) throw new Error(`유저로부터 거리 ${r.toFixed(2)} (기대 7)`);
  if (!after.fires.some((fr) => fr.type === '순간이동')) throw new Error('텔레포트 마커 없음');
});

step('유웅 중: 4패턴 + 순간이동 + 복합백대쉬 + BT', () => {
  const ent = model.deserialize(readFileSync(join(DATA, '몬스터', '유웅 중.json'), 'utf8'));
  if (ent.patterns.length !== 4) throw new Error('패턴 4개 아님');
  const smoke = ent.patterns.find((p) => p.id === 'smoke');
  if (!smoke.events.some((e) => e.type === '순간이동')) throw new Error('연막탄에 순간이동 없음');
  const back = ent.patterns.find((p) => p.id === 'backatk');
  const dash = back.events.find((e) => e.type === '대쉬');
  if (!dash.composite || !dash.sub.some((s) => s.type === '공격')) throw new Error('백대쉬 복합(공격) 없음');
  const pick = (mode, d) => sim.pickPattern(ent, { mode, phaseIdx: 0, distance: d, cd: {} })?.patternId;
  if (pick('공격', 2) !== 'backatk') throw new Error('근접 백대쉬 실패');
  if (pick('공격', 7) !== 'shoot') throw new Error('원거리 사격 실패');
  if (pick('수비', 2) !== 'smoke') throw new Error('근접 연막 실패');
  if (pick('수비', 12) !== 'run') throw new Error('원거리 달리기 실패');
  // 복합 백대쉬: 후퇴 이동 + 공격 발생
  const r = sim.simulateUpTo(back, back.duration, { user: () => ({ x: 2, y: 0 }), rotationSpeed: 360 });
  if (r.state.mx >= 0) throw new Error('백대쉬 후퇴 안 함');
  if (!r.fires.some((fr) => fr.type === '공격')) throw new Error('백대쉬 공격 미발생');
});

// ── 11) Playback 유저 기록(재조준 방지) ───────────
step('Playback: 유저 위치 기록(과거 고정/현재 라이브)', async () => {
  const { Playback } = await import('../js/ui/stage.js');
  const mk = (t) => document.createElement(t);
  const wrap = mk('div'); const canvas = mk('canvas'); wrap.appendChild(canvas);
  const pb = new Playback({ canvas, controls: mk('div'), hud: mk('div'), scrub: mk('input') });
  pb.mode = 'single'; pb.playing = true; pb.user = { x: 10, y: 0 };
  pb._hist = [{ t: 0, x: 0, y: 0 }, { t: 0.5, x: 5, y: 0 }, { t: 1.0, x: 8, y: 0 }];
  if (Math.abs(pb._userAt(0.25).x - 2.5) > 0.01) throw new Error('과거 보간 오류');     // 과거=기록
  if (Math.abs(pb._userAt(1.5).x - 10) > 0.01) throw new Error('현재 라이브 오류');     // 최신 이후=라이브
  pb.playing = false;
  if (Math.abs(pb._userAt(0.25).x - 10) > 0.01) throw new Error('정지 시 라이브 아님'); // 정지=라이브
});

step('Playback: 지속 지형(장판) 수명', async () => {
  const { Playback } = await import('../js/ui/stage.js');
  const mk = (t) => document.createElement(t);
  const wrap = mk('div'); const canvas = mk('canvas'); wrap.appendChild(canvas);
  const pb = new Playback({ canvas, controls: mk('div'), hud: mk('div'), scrub: mk('input') });
  pb._clock = 0; pb.terrains = [];
  pb._spawnTerrain({ pts: [{ x: 1, y: 0 }], ev: { terrain: '둔화', size: 4, duration: 5 } });
  if (pb.terrains.length !== 1 || pb.terrains[0].duration !== 5) throw new Error('지형 스폰 실패');
  const alive = (c) => pb.terrains.filter((t) => c - t.born <= t.duration).length;
  if (alive(3) !== 1) throw new Error('3초 시점 사라짐(지속 실패)');
  if (alive(6) !== 0) throw new Error('5초 지나도 안 사라짐');
});

// ── 12) 공격 offset + 지형 + 유웅 대 ──────────────
step('sim: 공격 전방 offset 중심', () => {
  // facing 0(+x), offset 1, 지름 4 → 중심 (1,0), 반경 2
  const ev = { type: '공격', area: '지름', shape: '원형', sizeA: 4, offset: 1 };
  const g = sim.attackGeom(ev, { mx: 0, my: 0, facing: 0 }, { x: 99, y: 99 });
  if (Math.abs(g.x - 1) > 0.01 || Math.abs(g.r - 2) > 0.01) throw new Error('offset/반경 오류');
  if (!sim.attackGeom(ev, { mx: 0, my: 0, facing: 0 }, { x: 2.5, y: 0 }).hit) throw new Error('중심 2.5 명중 실패');
  if (sim.attackGeom(ev, { mx: 0, my: 0, facing: 0 }, { x: 4, y: 0 }).hit) throw new Error('범위 밖 명중됨');
});

step('sim: 둔화 지형 size/duration/몬스터위치', () => {
  const p = { id: 'p', name: 't', duration: 1, cooldown: 0,
    events: [{ id: 'a', time: 0.5, type: '공격', area: '지름', shape: '원형', sizeA: 4, offset: 1, damage: 10, composite: true,
      sub: [{ id: 'g', time: 0.5, type: '지형', terrain: '둔화', size: 4, duration: 5, count: 1, pos: '몬스터 위치', offset: 1 }] }] };
  const r = sim.simulateUpTo(p, 0.6, { user: () => ({ x: 3, y: 0 }), rotationSpeed: 360, init: { mx: 0, my: 0, facing: 0 } });
  const ter = r.fires.find((fr) => fr.type === '지형');
  if (!ter) throw new Error('지형 미발생');
  if (ter.ev.size !== 4 || ter.ev.duration !== 5) throw new Error('size/duration 누락');
  if (Math.abs(ter.pts[0].x - 1) > 0.05) throw new Error('몬스터 앞 1m 위치 오류 ' + ter.pts[0].x);
});

step('유웅 대: 7패턴 + BT', () => {
  const ent = model.deserialize(readFileSync(join(DATA, '몬스터', '유웅 대.json'), 'utf8'));
  if (ent.patterns.length !== 7) throw new Error('패턴 7개 아님');
  const slam = ent.patterns.find((p) => p.id === 'slam').events.find((e) => e.type === '공격');
  const terrSub = slam.composite && slam.sub.find((s) => s.type === '지형');
  if (!terrSub) throw new Error('슬램 복합 지형 없음');
  const tdef = ent.terrains.find((t) => t.id === terrSub.defId);
  if (!tdef || tdef.terrain !== '둔화') throw new Error('둔화 지형 정의 참조 실패');
  const pick = (mode, d) => sim.pickPattern(ent, { mode, phaseIdx: 0, distance: d, cd: {} })?.patternId;
  if (pick('공격', 2) !== 'slam') throw new Error('근접 슬램 실패');
  if (sim.pickPattern(ent, { mode: '공격', phaseIdx: 0, distance: 2, cd: { slam: 5 } }).patternId !== 'sweep') throw new Error('슬램 쿨 중 스윕 대체 실패');
  if (pick('공격', 5) !== 'jumpslam') throw new Error('중거리 점프슬램 실패');
  if (pick('수비', 2) !== 'backdash') throw new Error('근접 뒤대쉬 실패');
  if (pick('수비', 9) !== 'run') throw new Error('원거리 달리기 실패');
});

// ── 결과 ─────────────────────────────────────────
console.log(`✔ 통과 ${ok.length}건`);
if (errors.length) {
  console.log(`\n✘ 실패 ${errors.length}건:`);
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
} else {
  console.log('전부 통과 — 런타임 에러 없음');
}
