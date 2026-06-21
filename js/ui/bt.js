// ============================================================
//  ⑥ BT 표 에디터
//  행 = 규칙. 위→아래 = 우선순위. 컬럼: 모드/페이즈/거리/패턴/쿨/Incl/Excl/설명
//  선택 알고리즘: 특수행 우선 → 현재모드행, 각 위→아래 첫 매칭.
// ============================================================
import * as model from '../model.js';

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
      <div class="sec-hd">${this.title} (${rows.length}) <span class="dim small">· 위→아래 우선순위</span>
        <span class="grow"></span>
        <button class="mini" id="bt-merge" title="셀 병합 보기 토글(OFF=행별 편집)">${this.merge ? '⊟ 병합' : '⊞ 펼침'}</button>
        <button class="mini" id="bt-add">+ 행</button>
      </div>
      <div class="bt-wrap">
        <table class="bt-table">
          <thead><tr>
            <th>#</th><th>모드</th><th class="bt-th-phase">페이즈</th><th>거리</th><th>패턴</th>
            <th title="패턴 단위 쿨타임">쿨</th><th title="이 거리 이하로 가까워지면 취소">Incl</th>
            <th title="이 거리 이상 멀어지면 취소">Excl</th><th>설명</th><th></th>
          </tr></thead>
          <tbody id="bt-body"></tbody>
        </table>
      </div>`;
    this.el.querySelector('#bt-add').onclick = () => { this._rows().push(model.newBTRow()); this._mark(); this._body(); };
    this.el.querySelector('#bt-merge').onclick = () => { this.merge = !this.merge; this.render(); };
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
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="10" class="dim small" style="padding:8px">규칙 없음 — "+ 행" 추가</td></tr>`; return; }
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

    rows.forEach((r, i) => {
      const pat = e.patterns.find((p) => p.id === r.patternId);
      const cd = pat ? pat.cooldown : '-';
      const tr = document.createElement('tr');
      tr.className = 'bt-row mode-' + (r.mode === '공격' ? 'atk' : r.mode === '수비' ? 'def' : 'sp');
      let h = `<td class="bt-i">${i + 1}</td>`;
      if (mR[i]) h += mg(mR[i], sel(model.MODES, r.mode, 'mode'));
      if (showPhase && pR[i]) h += mg(pR[i], selIdx(phaseOpts, r.phaseIdx, 'phase'));
      if (bR[i]) h += mg(bR[i], selIdx(bandOpts, r.band, 'band'));
      h += `<td>${selPat(patOpts, pat ? pat.name : '(없음)', 'pat')}</td>`;
      h += `<td class="bt-cd">${cd}</td>`;
      h += `<td>${num(r.inclusive, 0.5, 'inc')}</td>`;
      h += `<td>${num(r.exclusive, 0.5, 'exc')}</td>`;
      h += `<td>${txt(r.desc, 'desc')}</td>`;
      h += `<td class="bt-act"><button class="mini" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="mini" data-a="dn" ${i === rows.length - 1 ? 'disabled' : ''}>↓</button><button class="mini del" data-a="del">×</button></td>`;
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
      tr.querySelector('[data-col="desc"]').oninput = (ev) => { r.desc = ev.target.value; this._mark(); };
      tr.querySelector('[data-a="up"]').onclick = () => this._move(i, -1);
      tr.querySelector('[data-a="dn"]').onclick = () => this._move(i, 1);
      tr.querySelector('[data-a="del"]').onclick = () => { rows.splice(i, 1); this._mark(); this._body(); };
      tb.appendChild(tr);
    });
  }
  _move(i, d) {
    const a = this._rows(); const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; this._mark(); this._body();
  }
}

const sel = (opts, v, col) => `<select data-col="${col}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
const selIdx = (opts, idx, col) => `<select data-col="${col}">${opts.map((o, i) => `<option ${i - 1 === idx ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const selPat = (opts, v, col) => `<select data-col="${col}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const num = (v, step, col) => `<input type="number" data-col="${col}" step="${step}" value="${v ?? 0}">`;
const txt = (v, col) => `<input class="bt-desc" data-col="${col}" value="${attr(v)}">`;
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const attr = (s) => String(s ?? '').replace(/"/g, '&quot;');
