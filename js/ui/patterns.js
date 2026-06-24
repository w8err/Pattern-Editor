// ============================================================
//  ②패턴 리스트 + ③이벤트 인스펙터
//  · 패턴은 공격/이동 분류 없음(모드는 BT가 결정)
//  · 복합은 모든 이벤트의 체크박스(여부) → 하위 sub[] 병렬 수행
//  · 타임라인 마커 드래그로 시간 변경
// ============================================================
import * as model from '../model.js';
import * as lib from '../library.js';
import { openPathEditor } from './pathEditor.js';
import { enableDragSort } from './dragSort.js';

const TYPE_COLORS = {
  대기: '#6e7681', 추적: '#58a6ff', 공격: '#f85149', 걷기: '#3fb950',
  대쉬: '#bc8cff', 순간이동: '#22d3ee', 투사체: '#f0883e', 지형: '#d29922', 몸회전: '#79c0ff', 모드전환: '#7ee787', 음표카운터: '#ffd33d', 공격각도: '#f0883e', 회복: '#3fb950', 특수효과: '#7ee787', 조건점검: '#d2a8ff',
};
const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));

// ── 패턴 클립보드(몬스터 간 복붙) ───────────────────
//  패턴은 투사체/지형 "정의"를 defId로, 소멸공격을 expireAttackEventId로 참조하므로
//  복사 시 참조 정의를 함께 묶고, 붙여넣을 때 대상 엔티티에 병합 + id 전부 리매핑한다.
const CLIP_KEY = 'bb-editor:pattern-clip';
const CLIP_KEY_EV = 'bb-editor:event-clip';
const clone = (o) => JSON.parse(JSON.stringify(o));
const evList = (ev) => [ev, ...(ev.sub || [])];                 // 이벤트 + 복합 하위
const allEvents = (p) => p.events.flatMap(evList);             // 패턴 전체 이벤트 평탄화
// 정의 동등성(이름+내용 비교, id 제외)
const sameDef = (a, b) => { const s = (o) => JSON.stringify({ ...o, id: 0 }); return s(a) === s(b); };
// 이벤트들이 참조하는 투사체/지형 정의를 엔티티에서 추려 복제
function collectDefs(entity, events) {
  const proj = new Set(), terr = new Set();
  for (const ev of events) {
    if (ev.type === '투사체' && ev.defId) proj.add(ev.defId);
    if (ev.type === '지형' && ev.defId) terr.add(ev.defId);
  }
  const pick = (list, ids) => (list || []).filter((d) => ids.has(d.id)).map(clone);
  return { projectiles: pick(entity.projectiles, proj), terrains: pick(entity.terrains, terr) };
}
// 묶여온 정의를 대상 리스트에 병합 → {oldId: newId} 맵 반환(동일 정의는 재사용)
function mergeDefs(targetList, clipDefs) {
  const map = {};
  for (const d of (clipDefs || [])) {
    const exist = targetList.find((t) => sameDef(t, d));
    if (exist) { map[d.id] = exist.id; continue; }
    const nd = clone(d); nd.id = model.uid(); targetList.push(nd); map[d.id] = nd.id;
  }
  return map;
}
// 이벤트 묶음(각 top-level이 복합 하위를 가질 수 있음)의 id 전부 재발급 + 참조 리매핑(제자리 변형)
function remapEvents(topEvents, projMap, terrMap) {
  const flat = topEvents.flatMap(evList);
  const idMap = {};
  for (const ev of flat) {
    const nid = model.uid(); idMap[ev.id] = nid; ev.id = nid;
    if (ev.type === '투사체' && ev.defId) ev.defId = projMap[ev.defId] ?? null;
    if (ev.type === '지형' && ev.defId) ev.defId = terrMap[ev.defId] ?? null;
  }
  for (const ev of flat) { // 소멸 공격(같은 묶음 내 이벤트 참조) 리매핑 — 묶음 밖이면 원본 유지
    if (ev.expireAttackEventId) ev.expireAttackEventId = idMap[ev.expireAttackEventId] ?? ev.expireAttackEventId;
  }
}
// ── 패턴 클립보드 ──
function writeClip(entity, p) {
  const clip = { pattern: clone(p), ...collectDefs(entity, allEvents(p)) };
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { /* 용량초과 무시 */ }
}
function readClip() { try { return JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch { return null; } }
function pastePatternInto(entity, clip) {
  entity.projectiles ??= []; entity.terrains ??= [];
  const projMap = mergeDefs(entity.projectiles, clip.projectiles);
  const terrMap = mergeDefs(entity.terrains, clip.terrains);
  const p = clone(clip.pattern);
  p.id = model.uid();
  let nm = p.name; while (entity.patterns.some((x) => x.name === nm)) nm += ' 복사'; // 이름 충돌 회피
  p.name = nm;
  remapEvents(p.events, projMap, terrMap);
  return p;
}
// ── 이벤트 클립보드 ──
function writeEventClip(entity, ev) {
  const clip = { event: clone(ev), ...collectDefs(entity, evList(ev)) };
  try { localStorage.setItem(CLIP_KEY_EV, JSON.stringify(clip)); } catch { /* 무시 */ }
}
function readEventClip() { try { return JSON.parse(localStorage.getItem(CLIP_KEY_EV) || 'null'); } catch { return null; } }
// clip 이벤트를 targetArr에 붙여넣기. intoSub=true면 복합 하위로(중첩 불가 → composite 해제).
function pasteEventInto(entity, targetArr, clip, intoSub = false) {
  entity.projectiles ??= []; entity.terrains ??= [];
  const projMap = mergeDefs(entity.projectiles, clip.projectiles);
  const terrMap = mergeDefs(entity.terrains, clip.terrains);
  const ev = clone(clip.event);
  if (intoSub) { ev.composite = false; ev.sub = []; } // 복합 하위엔 다시 복합 불가
  remapEvents([ev], projMap, terrMap);
  targetArr.push(ev);
  return ev;
}

const inNum = (f, v, step = 1, re = false) =>
  `<input type="number" step="${step}" value="${v ?? 0}" data-f="${f}" data-t="num"${re ? ' data-re="1"' : ''}>`;
const inChk = (f, v, re = false) =>
  `<input type="checkbox" ${v ? 'checked' : ''} data-f="${f}" data-t="bool"${re ? ' data-re="1"' : ''}>`;
const inSel = (f, v, opts, re = false) =>
  `<select data-f="${f}" data-t="str"${re ? ' data-re="1"' : ''}>${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
const inText = (f, v) => `<input type="text" value="${attr(v ?? '')}" data-f="${f}" data-t="str">`;
const inColor = (f, v) => `<input type="color" value="${attr(v || '#7ee787')}" data-f="${f}" data-t="str">`;
const lab = (t, inner) => `<label class="ef">${t}${inner}</label>`;

export class PatternEditor {
  constructor(el, { onChange, onSelect }) {
    this.el = el; this.onChange = onChange; this.onSelect = onSelect;
    this.entity = null; this.selPat = null;
    this._fold = new Set(); // 접힌 이벤트 id 집합(재렌더 유지)
  }
  setEntity(entity) { this.entity = entity; this._select(null); this.render(); }
  _mark() { this.onChange?.(); }
  _select(p) { this.selPat = p; this.onSelect?.(p); }

  render() {
    const e = this.entity;
    if (!e) { this.el.innerHTML = ''; return; }
    const clip = readClip();
    this.el.innerHTML = `
      <div class="sec-hd">패턴 (${e.patterns.length})
        <button class="mini" id="add-pat">+ 패턴</button>
        <button class="mini" id="paste-pat"${clip ? '' : ' disabled'} title="${clip ? `붙여넣기: ${esc(clip.pattern?.name || '패턴')}` : '복사된 패턴 없음'}">📋 붙여넣기</button>
      </div>
      <div id="pat-list"></div>
      <div id="pat-detail"></div>`;
    this.el.querySelector('#add-pat').onclick = () => this._addPattern();
    this.el.querySelector('#paste-pat').onclick = () => this._pastePattern();
    this._renderList(); this._renderDetail();
  }
  _addPattern() {
    const p = model.newPattern(); this.entity.patterns.push(p);
    this._select(p); this._mark(); this._renderList(); this._renderDetail();
  }
  _copyPattern(p) { writeClip(this.entity, p); this.render(); } // 클립 저장 후 붙여넣기 버튼 활성화 위해 재렌더
  _pastePattern() {
    const clip = readClip(); if (!clip?.pattern) return;
    const p = pastePatternInto(this.entity, clip);
    this.entity.patterns.push(p);
    this._select(p); this._mark(); this.render(); // 정의가 추가될 수 있어 전체 재렌더
  }
  _renderList() {
    const box = this.el.querySelector('#pat-list'); const e = this.entity;
    box.innerHTML = '';
    if (!e.patterns.length) { box.innerHTML = '<div class="dim small">패턴 없음 — 위에서 추가</div>'; return; }
    const rowEls = [];
    e.patterns.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'pat-row' + (p === this.selPat ? ' sel' : '');
      row.innerHTML = `
        <span class="drag-handle" title="드래그로 순서 변경">⠿</span>
        <span class="pt-name">${esc(p.name)}</span>
        <span class="pt-meta">⏱${p.duration}s · CD${p.cooldown}s · ev${p.events.length}</span>
        <button class="mini copy" title="패턴 복사(다른 몬스터에 붙여넣기)">⧉</button>
        <button class="mini del">×</button>`;
      row.onclick = (ev) => { if (ev.target.closest('.del,.copy,.drag-handle')) return; this._select(p === this.selPat ? null : p); this._renderList(); this._renderDetail(); }; // 선택된 패턴 다시 클릭 → 닫기
      row.querySelector('.copy').onclick = () => this._copyPattern(p);
      row.querySelector('.del').onclick = () => {
        if (!confirm(`패턴 "${p.name}" 삭제?`)) return;
        e.patterns.splice(e.patterns.indexOf(p), 1);
        if (this.selPat === p) this._select(null);
        this._mark(); this._renderList(); this._renderDetail();
      };
      box.appendChild(row); rowEls.push(row);
    });
    // 드래그로 순서 변경 → mark + 재렌더
    enableDragSort(rowEls, e.patterns, () => { this._mark(); this._renderList(); });
  }

  _renderDetail() {
    const box = this.el.querySelector('#pat-detail'); const p = this.selPat;
    if (!p) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="pat-detail">
        <div class="pat-meta">
          <input class="grow" id="p-name" value="${attr(p.name)}">
          <label class="ef">길이s ${inNum('__dur', p.duration, 0.1)}</label>
          <label class="ef">쿨s ${inNum('__cd', p.cooldown, 0.1)}</label>
        </div>
        <div id="timeline"></div>
        <div class="sec-hd sub">이벤트 (${p.events.length})
          <button class="mini" id="add-ev">+ 이벤트</button>
          <button class="mini" id="sort-ev">↕ 시간정렬</button>
          <button class="mini" id="paste-ev"${readEventClip() ? '' : ' disabled'} title="복사한 이벤트 붙여넣기">📋 이벤트</button>
        </div>
        <div id="ev-list"></div>
      </div>`;
    box.querySelector('#p-name').oninput = (e) => { p.name = e.target.value; this._mark(); this._renderList(); };
    box.querySelector('[data-f="__dur"]').oninput = (e) => { p.duration = +e.target.value; this._mark(); this._renderTimeline(); this._renderList(); };
    box.querySelector('[data-f="__cd"]').oninput = (e) => { p.cooldown = +e.target.value; this._mark(); this._renderList(); };
    box.querySelector('#add-ev').onclick = () => { p.events.push(model.newEvent('대기')); this._mark(); this._refreshEvents(); };
    box.querySelector('#sort-ev').onclick = () => { p.events.sort((a, b) => a.time - b.time); this._mark(); this._refreshEvents(); };
    box.querySelector('#paste-ev').onclick = () => {
      const clip = readEventClip(); if (!clip?.event) return;
      pasteEventInto(this.entity, p.events, clip); this._mark(); this._renderDetail(); // 정의 추가 가능 → 상세 재렌더
    };
    this._renderTimeline(); this._renderEventList();
  }
  _refreshEvents() { this._renderTimeline(); this._renderEventList(); this._renderList(); }

  // ── 미니 타임라인(마커 드래그로 시간 변경) ───────
  _renderTimeline() {
    const tl = this.el.querySelector('#timeline'); const p = this.selPat;
    if (!tl) return;
    tl.className = 'tl'; tl.innerHTML = '';
    const dur = Math.max(0.1, p.duration);
    p.events.forEach((ev) => {
      const m = document.createElement('div');
      m.className = 'tl-ev'; m.style.left = clamp(ev.time / dur * 100) + '%';
      m.style.background = TYPE_COLORS[ev.type] || '#888';
      m.title = `${ev.time}s · ${ev.type} (드래그로 이동)`;
      m.onmousedown = (e) => { e.preventDefault(); this._dragMarker(ev, tl, dur); };
      tl.appendChild(m);
    });
    const end = document.createElement('div'); end.className = 'tl-end'; end.textContent = dur + 's'; tl.appendChild(end);
  }
  _dragMarker(ev, tl, dur) {
    const move = (e) => {
      const r = tl.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      ev.time = Math.round(f * dur * 100) / 100; this._mark(); this._renderTimeline();
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); this._renderEventList(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  _renderEventList() {
    const box = this.el.querySelector('#ev-list'); const p = this.selPat;
    box.innerHTML = '';
    if (!p.events.length) { box.innerHTML = '<div class="dim small">이벤트 없음</div>'; return; }
    [...p.events].sort((a, b) => a.time - b.time).forEach((ev) => box.appendChild(this._eventCard(ev, p.events, 0)));
  }

  // depth 0 = 일반(복합 가능), 1 = 복합 하위(중첩 불가)
  _eventCard(ev, arr, depth) {
    const card = document.createElement('div');
    const folded = this._fold.has(ev.id);
    card.className = 'ev depth' + depth + (folded ? ' folded' : '');
    card.style.borderLeftColor = TYPE_COLORS[ev.type] || '#888';
    card.innerHTML = `
      <div class="ev-hd">
        <button class="fold-tog" title="접기/펼치기">${folded ? '▸' : '▾'}</button>
        <span class="ev-t">⏱<input type="number" step="0.05" value="${ev.time}" class="ev-time"></span>
        <select class="ev-type">${model.EVENT_TYPES.map((t) => `<option ${t === ev.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${depth === 0 ? `<label class="ef cmp"><input type="checkbox" class="ev-cmp" ${ev.composite ? 'checked' : ''}>복합</label>` : ''}
        <span class="grow"></span>
        <button class="mini copy-ev" title="이벤트 복사">⧉</button>
        <button class="mini del">×</button>
      </div>
      <div class="ev-body"></div>`;
    this._renderEventBody(card.querySelector('.ev-body'), ev, depth);

    const tog = card.querySelector('.fold-tog');
    tog.onclick = () => {
      const f = !this._fold.has(ev.id);
      if (f) this._fold.add(ev.id); else this._fold.delete(ev.id);
      card.classList.toggle('folded', f); tog.textContent = f ? '▸' : '▾';
    };

    card.querySelector('.ev-time').onchange = (e) => { ev.time = +e.target.value; this._mark(); this._renderTimeline(); this._renderEventList(); };
    card.querySelector('.ev-type').onchange = (e) => {
      const ne = model.newEvent(e.target.value); ne.id = ev.id; ne.time = ev.time; ne.composite = ev.composite; ne.sub = ev.sub;
      arr[arr.indexOf(ev)] = ne; this._mark(); this._renderTimeline();
      card.replaceWith(this._eventCard(ne, arr, depth));
    };
    if (depth === 0) card.querySelector('.ev-cmp').onchange = (e) => {
      ev.composite = e.target.checked; this._mark();
      this._renderEventBody(card.querySelector('.ev-body'), ev, depth);
    };
    card.querySelector('.copy-ev').onclick = () => { writeEventClip(this.entity, ev); this._renderDetail(); }; // 클립 저장 후 붙여넣기 버튼 활성화(헤더 재렌더)
    card.querySelector('.del').onclick = () => { arr.splice(arr.indexOf(ev), 1); this._mark(); this._refreshEvents(); };
    return card;
  }

  _renderEventBody(body, ev, depth) {
    body.innerHTML = this._fieldsHTML(ev);
    // 복합 하위 이벤트
    if (depth === 0 && ev.composite) {
      ev.sub ??= [];
      const sub = document.createElement('div'); sub.className = 'sub-events';
      const evClip = readEventClip();
      sub.innerHTML = `<div class="sub-hd">하위 이벤트 (병렬·글로벌 시간) <button class="mini" data-act="add-sub">+</button><button class="mini" data-act="paste-sub"${evClip ? '' : ' disabled'} title="복사한 이벤트 붙여넣기(복합 해제됨)">📋</button></div><div class="sub-list"></div>`;
      const list = sub.querySelector('.sub-list');
      [...ev.sub].sort((a, b) => a.time - b.time).forEach((s) => list.appendChild(this._eventCard(s, ev.sub, 1)));
      sub.querySelector('[data-act="add-sub"]').onclick = () => { ev.sub.push(model.newEvent('대기')); this._mark(); this._renderEventBody(body, ev, depth); };
      sub.querySelector('[data-act="paste-sub"]').onclick = () => {
        const clip = readEventClip(); if (!clip?.event) return;
        pasteEventInto(this.entity, ev.sub, clip, true); this._mark(); this._renderEventBody(body, ev, depth);
      };
      body.appendChild(sub);
    }
    // 필드 바인딩
    body.querySelectorAll('[data-f]').forEach((inp) => {
      const f = inp.dataset.f, t = inp.dataset.t;
      inp.addEventListener(t === 'num' ? 'input' : 'change', () => {
        ev[f] = t === 'num' ? +inp.value : t === 'bool' ? inp.checked : inp.value;
        this._mark();
        if (inp.dataset.re) this._renderEventBody(body, ev, depth);
      });
    });
    // 종류(defId) 드롭다운
    body.querySelectorAll('[data-def]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const list = sel.dataset.def === 'proj' ? lib.listProj(this.entity) : lib.listTerr(this.entity);
        ev.defId = sel.selectedIndex === 0 ? null : list[sel.selectedIndex - 1].id;
        this._mark();
      });
    });
    // 커스텀 경로 에디터
    const dp = body.querySelector('[data-act="dashpath"]');
    if (dp) dp.onclick = () => openPathEditor('dash', ev, () => { this._mark(); this._renderEventBody(body, ev, depth); });
    const tp = body.querySelector('[data-act="projtraj"]');
    if (tp) tp.onclick = () => openPathEditor('projpath', ev, () => { this._mark(); this._renderEventBody(body, ev, depth); });
  }

  // 투사체/지형 "종류" 선택 드롭다운 (공유 라이브러리 + 레거시 로컬 폴백)
  _defSel(kind, ev) {
    const list = kind === 'proj' ? lib.listProj(this.entity) : lib.listTerr(this.entity);
    const curIdx = list.findIndex((d) => d.id === ev.defId);
    const opts = ['(선택)', ...list.map((d) => d.name + (d._legacy ? ' (로컬)' : ''))];
    return `<select data-def="${kind}">${opts.map((o, i) => `<option ${i === curIdx + 1 ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }

  _fieldsHTML(ev) {
    switch (ev.type) {
      case '공격': {
        const a = [lab('인디케이터', inChk('indicator', ev.indicator, true))];
        if (ev.indicator) a.push(lab('표시s', inNum('indicatorTime', ev.indicatorTime, 0.1)));
        a.push(lab('피해', inNum('damage', ev.damage, 5)));
        a.push(lab('형태', inSel('shape', ev.shape, model.ATTACK_SHAPES, true)));
        if (ev.shape === '부채꼴') {
          a.push(lab('각도°', inNum('coneAngle', ev.coneAngle ?? 90, 5)));
          a.push(lab('지름', inNum('sizeA', ev.sizeA, 0.5)));
          a.push(lab('전방거리', inNum('offset', ev.offset, 0.5)));
          a.push(`<span class="dim small">꼭짓점=몬스터, facing 기준 ±${((ev.coneAngle ?? 90) / 2)}° 부채꼴(반지름=지름/2)</span>`);
        } else {
          a.push(lab('범위기준', inSel('area', ev.area, model.ATTACK_AREAS, true)));
          if (ev.area === '특정지역') {
            a.push(lab('지역', inSel('zone', ev.zone, model.ATTACK_ZONES, true)));
            if (ev.zone === '유저추적') a.push(lab('추적%', inNum('trackPct', ev.trackPct, 10)));
          } else {
            a.push(lab(ev.shape === '사각형' ? '길이' : '지름/거리', inNum('sizeA', ev.sizeA, 0.5)));
            if (ev.shape === '사각형') a.push(lab('폭', inNum('sizeB', ev.sizeB, 0.5)));
            a.push(lab('전방거리', inNum('offset', ev.offset, 0.5)));
          }
        }
        return a.join('');
      }
      case '걷기':
        return lab('속도', inNum('speed', ev.speed, 0.5))
          + lab('양옆(랜덤 좌/우)', inChk('side', ev.side))
          + `<span class="dim small">취소거리(Incl/Excl)는 BT 행에서 설정</span>`;
      case '대쉬': {
        let h = lab('방향', inSel('dir', ev.dir, model.DASH_DIRS, true));
        h += ev.dir === '커스텀'
          ? `<button class="mini" data-act="dashpath">경로 편집…${ev.customPath?.length ? ' ✓' : ''}</button>`
          : lab('거리m', inNum('dist', ev.dist, 0.5));
        if (ev.dir === '뒤곡선')
          h += lab('곡률', inNum('curve', ev.curve ?? 0.6, 0.1)) + `<span class="dim small">뒤로 빠진 뒤 휘는 정도(0=직선) · 좌/우 랜덤</span>`;
        h += lab('이징', inSel('ease', ev.ease ?? '등속', model.EASE_TYPES)) + `<span class="dim small">가/감속 곡선(총 이동거리는 동일)</span>`;
        h += lab('추적', inChk('track', ev.track));
        return h;
      }
      case '투사체': {
        let p = lab('종류', this._defSel('proj', ev)) + lab('개수', inNum('count', ev.count, 1))
          + lab('연사 간격s', inNum('interval', ev.interval, 0.05))
          + lab('방향', inSel('dir', ev.dir, model.PROJ_DIRS, true));
        if (ev.dir === '궤적') p += `<button class="mini" data-act="projtraj">궤적 그리기…${ev.projPath?.length ? ' ✓' : ''}</button><span class="dim small">곡선 시작=생성위치·시작방향=발사방향, 곡선 따라 비행(+x=발사 순간 유저 방향)</span>`;
        else if (ev.dir === '랜덤360') p += `<span class="dim small">360° 무작위 ${ev.count || 1}방향(발사마다 재추첨)</span>`;
        else if (ev.dir === '균일360') p += `<span class="dim small">360° 균등 ${ev.count || 1}방향(${(360 / (ev.count || 1)).toFixed(0)}° 간격)</span>`;
        else if (ev.dir === '유저조준') p += `<span class="dim small">발사 순간의 유저 위치로 조준</span>`;
        else if (ev.dir === '공격각도내 랜덤') p += `<span class="dim small">직전 공격각도 부채꼴 안 무작위 방향</span>`;
        if (ev.interval > 0 && (ev.count || 1) > 1) p += `<span class="dim small">${ev.count}발을 ${ev.interval}s 간격 연사(마지막 발=이벤트 시각)</span>`;
        p += lab('소멸후', inSel('expireAction', ev.expireAction, model.PROJ_EXPIRE));
        return p;
      }
      case '공격각도':
        return lab('각도°', inNum('angle', ev.angle, 5))
          + `<span class="dim small">이 시점 facing(유저 응시 방향) 기준 ±${((ev.angle || 90) / 2)}° 부채꼴 확정 · '공격각도내 랜덤' 투사체가 참조</span>`;
      case '음표카운터':
        return lab('증감(±)', inNum('amount', ev.amount, 1))
          + `<span class="dim small">머리 위 음표 ±N (음수=소모). 5개 누적 시 특수모드 강제 발동</span>`;
      case '회복':
        return lab('회복량', inNum('amount', ev.amount, 50))
          + `<span class="dim small">이 시간에 체력 +N 회복(시뮬은 표시만)</span>`;
      case '특수효과':
        return lab('색', inColor('fxColor', ev.fxColor ?? '#7ee787'))
          + lab('텍스트', inText('fxText', ev.fxText ?? ''))
          + `<span class="dim small">연출 전용: 이 시간에 색 링 + 텍스트 표시("이 패턴은 이런 효과를 얻는다"). 실제 상태효과는 없음</span>`;
      case '조건점검':
        return lab('조건', inSel('cond', ev.cond ?? '앞 거리 벽', model.CONDITION_TYPES, true))
          + lab('거리m', inNum('dist', ev.dist ?? 4, 0.5))
          + lab('참→모드전환', inSel('condMode', ev.condMode ?? '없음', model.CONDITION_MODES))
          + lab('참→패턴중단', inChk('condAbort', ev.condAbort))
          + `<span class="dim small">facing 방향 N m 안에 벽이 있으면(참) 모드전환/중단. 없으면 계속 수행 · BT 루프에서만 분기</span>`;
      case '지형': {
        let h = lab('종류', this._defSel('terrain', ev)) + lab('개수', inNum('count', ev.count, 1))
          + lab('위치', inSel('pos', ev.pos, model.TERRAIN_POS, true));
        if (ev.pos === '몬스터 위치') h += lab('전방거리', inNum('offset', ev.offset, 0.5));
        return h;
      }
      case '순간이동': {
        let h = lab('도착지', inSel('dest', ev.dest, model.TELEPORT_DEST, true));
        if (ev.dest === '유저로부터 랜덤') h += lab('반경m', inNum('dist', ev.dist, 0.5));
        h += `<span class="dim small">이 시간에 즉시 점프</span>`;
        return h;
      }
      case '모드전환':
        return lab('전환', inSel('toMode', ev.toMode, model.MODE_SWITCH))
          + `<span class="dim small">BT 루프에서 이 시간에 모드 변경(자동 교대 대체)</span>`;
      default:
        return `<span class="dim small">추가 설정 없음 (${ev.type})</span>`;
    }
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const attr = (s) => String(s ?? '').replace(/"/g, '&quot;');
