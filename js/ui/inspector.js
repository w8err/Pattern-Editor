// ============================================================
//  엔티티 인스펙터 (①단계: 기본 속성 폼)
//  이름/크기/회전속도/거리밴드/페이즈/설명 편집 → 저장 시 파일 기록.
//  패턴·이벤트·BT 편집기는 다음 단계에서 이 패널에 확장.
// ============================================================
import * as model from '../model.js';
import { PatternEditor } from './patterns.js';
import { BTEditor } from './bt.js';

export class Inspector {
  constructor(el, { onSave, onEntityLoad, onPatternSelect }) {
    this.el = el;
    this.onSave = onSave;
    this.onEntityLoad = onEntityLoad;
    this.onPatternSelect = onPatternSelect;
    this.entity = null;
    this.fileNode = null;
    this.dirty = false;
    this.patternEditor = null;
  }

  load(entity, fileNode) {
    this.entity = entity;
    this.fileNode = fileNode;
    this.dirty = false;
    this.render();
    if (entity.kind !== 'user') this.onEntityLoad?.(entity); // 유저는 플레이백 보스로 안 올림(AI는 별도 선택)
  }

  _mark() { this.dirty = true; this._updateSaveBtn(); }
  _refreshBT() { this.btEditor?.render(); this.bt2Editor?.render(); } // 거리밴드/페이즈 변경 → BT 드롭다운 갱신
  _updateSaveBtn() {
    const b = this.el.querySelector('#insp-save');
    if (b) { b.disabled = !this.dirty; b.textContent = this.dirty ? '💾 저장 *' : '💾 저장됨'; }
  }

  render() {
    const e = this.entity;
    if (!e) { this.el.innerHTML = '<div class="insp-empty">엔티티를 선택하세요</div>'; return; }
    if (e.kind === 'user') { this._renderUser(); return; }
    const isBoss = e.kind === 'boss';

    this.el.innerHTML = `
      <div class="insp-hd">
        <span class="badge ${e.kind}">${isBoss ? '보스' : '몬스터'}</span>
        <input id="f-name" class="in-name" value="${attr(e.name)}">
        <button id="insp-save" class="btn">💾 저장됨</button>
      </div>
      <div class="insp-body">
        <div class="grid3">
          <label>체력(HP)<input id="f-hp" type="number" step="100" value="${e.hp}"></label>
          <label>크기(반경 m)<input id="f-size" type="number" step="0.05" value="${e.size}"></label>
          <label>회전속도(°/s)<input id="f-rot" type="number" step="10" value="${e.rotationSpeed}"></label>
        </div>

        <div class="sec-hd">거리밴드 <button id="add-band" class="mini">+</button></div>
        <div id="bands"></div>

        <div class="sec-hd">페이즈 <button id="add-phase" class="mini">+</button></div>
        <div id="phases"></div>

        <div class="sec-hd">설명</div>
        <textarea id="f-desc" rows="3">${txt(e.description || '')}</textarea>

        <div class="sec-hd">투사체 정의 <button id="add-proj" class="mini">+</button></div>
        <div id="proj-defs"></div>
        <div class="sec-hd">지형 정의 <button id="add-terr" class="mini">+</button></div>
        <div id="terr-defs"></div>

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
    e.projectiles ??= []; e.terrains ??= [];
    this._renderProjDefs(); this._renderTerrDefs();
    this.el.querySelector('#add-proj').onclick = () => { e.projectiles.push(model.newProjectileDef()); this._mark(); this._renderProjDefs(); };
    this.el.querySelector('#add-terr').onclick = () => { e.terrains.push(model.newTerrainDef()); this._mark(); this._renderTerrDefs(); };

    this.el.querySelector('#insp-save').onclick = () => this.save();

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
    this.el.querySelector('#insp-save').onclick = () => this.save();
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

  _renderProjDefs() {
    const box = this.el.querySelector('#proj-defs'); const e = this.entity;
    box.innerHTML = '';
    if (!e.projectiles.length) box.innerHTML = '<div class="dim small">정의 없음</div>';
    e.projectiles.forEach((d, i) => {
      const row = document.createElement('div'); row.className = 'rowline';
      row.innerHTML = `
        <input class="grow" value="${attr(d.name)}" title="이름">
        <input type="number" step="5" style="width:56px" value="${d.damage}" title="피해"><span class="unit">뎀</span>
        <input type="number" step="0.5" style="width:50px" value="${d.speed}" title="속도"><span class="unit">속</span>
        <input type="number" step="0.1" style="width:50px" value="${d.lifetime}" title="소멸s"><span class="unit">소</span>
        <input type="number" step="10" style="width:50px" value="${d.homing}" title="호밍%"><span class="unit">호</span>
        <button class="mini del">×</button>`;
      const [nm, dmg, sp, lf, hm] = row.querySelectorAll('input');
      nm.oninput = () => { d.name = nm.value; this._mark(); };
      dmg.oninput = () => { d.damage = +dmg.value; this._mark(); };
      sp.oninput = () => { d.speed = +sp.value; this._mark(); };
      lf.oninput = () => { d.lifetime = +lf.value; this._mark(); };
      hm.oninput = () => { d.homing = +hm.value; this._mark(); };
      row.querySelector('.del').onclick = () => { e.projectiles.splice(i, 1); this._mark(); this._renderProjDefs(); };
      box.appendChild(row);
    });
  }

  _renderTerrDefs() {
    const box = this.el.querySelector('#terr-defs'); const e = this.entity;
    box.innerHTML = '';
    if (!e.terrains.length) box.innerHTML = '<div class="dim small">정의 없음</div>';
    e.terrains.forEach((d, i) => {
      const row = document.createElement('div'); row.className = 'rowline';
      const opts = model.TERRAIN_TYPES.map((t) => `<option ${t === d.terrain ? 'selected' : ''}>${t}</option>`).join('');
      row.innerHTML = `
        <input class="grow" value="${attr(d.name)}" title="이름">
        <select title="형태">${opts}</select>
        <input type="number" step="0.5" style="width:56px" value="${d.size}" title="지름m"><span class="unit">⌀</span>
        <input type="number" step="0.5" style="width:56px" value="${d.duration}" title="지속s"><span class="unit">s</span>
        <button class="mini del">×</button>`;
      const nm = row.querySelector('input'); const sel = row.querySelector('select');
      const [, sz, du] = row.querySelectorAll('input');
      nm.oninput = () => { d.name = nm.value; this._mark(); };
      sel.onchange = () => { d.terrain = sel.value; this._mark(); };
      sz.oninput = () => { d.size = +sz.value; this._mark(); };
      du.oninput = () => { d.duration = +du.value; this._mark(); };
      row.querySelector('.del').onclick = () => { e.terrains.splice(i, 1); this._mark(); this._renderTerrDefs(); };
      box.appendChild(row);
    });
  }

  async save() {
    if (!this.entity || !this.fileNode) return;
    await this.onSave?.(this.entity, this.fileNode);
    this.dirty = false; this._updateSaveBtn();
  }
}

const attr = (s) => String(s ?? '').replace(/"/g, '&quot;');
const txt  = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
