// ============================================================
//  엔티티 인스펙터 (①단계: 기본 속성 폼)
//  이름/크기/회전속도/거리밴드/페이즈/설명 편집 → 저장 시 파일 기록.
//  패턴·이벤트·BT 편집기는 다음 단계에서 이 패널에 확장.
// ============================================================
import * as model from '../model.js';
import * as lib from '../library.js';
import { PatternEditor } from './patterns.js';
import { BTEditor } from './bt.js';

export class Inspector {
  constructor(el, { onSave, onSaveAll, onEntityLoad, onPatternSelect, onDirtyChange, onConsolidate }) {
    this.el = el;
    this.onSave = onSave;
    this.onSaveAll = onSaveAll;
    this.onEntityLoad = onEntityLoad;
    this.onPatternSelect = onPatternSelect;
    this.onDirtyChange = onDirtyChange;
    this.onConsolidate = onConsolidate; // 정의 문서에서 '기존 정의 전체 이전'
    this.entity = null;
    this.fileNode = null;
    this.dirty = false;
    this.patternEditor = null;
    this._foldDef = new Set(); // 접힌 투사체/지형 정의 id 집합
    this._saveCount = 0;       // 전역 미저장 파일 수(저장 버튼 표시용)
  }

  load(entity, fileNode) {
    this.entity = entity;
    this.fileNode = fileNode;
    this.dirty = false;
    this.render();
    this.onDirtyChange?.(fileNode, false); // 새 파일 로드 → 이전 미저장 표시 해제
    if (entity.kind === 'monster' || entity.kind === 'boss') this.onEntityLoad?.(entity); // 정의 문서·유저는 플레이백에 안 올림
  }

  _mark() { const was = this.dirty; this.dirty = true; this._updateSaveBtn(); if (!was) this.onDirtyChange?.(this.fileNode, true); }
  markDirty() { this._mark(); } // 외부(메인)에서 캐시된 미저장 상태 복원용
  setClean() { const was = this.dirty; this.dirty = false; this._updateSaveBtn(); if (was) this.onDirtyChange?.(this.fileNode, false); }
  setSaveAllCount(n) { this._saveCount = n; this._updateSaveBtn(); } // 전역 미저장 수 반영
  _refreshBT() { this.btEditor?.render(); this.bt2Editor?.render(); } // 거리밴드/페이즈 변경 → BT 드롭다운 갱신
  // 배포(web) 데이터 안내 — 편집해도 이 브라우저에만 남고 실제 데이터엔 반영 안 됨
  _webNotice() {
    if (!this.fileNode?.web) return '';
    return `<div class="web-notice">📢 <b>배포 데이터(읽기 전용)</b> — 편집·저장해도 이 브라우저에만 임시로 남고 실제 파일/배포엔 반영되지 않습니다.</div>`;
  }
  _updateSaveBtn() {
    const b = this.el.querySelector('#insp-save');
    if (b) { b.disabled = !this._saveCount; b.textContent = this._saveCount ? `💾 전체 저장 (${this._saveCount})` : '💾 저장됨'; }
  }

  render() {
    const e = this.entity;
    if (!e) { this.el.innerHTML = '<div class="insp-empty">엔티티를 선택하세요</div>'; return; }
    if (e.kind === 'projectiles' || e.kind === 'terrains') { this._renderDefDoc(e); return; }
    if (e.kind === 'user') { this._renderUser(); return; }
    const isBoss = e.kind === 'boss';

    this.el.innerHTML = `
      <div class="insp-hd">
        <span class="badge ${e.kind}">${isBoss ? '보스' : '몬스터'}</span>
        <input id="f-name" class="in-name" value="${attr(e.name)}">
        <button id="insp-save" class="btn">💾 저장됨</button>
      </div>
      <div class="insp-body">
        ${this._webNotice()}
        <div class="grid3">
          <label>체력(HP)<input id="f-hp" type="number" step="100" value="${e.hp}"></label>
          <label>크기(반경 m)<input id="f-size" type="number" step="0.05" value="${e.size}"></label>
          <label>회전속도(°/s)<input id="f-rot" type="number" step="10" value="${e.rotationSpeed}"></label>
          <label>폰 색상<input id="f-color" type="color" value="${e.color || (isBoss ? '#f0883e' : '#3fb950')}"></label>
          <label>비주얼 무기<select id="f-weapon"><option value="">없음</option><option value="axe" ${e.visualWeapon === 'axe' ? 'selected' : ''}>도끼</option></select></label>
        </div>

        <div class="sec-hd">거리밴드 <button id="add-band" class="mini">+</button></div>
        <div id="bands"></div>

        <div class="sec-hd">페이즈 <button id="add-phase" class="mini">+</button></div>
        <div id="phases"></div>

        <div class="sec-hd">설명</div>
        <textarea id="f-desc" rows="3">${txt(e.description || '')}</textarea>

        <div id="migrate-defs"></div>

        <div id="patterns-host"></div>
        ${isBoss ? `<div class="rowline" style="margin-top:6px"><label class="ef"><input type="checkbox" id="f-dual"> 이중 무기(해금/대금 BT 분리)</label></div>` : ''}
        <div id="bt-host"></div>
        <div id="bt2-host"></div>
      </div>`;

    // 스칼라
    this.el.querySelector('#f-name').oninput = (ev) => { e.name = ev.target.value; this._mark(); };
    this.el.querySelector('#f-hp').oninput = (ev) => { e.hp = +ev.target.value; this._mark(); };
    this.el.querySelector('#f-size').oninput = (ev) => { e.size = +ev.target.value; this._mark(); };
    this.el.querySelector('#f-rot').oninput = (ev) => { e.rotationSpeed = +ev.target.value; this._mark(); };
    this.el.querySelector('#f-color').oninput = (ev) => { e.color = ev.target.value; this._mark(); this.onEntityLoad?.(e); }; // 색 변경 즉시 렌더 반영
    this.el.querySelector('#f-weapon').onchange = (ev) => { e.visualWeapon = ev.target.value || null; this._mark(); this.onEntityLoad?.(e); }; // 비주얼 무기 즉시 반영
    this.el.querySelector('#f-desc').oninput = (ev) => { e.description = ev.target.value; this._mark(); };

    this._renderBands();
    this._renderPhases();
    this.el.querySelector('#add-band').onclick = () => {
      const prev = e.distanceBands[e.distanceBands.length - 1];
      const min = prev ? prev.max : 0;
      e.distanceBands.push({ name: '새거리', min, max: min + 3 }); this._mark(); this._renderBands(); this._refreshBT();
    };
    this.el.querySelector('#add-phase').onclick = () => {
      e.phases.push({ name: '새 페이즈', hp: 1000, transitionPatternId: null }); this._mark(); this._renderPhases(); this._refreshBT();
    };
    this._renderMigrate(); // 레거시 로컬 정의가 남아 있으면 이전 안내

    this.el.querySelector('#insp-save').onclick = () => (this.onSaveAll ? this.onSaveAll() : this.save());

    // ②③ 패턴/이벤트 편집기
    this.patternEditor = new PatternEditor(this.el.querySelector('#patterns-host'), {
      onChange: () => { this._mark(); this.btEditor?.render(); this.bt2Editor?.render(); },
      onSelect: (p) => this.onPatternSelect?.(p),
    });
    this.patternEditor.setEntity(e);

    // ⑥ BT 표 (이중 무기일 때 해금/대금 분리)
    const dual = !!(e.weaponNames && Array.isArray(e.bt2));
    const dualChk = this.el.querySelector('#f-dual');
    if (dualChk) {
      dualChk.checked = dual;
      dualChk.onchange = (ev) => {
        if (ev.target.checked) { e.weaponNames = ['해금', '대금']; e.bt2 ??= []; }
        else { delete e.weaponNames; delete e.bt2; }
        this._mark(); this.onEntityLoad?.(e); this.render();
      };
    }
    this.btEditor = new BTEditor(this.el.querySelector('#bt-host'),
      { onChange: () => this._mark(), btKey: 'bt', title: dual ? `무기1 BT (${e.weaponNames[0]})` : 'BT 표' });
    this.btEditor.setEntity(e);
    if (dual) {
      this.bt2Editor = new BTEditor(this.el.querySelector('#bt2-host'),
        { onChange: () => this._mark(), btKey: 'bt2', title: `무기2 BT (${e.weaponNames[1]})` });
      this.bt2Editor.setEntity(e);
    }

    this._updateSaveBtn();
  }

  _renderUser() {
    const e = this.entity;
    const g = (k, label, step) => `<label>${label}<input data-k="${k}" type="number" step="${step}" value="${e[k]}"></label>`;
    this.el.innerHTML = `
      <div class="insp-hd">
        <span class="badge user">유저</span>
        <input id="f-name" class="in-name" value="${attr(e.name)}">
        <button id="insp-save" class="btn">💾 저장됨</button>
      </div>
      <div class="insp-body">
        ${this._webNotice()}
        <div class="sec-hd">기본</div>
        <div class="grid3">
          ${g('size', '크기(반경 m)', 0.05)}${g('moveSpeed', '이동속도(m/s)', 0.5)}${g('rotationSpeed', '회전속도(°/s)', 10)}
          ${g('hp', 'HP', 100)}${g('basicRange', '사거리(m)', 0.1)}
        </div>
        <div class="sec-hd">대시 / 스태미나</div>
        <div class="grid3">
          ${g('dashDist', '대시거리', 0.1)}${g('dashDur', '대시시간s', 0.05)}${g('dashInvuln', '무적s', 0.01)}
          ${g('dashStamina', '대시 스태미나', 10)}${g('maxStamina', '최대 스태미나', 10)}${g('staminaRegen', '재생/s', 5)}
        </div>
        <div class="sec-hd">회피 AI</div>
        <div class="grid3">
          ${g('dodgeChance', '회피확률(0~1)', 0.05)}${g('reactionTime', '반응시간s', 0.05)}${g('dodgeThresh', '회피 임계', 0.1)}
        </div>
        <div class="sec-hd">움직임(스티어링)</div>
        <div class="grid3">
          ${g('lookahead', '예측거리', 0.1)}${g('wInterest', '거리유지 w', 0.1)}${g('wDanger', '위험회피 w', 0.5)}
          ${g('wWall', '벽회피 w', 0.1)}${g('wNoise', '노이즈 w', 0.1)}${g('noiseDrift', '노이즈 속도', 0.1)}
        </div>
        <div class="sec-hd">설명</div>
        <textarea id="f-desc" rows="2">${txt(e.description || '')}</textarea>
      </div>`;
    this.el.querySelector('#f-name').oninput = (ev) => { e.name = ev.target.value; this._mark(); };
    this.el.querySelector('#f-desc').oninput = (ev) => { e.description = ev.target.value; this._mark(); };
    this.el.querySelectorAll('input[data-k]').forEach((inp) => { inp.oninput = () => { e[inp.dataset.k] = +inp.value; this._mark(); }; });
    this.el.querySelector('#insp-save').onclick = () => (this.onSaveAll ? this.onSaveAll() : this.save());
    this._updateSaveBtn();
  }

  _renderBands() {
    const box = this.el.querySelector('#bands'); const e = this.entity;
    box.innerHTML = '';
    e.distanceBands.forEach((b, i) => {
      const row = document.createElement('div'); row.className = 'rowline';
      row.innerHTML = `
        <input class="grow" value="${attr(b.name)}">
        <input type="number" step="0.5" style="width:62px" value="${b.min ?? 0}">
        <span class="unit">~</span>
        <input type="number" step="0.5" style="width:62px" value="${b.max}">
        <span class="unit">m</span>
        <button class="mini del">×</button>`;
      const [nm, mn, mx] = row.querySelectorAll('input');
      nm.oninput = () => { b.name = nm.value; this._mark(); this._refreshBT(); };
      mn.oninput = () => { b.min = +mn.value; this._mark(); this._refreshBT(); };
      mx.oninput = () => { b.max = +mx.value; this._mark(); this._refreshBT(); };
      row.querySelector('.del').onclick = () => { e.distanceBands.splice(i, 1); this._mark(); this._renderBands(); this._refreshBT(); };
      box.appendChild(row);
    });
  }

  _renderPhases() {
    const box = this.el.querySelector('#phases'); const e = this.entity;
    box.innerHTML = '';
    if (!e.phases.length) box.innerHTML = '<div class="dim small">페이즈 없음</div>';
    e.phases.forEach((p, i) => {
      const row = document.createElement('div'); row.className = 'rowline';
      row.innerHTML = `
        <span class="pidx">P${i + 1}</span>
        <input class="grow" value="${attr(p.name)}">
        <input type="number" step="100" style="width:80px" value="${p.hp}"><span class="unit">HP</span>
        <button class="mini del">×</button>`;
      const [nm, hp] = row.querySelectorAll('input');
      nm.oninput = () => { p.name = nm.value; this._mark(); this._refreshBT(); };
      hp.oninput = () => { p.hp = +hp.value; this._mark(); };
      row.querySelector('.del').onclick = () => { e.phases.splice(i, 1); this._mark(); this._renderPhases(); this._refreshBT(); };
      box.appendChild(row);
    });
  }

  // 접이식 정의 카드 헬퍼: 헤더(이름·미리보기·접기·삭제) + 한 줄 1속성 본문
  _defCard(d, { preview, onDel, onName }) {
    const folded = this._foldDef.has(d.id);
    const card = document.createElement('div');
    card.className = 'def-card' + (folded ? ' folded' : '');
    card.innerHTML = `
      <div class="def-hd">
        <button class="fold-tog" title="접기/펼치기">${folded ? '▸' : '▾'}</button>
        <input class="grow d-name" value="${attr(d.name)}" title="이름">
        ${preview}
        <button class="mini del">×</button>
      </div>
      <div class="def-body"></div>`;
    card.querySelector('.d-name').oninput = (ev) => { d.name = ev.target.value; (onName || (() => this._mark()))(); };
    card.querySelector('.del').onclick = onDel;
    const tog = card.querySelector('.fold-tog');
    tog.onclick = () => {
      const f = !this._foldDef.has(d.id);
      if (f) this._foldDef.add(d.id); else this._foldDef.delete(d.id);
      card.classList.toggle('folded', f); tog.textContent = f ? '▸' : '▾';
    };
    return card;
  }
  // 본문 한 줄: 라벨 좌 · 입력 우
  _defRow(label, input) {
    const r = document.createElement('div'); r.className = 'def-row';
    r.innerHTML = `<span>${label}</span>`;
    r.appendChild(input);
    return r;
  }
  _numIn(value, step, oninput) {
    const inp = document.createElement('input'); inp.type = 'number'; inp.step = step; inp.value = value;
    inp.oninput = () => { oninput(+inp.value); }; // dirty 처리는 콜백이 담당(라이브러리 정의 전용)
    return inp;
  }

  // ── 정의 문서(투사체.json / 지형.json) 편집기 ──
  _renderDefDoc(e) {
    e.items ??= [];
    const isProj = e.kind === 'projectiles';
    this.el.innerHTML = `
      <div class="insp-hd">
        <span class="badge ${isProj ? 'monster' : 'boss'}">${isProj ? '투사체 정의' : '지형 정의'}</span>
        <span class="in-name" style="flex:1;font-weight:600">${isProj ? '투사체.json' : '지형.json'} · 공유</span>
        <button id="insp-save" class="btn">💾 저장됨</button>
      </div>
      <div class="insp-body">
        ${this._webNotice()}
        <div class="web-notice" style="color:#9fb4d0;background:#1f6feb14;border-color:#1f6feb55">📚 여기 정의한 ${isProj ? '투사체' : '지형'}는 <b>모든 몬스터</b>가 이벤트에서 골라 씁니다. 정의는 이 파일에만 저장됩니다.</div>
        <div class="sec-hd">정의 (${e.items.length}) <button id="add-def" class="mini">+ 추가</button>
          <button id="consolidate" class="mini" title="기존 몬스터에 박힌 정의를 이 문서들로 모으기">⬆ 기존 정의 이전</button>
        </div>
        <div id="def-list"></div>
      </div>`;
    this.el.querySelector('#insp-save').onclick = () => (this.onSaveAll ? this.onSaveAll() : this.save());
    this.el.querySelector('#add-def').onclick = () => {
      e.items.push(isProj ? model.newProjectileDef() : model.newTerrainDef()); this._mark(); this.render();
    };
    this.el.querySelector('#consolidate').onclick = () => this.onConsolidate?.();
    this._renderDefList(e, isProj);
  }
  _renderDefList(e, isProj) {
    const box = this.el.querySelector('#def-list'); box.innerHTML = '';
    if (!e.items.length) { box.innerHTML = '<div class="dim small">정의 없음 — "+ 추가"</div>'; return; }
    e.items.forEach((d, i) => {
      const card = this._defCard(d, {
        preview: isProj ? `<input type="color" class="d-color" style="width:30px;padding:0" value="${d.color || '#f0883e'}" title="색">` : '',
        onDel: () => { e.items.splice(i, 1); this._mark(); this.render(); },
        onName: () => this._mark(),
      });
      const body = card.querySelector('.def-body');
      if (isProj) {
        body.appendChild(this._defRow('피해', this._numIn(d.damage, 5, (v) => { d.damage = v; this._mark(); })));
        body.appendChild(this._defRow('속도 (m/s)', this._numIn(d.speed, 0.5, (v) => { d.speed = v; this._mark(); })));
        body.appendChild(this._defRow('소멸 시간 (s)', this._numIn(d.lifetime, 0.1, (v) => { d.lifetime = v; this._mark(); })));
        body.appendChild(this._defRow('호밍 (%)', this._numIn(d.homing, 10, (v) => { d.homing = v; this._mark(); })));
        body.appendChild(this._defRow('크기 (반경 m)', this._numIn(d.size ?? 0.3, 0.05, (v) => { d.size = v; this._mark(); })));
        card.querySelector('.d-color').oninput = (ev) => { d.color = ev.target.value; this._mark(); };
      } else {
        const sel = document.createElement('select');
        sel.innerHTML = model.TERRAIN_TYPES.map((t) => `<option ${t === d.terrain ? 'selected' : ''}>${t}</option>`).join('');
        sel.onchange = () => { d.terrain = sel.value; this._mark(); };
        body.appendChild(this._defRow('형태', sel));
        body.appendChild(this._defRow('지름 (m)', this._numIn(d.size, 0.5, (v) => { d.size = v; this._mark(); })));
        body.appendChild(this._defRow('지속 (s)', this._numIn(d.duration, 0.5, (v) => { d.duration = v; this._mark(); })));
      }
      box.appendChild(card);
    });
  }

  // 몬스터에 아직 남은 로컬(레거시) 정의 안내 — 정의 파일에서 '기존 정의 이전' 실행 유도
  _renderMigrate() {
    const box = this.el.querySelector('#migrate-defs'); if (!box) return;
    box.innerHTML = '';
    const e = this.entity; if (!lib.hasLocalDefs(e)) return;
    const n = (e.projectiles?.length || 0) + (e.terrains?.length || 0);
    box.innerHTML = `<div class="web-notice" style="color:#ffd9a0">⬆ 이 몬스터에 구 정의 ${n}개가 박혀 있습니다 — <b>투사체.json / 지형.json</b>을 열어 "기존 정의 이전"을 실행하면 공유 문서로 옮겨집니다.</div>`;
  }

  async save() {
    if (!this.entity || !this.fileNode) return;
    await this.onSave?.(this.entity, this.fileNode);
    this.dirty = false; this._updateSaveBtn();
    this.onDirtyChange?.(this.fileNode, false);
  }
}

const attr = (s) => String(s ?? '').replace(/"/g, '&quot;');
const txt  = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
