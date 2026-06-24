// ============================================================
//  ⑥ BT 표 에디터
//  행 = 규칙. 위→아래 = 우선순위. 컬럼: 모드/페이즈/거리/패턴/쿨/Incl/Excl/설명
//  선택 알고리즘: 특수행 우선 → 현재모드행, 각 위→아래 첫 매칭.
// ============================================================
import * as model from '../model.js';
import { enableDragSort } from './dragSort.js';

export class BTEditor {
  constructor(el, { onChange, btKey = 'bt', title = 'BT 표' } = {}) {
    this.el = el; this.onChange = onChange; this.entity = null;
    this.btKey = btKey; this.title = title;
    this.merge = true; // 셀 병합 보기(OFF면 모든 행 개별 편집)
    this._rz = null; this._colW = {}; // 컬럼 너비 드래그 상태 + 저장(재렌더 유지)
    document.addEventListener('mousemove', (e) => { if (!this._rz) return; const w = Math.max(28, this._rz.sw + (e.clientX - this._rz.sx)); this._rz.th.style.width = w + 'px'; this._colW[this._rz.i] = w; });
    document.addEventListener('mouseup', () => { this._rz = null; });
  }
  setEntity(entity) { this.entity = entity; this.render(); }
  _rows() { return this.entity[this.btKey]; }
  _mark() { this.onChange?.(); }

  render() {
    const e = this.entity; if (!e || !e[this.btKey]) { this.el.innerHTML = ''; return; }
    const rows = e[this.btKey];
    this.el.innerHTML = `
      <div class="sec-hd">${this.title} (${rows.length})
        <button class="mini" id="bt-merge" title="셀 병합 보기 토글(OFF=행별 편집)">${this.merge ? '⊟ 병합' : '⊞ 펼침'}</button>
        <button class="mini" id="bt-add">+ 행</button>
        <button class="mini" id="bt-copy"${rows.length ? '' : ' disabled'} title="이 BT 표 전체 복사">⧉ 복사</button>
        <button class="mini" id="bt-paste"${readBtClip() ? '' : ' disabled'} title="복사한 BT 붙여넣기(이름으로 패턴·거리·페이즈 매칭, 행 추가)">📋 붙여넣기</button>
        <span class="dim small" style="font-weight:400">· 위→아래 우선순위</span>
      </div>
      <div class="bt-wrap">
        <table class="bt-table">
          <thead><tr>
            <th>#</th><th>모드</th><th class="bt-th-phase">페이즈</th><th>거리</th><th>패턴</th>
            <th title="패턴 단위 쿨타임">쿨</th><th title="이 거리 이하로 가까워지면 취소">Incl</th>
            <th title="이 거리 이상 멀어지면 취소">Excl</th>
            <th title="모드 전환마다 0~1 난수 추첨 · 범위 안이면 최우선">랜덤</th>
            <th title="RandomSelect 사용 범위(0~1)">범위</th><th></th>
          </tr></thead>
          <tbody id="bt-body"></tbody>
        </table>
      </div>`;
    this.el.querySelector('#bt-add').onclick = () => { this._rows().push(model.newBTRow()); this._mark(); this._body(); };
    this.el.querySelector('#bt-merge').onclick = () => { this.merge = !this.merge; this.render(); };
    this.el.querySelector('#bt-copy').onclick = () => { writeBtClip(this.entity, this._rows()); this.render(); }; // 복사 후 붙여넣기 활성화
    this.el.querySelector('#bt-paste').onclick = () => {
      const data = readBtClip(); if (!data) return;
      this._rows().push(...pasteBtRows(this.entity, data)); this._mark(); this._body();
    };
    this._body();
    this._addColResizers();
  }
  // 헤더 th 우측에 드래그 그립 추가 → 컬럼 너비 조절(저장된 너비 복원)
  _addColResizers() {
    const ths = this.el.querySelectorAll('.bt-table thead th');
    ths.forEach((th, i) => {
      if (this._colW[i]) th.style.width = this._colW[i] + 'px';
      const g = document.createElement('div'); g.className = 'col-rsz';
      th.style.position = 'relative'; th.appendChild(g);
      g.addEventListener('mousedown', (e) => { this._rz = { th, i, sx: e.clientX, sw: th.getBoundingClientRect().width }; e.preventDefault(); e.stopPropagation(); });
    });
  }

  _body() {
    const e = this.entity; const tb = this.el.querySelector('#bt-body');
    const rows = this._rows();
    tb.innerHTML = '';
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="11" class="dim small" style="padding:8px">규칙 없음 — "+ 행" 추가</td></tr>`; return; }
    const phaseOpts = ['전체', ...e.phases.map((p) => p.name)];
    const bandOpts = ['전체', ...e.distanceBands.map((b) => `${b.name}(${b.min}~${b.max})`)];
    const patOpts = ['(없음)', ...e.patterns.map((p) => p.name)];

    // 연속 같은 값 병합(rowspan): 모드/페이즈/거리 — run-first 행만 span 칸, 나머지는 칸 생략
    const runs = (key) => { const a = []; for (let i = 0; i < rows.length; i++) { if (i > 0 && rows[i][key] === rows[i - 1][key]) a.push(0); else { let j = i + 1; while (j < rows.length && rows[j][key] === rows[i][key]) j++; a.push(j - i); } } return a; };
    const ones = rows.map(() => 1);
    const mR = this.merge ? runs('mode') : ones;
    const pR = this.merge ? runs('phaseIdx') : ones;
    const bR = this.merge ? runs('band') : ones;
    // 병합 ON + 페이즈가 전부 한 칸으로 합쳐지면 페이즈 열 숨김. 펼침(OFF) 모드에선 항상 표시(편집용)
    const showPhase = !this.merge || pR[0] !== rows.length;
    const thP = this.el.querySelector('.bt-th-phase'); if (thP) thP.style.display = showPhase ? '' : 'none';
    const mg = (span, inner) => `<td rowspan="${span}" class="bt-mg" style="vertical-align:middle;text-align:center">${inner}</td>`;

    const trEls = [];
    rows.forEach((r, i) => {
      const pat = e.patterns.find((p) => p.id === r.patternId);
      const cd = pat ? pat.cooldown : '-';
      const tr = document.createElement('tr');
      tr.className = 'bt-row mode-' + (r.mode === '공격' ? 'atk' : r.mode === '수비' ? 'def' : 'sp');
      let h = `<td class="bt-i drag-handle" title="드래그로 순서 변경">${i + 1}</td>`;
      if (mR[i]) h += mg(mR[i], sel(model.MODES, r.mode, 'mode'));
      if (showPhase && pR[i]) h += mg(pR[i], selIdx(phaseOpts, r.phaseIdx, 'phase'));
      if (bR[i]) h += mg(bR[i], selIdx(bandOpts, r.band, 'band'));
      h += `<td>${selPat(patOpts, pat ? pat.name : '(없음)', 'pat')}</td>`;
      h += `<td class="bt-cd">${cd}</td>`;
      h += `<td>${num(r.inclusive, 0.5, 'inc')}</td>`;
      h += `<td>${num(r.exclusive, 0.5, 'exc')}</td>`;
      h += `<td class="bt-rs-chk">${chk(r.randomSelect, 'rnd')}</td>`;
      h += `<td class="bt-rs">${r.randomSelect ? `${num01(r.rsMin ?? 0, 'rmin')}~${num01(r.rsMax ?? 1, 'rmax')}` : ''}</td>`;
      h += `<td class="bt-act"><button class="mini del" data-a="del">×</button></td>`;
      tr.innerHTML = h;
      // 병합 컬럼 변경은 런(run) 전체에 적용 후 재렌더(병합 재계산)
      const setRun = (span, fn) => { for (let k = 0; k < span; k++) fn(rows[i + k]); this._mark(); this._body(); };
      const mSel = tr.querySelector('[data-col="mode"]');
      if (mSel) mSel.onchange = () => setRun(mR[i], (row) => row.mode = mSel.value);
      const phSel = tr.querySelector('[data-col="phase"]');
      if (phSel) phSel.onchange = () => setRun(pR[i], (row) => row.phaseIdx = phSel.selectedIndex - 1);
      const bSel = tr.querySelector('[data-col="band"]');
      if (bSel) bSel.onchange = () => setRun(bR[i], (row) => row.band = bSel.selectedIndex - 1);
      const pSel = tr.querySelector('[data-col="pat"]');
      pSel.onchange = () => { r.patternId = pSel.selectedIndex === 0 ? null : e.patterns[pSel.selectedIndex - 1].id; this._mark(); this._body(); };
      const inc = tr.querySelector('[data-col="inc"]'), exc = tr.querySelector('[data-col="exc"]');
      inc.oninput = () => { r.inclusive = +inc.value; this._mark(); };
      exc.oninput = () => { r.exclusive = +exc.value; this._mark(); };
      const rnd = tr.querySelector('[data-col="rnd"]');
      rnd.onchange = () => { r.randomSelect = rnd.checked; if (r.randomSelect) { r.rsMin ??= 0; r.rsMax ??= 1; } this._mark(); this._body(); }; // 범위 입력칸 표시/숨김 위해 재렌더
      const rmin = tr.querySelector('[data-col="rmin"]'), rmax = tr.querySelector('[data-col="rmax"]');
      const clamp01 = (v) => Math.max(0, Math.min(1, v));
      if (rmin) rmin.oninput = () => { r.rsMin = clamp01(+rmin.value); this._mark(); };
      if (rmax) rmax.oninput = () => { r.rsMax = clamp01(+rmax.value); this._mark(); };
      tr.querySelector('[data-a="del"]').onclick = () => { rows.splice(i, 1); this._mark(); this._body(); };
      tb.appendChild(tr); trEls.push(tr);
    });
    // 행 # 칸을 잡고 드래그 → 순서 변경(병합 보기는 재계산됨)
    enableDragSort(trEls, rows, () => { this._mark(); this._body(); });
  }
}

const sel = (opts, v, col) => `<select data-col="${col}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
const selIdx = (opts, idx, col) => `<select data-col="${col}">${opts.map((o, i) => `<option ${i - 1 === idx ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const selPat = (opts, v, col) => `<select data-col="${col}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const num = (v, step, col) => `<input type="number" data-col="${col}" step="${step}" value="${v ?? 0}">`;
const num01 = (v, col) => `<input type="number" class="bt-rs-in" data-col="${col}" step="0.05" min="0" max="1" value="${v ?? 0}">`;
const chk = (v, col) => `<input type="checkbox" data-col="${col}"${v ? ' checked' : ''}>`;
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── BT 표 클립보드(몬스터 간 복붙) ──────────────────
//  patternId·band·phaseIdx 는 엔티티마다 다른 id/인덱스 → "이름"으로 저장했다가 붙일 때 대상에서 재매칭.
const BT_CLIP = 'bb-editor:bt-clip';
function writeBtClip(entity, rows) {
  const bandName = (i) => i < 0 ? '전체' : (entity.distanceBands[i]?.name ?? '전체');
  const phaseName = (i) => i < 0 ? '전체' : (entity.phases[i]?.name ?? '전체');
  const patName = (id) => entity.patterns.find((p) => p.id === id)?.name ?? null;
  const data = rows.map((r) => ({ mode: r.mode, band: bandName(r.band), phase: phaseName(r.phaseIdx), pattern: patName(r.patternId), inclusive: r.inclusive, exclusive: r.exclusive }));
  try { localStorage.setItem(BT_CLIP, JSON.stringify(data)); } catch { /* 무시 */ }
}
function readBtClip() { try { return JSON.parse(localStorage.getItem(BT_CLIP) || 'null'); } catch { return null; } }
function pasteBtRows(entity, data) {
  const bandIdx = (name) => name === '전체' ? -1 : Math.max(-1, entity.distanceBands.findIndex((b) => b.name === name));
  const phaseIdx = (name) => name === '전체' ? -1 : Math.max(-1, entity.phases.findIndex((p) => p.name === name));
  const patId = (name) => name ? (entity.patterns.find((p) => p.name === name)?.id ?? null) : null;
  return (data || []).map((d) => ({ ...model.newBTRow(), mode: d.mode || '공격', band: bandIdx(d.band), phaseIdx: phaseIdx(d.phase), patternId: patId(d.pattern), inclusive: d.inclusive ?? 0, exclusive: d.exclusive ?? 99 }));
}
