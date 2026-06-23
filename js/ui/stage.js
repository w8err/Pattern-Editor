// ============================================================
//  ⑤ 플레이백 스테이지 — 캔버스 렌더 + 컨트롤
//  단일 패턴 미리보기(스크럽) / BT 루프(전진 재생) 토글.
//  더미 유저: 드래그 배치 + 웨이포인트 경로 이동.
// ============================================================
import * as sim from '../sim.js';
import { newUser } from '../model.js';

const TYPE_COLORS = {
  대기: '#6e7681', 추적: '#58a6ff', 공격: '#f85149', 걷기: '#3fb950',
  대쉬: '#bc8cff', 순간이동: '#22d3ee', 투사체: '#f0883e', 지형: '#d29922', 몸회전: '#79c0ff', 모드전환: '#7ee787', 음표카운터: '#ffd33d', 공격각도: '#f0883e', 회복: '#3fb950', 복합: '#db61a2', 종료: '#444',
};
const TERRAIN_COLORS = { 지진: '#d29922', 둔화: '#9aa0a6', 용암: '#f85149' };
const WEAPON_COLORS = ['#ffd33d', '#a371f7']; // 무기 인덱스별 색(0=1번/금, 1=2번/보라)

export class Playback {
  static MAX_BACKING = 820; // 캔버스 백킹 해상도 상한(px). 큰 창에서 GPU fill-rate 병목 방지.
  constructor({ canvas, controls, hud, scrub }) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.controls = controls; this.hud = hud; this.scrub = scrub;
    this.entity = null; this.pattern = null;
    this.mode = 'single';
    this.playing = false; this.speed = 1; this.t = 0; this.field = 20; // field = 맵 한 변(m)
    this.user = { x: 5, y: 0 }; this._hist = [];
    this.userAI = false; this._ai = null; this._users = []; this._userSel = ''; this._defaultUser = newUser(); // 유저 AI
    this.userManual = false; this._keys = {}; this._mouseW = null; // 유저 수동 조작(WASD·마우스 조준·스페이스 대쉬)
    this.onEditDefaultUser = null; // ✎ 버튼 → main이 인스펙터로 기본 유저 편집 연결
    this._weaponFx = null; // 무기 교체 이펙트
    this.repeatN = null; this._expCache = null; // 단일 모드 반복 펼치기 횟수/캐시
    this._singleNotes = 0; this._noteScanSingle = 0; // 단일 재생 중 누적 음표
    this.terrains = []; this.projWorld = []; this._clock = 0; this._scanT = 0; this._btScanT = 0; // 지속 지형/투사체(월드 객체)
    // BT 상태
    this.bt = null;
    this._raf = null; this._last = 0;
    this._buildControls();
    this._bindUserControls();
    this._bindCanvas();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.render();
  }

  setEntity(entity) {
    this.entity = entity; this.pattern = null; this.t = 0; this.pause();
    // 음표 시스템 사용 여부(패턴 어딘가에 음표카운터 이벤트 존재) / 이중 무기 여부
    this._usesNotes = !!entity && (entity.patterns || []).some(hasNoteEvent);
    this._hasDual = !!(entity && entity.weaponNames && Array.isArray(entity.bt2));
    this._resetBt(); this._resetWorld();
    this._refreshControls(); this.render();
  }
  // 활성 무기의 BT 행 (이중 무기 + 대금 선택 시 bt2)
  _activeBT() {
    if (this._hasDual && this.bt?.weapon === 1) return this.entity.bt2;
    return this.entity?.bt || [];
  }
  _weaponName() {
    if (!this._hasDual) return null;
    return this.entity.weaponNames[this.bt?.weapon || 0] || '?';
  }
  setPattern(p) {
    this.pattern = p; this.t = 0; this._expCache = null; this._resetWorld();
    if (this.mode === 'single') { this.pause(); this._refreshControls(); this.render(); }
  }
  // 단일 모드 반복 펼치기 횟수(미설정 시 repeat.max)
  _effRepeatN() {
    const rep = this.pattern?.repeat;
    return rep ? Math.max(1, this.repeatN ?? rep.max ?? 1) : 1;
  }
  // 단일 모드에서 실제 재생할 패턴(반복 있으면 N번 펼친 것). 키 기반 캐시.
  _singlePat() {
    const p = this.pattern; if (!p) return null;
    if (this.mode !== 'single' || !p.repeat) return p;
    const n = this._effRepeatN();
    const key = (p.id || '') + ':' + n + ':' + (p.events?.length || 0);
    if (!this._expCache || this._expCache.key !== key) this._expCache = { key, pat: sim.expandPattern(p, n) };
    return this._expCache.pat;
  }
  _resetWorld() { this._hist = []; this.terrains = []; this.projWorld = []; this._clock = 0; this._scanT = 0; this._btScanT = 0; this._singleNotes = 0; this._noteScanSingle = 0; this._weaponFx = null; }

  // ── 컨트롤 ──────────────────────────────────────
  _buildControls() {
    this.controls.innerHTML = `
      <div class="pb-row">
        <button class="seg on" data-mode="single">단일 패턴</button>
        <button class="seg" data-mode="bt">BT 루프</button>
        <span class="sp"></span>
        <button class="btn" id="pb-play">▶</button>
        <button class="btn" id="pb-reset">↺</button>
        <span class="dim" style="font-size:11px">속도</span>
        <button class="seg sp-btn" data-spd="0.5">0.5×</button>
        <button class="seg sp-btn on" data-spd="1">1×</button>
        <button class="seg sp-btn" data-spd="2">2×</button>
        <span class="sp"></span>
        <span class="dim" style="font-size:11px">맵</span>
        <select id="pb-field"><option>10</option><option selected>20</option><option>30</option></select>
        <span class="dim" style="font-size:11px">m²</span>
        <span id="pb-rep-wrap" style="display:none"><span class="sp"></span><span class="dim" style="font-size:11px">반복</span> <input id="pb-rep" type="number" min="1" value="1" style="width:44px"></span>
      </div>`;
    const C = this.controls;
    C.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => this._setMode(b.dataset.mode));
    C.querySelector('#pb-play').onclick = () => this.toggle();
    C.querySelector('#pb-reset').onclick = () => this.reset();
    C.querySelectorAll('[data-spd]').forEach((b) => b.onclick = () => {
      this.speed = +b.dataset.spd; C.querySelectorAll('.sp-btn').forEach((x) => x.classList.toggle('on', x === b));
    });
    C.querySelector('#pb-field').onchange = (e) => {
      this.field = +e.target.value; const h = this.field / 2;
      this.user.x = Math.max(-h, Math.min(h, this.user.x)); this.user.y = Math.max(-h, Math.min(h, this.user.y));
      this.resize(); this.render();
    };
    C.querySelector('#pb-rep').onchange = (e) => {
      let n = Math.max(1, Math.round(+e.target.value || 1));
      const max = this.pattern?.repeat?.max; if (max) n = Math.min(n, max);
      this.repeatN = n; e.target.value = n; this._expCache = null; this.t = 0;
      this.pause(); this._refreshControls(); this.render();
    };
    this.scrub.oninput = (e) => { this.t = +e.target.value; if (this.mode === 'single') this.render(); };
  }
  // 유저 데이터 컨트롤(사이드바). 토글식 — 같은 버튼 재클릭 시 끔. AI·수동 상호 배타.
  _bindUserControls() {
    const ai = document.querySelector('#btn-user-ai');
    const man = document.querySelector('#btn-user-manual');
    const edit = document.querySelector('#btn-user-edit');
    const sel = document.querySelector('#pb-userdef');
    this._uAiBtn = ai; this._uManBtn = man;
    if (ai) ai.onclick = () => this._setUserMode('ai');
    if (man) man.onclick = () => this._setUserMode('manual');
    if (edit) edit.onclick = () => this.onEditDefaultUser?.();
    if (sel) sel.onchange = (e) => { this._userSel = e.target.value; this._resetAI(); };
  }
  _setUserMode(mode) {
    if (mode === 'ai') { this.userAI = !this.userAI; this.userManual = false; }
    else if (mode === 'manual') { this.userManual = !this.userManual; this.userAI = false; }
    if (this.userAI || this.userManual) { this._keys = {}; this._resetAI(); }
    this._uAiBtn?.classList.toggle('on', this.userAI);
    this._uManBtn?.classList.toggle('on', this.userManual);
    this.render();
  }
  _refreshControls() {
    const dur = this._singlePat()?.duration || this.pattern?.duration || 1;
    this.scrub.max = dur; this.scrub.step = 0.01; this.scrub.value = this.t;
    this.scrub.disabled = this.mode !== 'single' || !this.pattern;
    // 반복 컨트롤: 단일 모드 + repeat 있는 패턴에서만 노출
    const wrap = this.controls.querySelector('#pb-rep-wrap');
    if (wrap) {
      const show = this.mode === 'single' && !!this.pattern?.repeat;
      wrap.style.display = show ? '' : 'none';
      if (show) { const inp = wrap.querySelector('#pb-rep'); inp.max = this.pattern.repeat.max || 99; inp.value = this._effRepeatN(); }
    }
  }
  _setMode(m) {
    this.mode = m; this.pause(); this.t = 0; this._resetBt(); this._resetWorld();
    this.controls.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    this._refreshControls(); this.render();
  }

  // ── 캔버스 좌표/입력 ────────────────────────────
  resize() {
    const wrap = this.canvas.parentElement;
    const css = Math.max(200, Math.min(wrap.clientWidth - 2, wrap.clientHeight - 2)); // 표시 크기(CSS px)
    // 백킹 해상도 상한: 창이 커도 GPU가 칠하는 픽셀 수를 묶어 fill-rate 병목 방지.
    // 표시는 CSS로 업스케일(약간의 블러 < 부드러움). css가 상한 이하면 1:1(블러 없음).
    const s = Math.min(css, Playback.MAX_BACKING);
    this.canvas.width = s; this.canvas.height = s;
    this.canvas.style.width = css + 'px'; this.canvas.style.height = css + 'px';
    this.scale = s / this.field; this.cx = s / 2; this.cy = s / 2;
  }
  w2s(x, y) { return [this.cx + x * this.scale, this.cy + y * this.scale]; }
  s2w(sx, sy) { return [(sx - this.cx) / this.scale, (sy - this.cy) / this.scale]; }
  _bindCanvas() {
    let drag = false;
    // 표시(CSS) px → 백킹 px 보정(백킹 해상도 상한 때문에 둘이 다를 수 있음)
    const pos = (e) => { const r = this.canvas.getBoundingClientRect(); const k = this.canvas.width / r.width; return this.s2w((e.clientX - r.left) * k, (e.clientY - r.top) * k); };
    const cl = (v) => { const h = this.field / 2; return Math.max(-h, Math.min(h, v)); }; // 유저도 맵 안으로
    this.canvas.addEventListener('mousedown', (e) => {
      const [wx, wy] = pos(e);
      if (this.userAI || this.userManual) return;  // AI·수동 모드면 드래그 배치 불가
      if (Math.hypot(wx - this.user.x, wy - this.user.y) < 1.2) drag = true;
    });
    window.addEventListener('mousemove', (e) => { if (drag) { const [wx, wy] = pos(e); this.user.x = cl(wx); this.user.y = cl(wy); this.render(); } });
    window.addEventListener('mouseup', () => drag = false);
    // 수동 조작: 마우스 위치로 조준(facing) · 캔버스 위에서만 추적
    this.canvas.addEventListener('mousemove', (e) => {
      const [wx, wy] = pos(e); this._mouseW = { x: wx, y: wy };
      if (this.userManual && !this.playing) this.render();
    });
    // 수동 조작: WASD 이동 + 스페이스 대쉬(입력 필드 포커스 중엔 무시)
    const isTyping = (t) => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
    const keyName = (e) => (e.key === ' ' ? ' ' : e.key.toLowerCase());
    window.addEventListener('keydown', (e) => {
      if (!this.userManual || isTyping(e.target)) return;
      const k = keyName(e);
      if ('wasd '.includes(k) && k.length) { this._keys[k] = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      const k = keyName(e);
      if ('wasd '.includes(k) && k.length) this._keys[k] = false;
    });
  }
  // gt = 전역 재생 시각. 재생 중이면 기록 보간(과거 시점 고정 → 재조준 방지), 아니면 라이브.
  _userAt(gt) {
    // 재생 중엔 기록(history) 보간 → "진입·발사 시점 고정" 유지(드리프트 방지)
    if (this.playing && this._hist.length) return this._histAt(gt);
    return { x: this.user.x, y: this.user.y };
  }
  // ── 유저 AI(컨텍스트 스티어링 + 위험맵 + 노이즈) ──
  setUsers(list) {
    this._users = list || [];
    const sel = document.querySelector('#pb-userdef'); if (!sel) return;
    const cur = this._userSel;
    sel.innerHTML = `<option value="">기본(하루)</option>` + this._users.map((u) => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('');
    if (this._users.some((u) => u.name === cur)) sel.value = cur; else { this._userSel = ''; sel.value = ''; }
  }
  _activeUserDef() {
    const u = this._users.find((x) => x.name === this._userSel);
    return u ? u.data : this._defaultUser;
  }
  // 기본 유저(하루) 스펙 교체 — main이 localStorage에서 로드/저장 후 주입
  setDefaultUser(data) { if (data) this._defaultUser = data; this.render(); }
  _resetAI() {
    const def = this._activeUserDef();
    const phases = []; for (let i = 0; i < 16; i++) phases.push(Math.random() * Math.PI * 2);
    this._ai = { stamina: def.maxStamina, exhausted: false, dashT: 0, invulnT: 0, dvx: 0, dvy: 0, phases };
  }
  _clampUser() { const h = this.field / 2; this.user.x = Math.max(-h, Math.min(h, this.user.x)); this.user.y = Math.max(-h, Math.min(h, this.user.y)); }
  _noiseAt(i) { return Math.sin(this._clock * this._activeUserDef().noiseDrift + this._ai.phases[i]); }
  _wallPen(x, y) { const h = this.field / 2; const m = Math.min(h - Math.abs(x), h - Math.abs(y)); return m < 1 ? (1 - m) : 0; }
  _interest(x, y, bs, def) { return -Math.abs(Math.hypot(bs.mx - x, bs.my - y) - def.basicRange); }
  // 현재 위협(임박 공격 + 월드 투사체) 수집
  _collectHazards(bs, pattern, localT, def) {
    const attacks = [];
    if (pattern) {
      const evs = [...(pattern.events || [])];
      for (const e of pattern.events || []) if (e.composite && e.sub) evs.push(...e.sub);
      for (const ev of evs) {
        if (ev.type !== '공격') continue;
        const lead = Math.max(ev.indicatorTime || 0, def.reactionTime);
        if (localT >= ev.time - lead && localT <= ev.time + 0.08) attacks.push({ ev, bs });
      }
    }
    return { attacks, projs: this.projWorld };
  }
  _dangerAt(x, y, hz) {
    let s = 0;
    for (const a of hz.attacks) { if (sim.attackGeom(a.ev, a.bs, { x, y }).hit) s += 1; }
    for (const p of hz.projs) for (const ft of [0.15, 0.35]) {
      const px = p.x + Math.cos(p.ang) * p.spd * ft, py = p.y + Math.sin(p.ang) * p.spd * ft;
      const dd = Math.hypot(px - x, py - y); if (dd < 0.9) s += (0.9 - dd);
    }
    return s;
  }
  _stepUserAI(dt, bs, pattern, localT) {
    if (!this._ai) this._resetAI();
    const ai = this._ai, u = this.user, def = this._activeUserDef();
    if (ai.invulnT > 0) ai.invulnT -= dt;
    const hz = this._collectHazards(bs, pattern, localT, def);
    const danger = (x, y) => this._dangerAt(x, y, hz);
    // 대시 진행 중: 관성 이동
    if (ai.dashT > 0) { ai.dashT -= dt; u.x += ai.dvx * dt; u.y += ai.dvy * dt; this._clampUser(); return; }
    // 스태미나 재생(대시 외)
    ai.stamina = Math.min(def.maxStamina, ai.stamina + def.staminaRegen * (ai.exhausted ? 2 : 1) * dt);
    if (ai.exhausted && ai.stamina >= def.maxStamina) ai.exhausted = false;
    // 1) 위급 회피: 현재 위치 위험하면 가장 안전한 방향으로 대시
    if (danger(u.x, u.y) > def.dodgeThresh && !ai.exhausted && ai.stamina >= def.dashStamina && Math.random() < def.dodgeChance) {
      let best = 0, bestS = Infinity;
      for (let i = 0; i < 16; i++) { const a = i / 16 * sim.TAU; const nx = u.x + Math.cos(a) * def.dashDist, ny = u.y + Math.sin(a) * def.dashDist; const s = danger(nx, ny) + this._wallPen(nx, ny); if (s < bestS) { bestS = s; best = a; } }
      ai.stamina -= def.dashStamina; if (ai.stamina <= 0) { ai.stamina = 0; ai.exhausted = true; }
      ai.dashT = def.dashDur; ai.invulnT = def.dashInvuln;
      const spd = def.dashDist / def.dashDur; ai.dvx = Math.cos(best) * spd; ai.dvy = Math.sin(best) * spd;
      u.x += ai.dvx * dt; u.y += ai.dvy * dt; this._clampUser(); return;
    }
    // 2) 컨텍스트 스티어링(거리유지 − 위험 − 벽 + 노이즈)
    let bestA = null, bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * sim.TAU, nx = u.x + Math.cos(a) * def.lookahead, ny = u.y + Math.sin(a) * def.lookahead;
      const score = def.wInterest * this._interest(nx, ny, bs, def) - def.wDanger * danger(nx, ny) - def.wWall * this._wallPen(nx, ny) + def.wNoise * this._noiseAt(i);
      if (score > bestScore) { bestScore = score; bestA = a; }
    }
    if (bestA != null) { u.x += Math.cos(bestA) * def.moveSpeed * dt; u.y += Math.sin(bestA) * def.moveSpeed * dt; }
    this._clampUser();
  }
  // ── 유저 수동 조작(WASD 이동 · 마우스 조준 · 스페이스 대쉬) ──
  //  스태미나/대쉬 무적은 AI와 동일한 _ai 상태·스펙(def)을 그대로 사용(현상유지).
  _stepUserManual(dt) {
    if (!this._ai) this._resetAI();
    const ai = this._ai, u = this.user, def = this._activeUserDef();
    if (ai.invulnT > 0) ai.invulnT -= dt;
    // 조준(facing) = 마우스 방향
    if (this._mouseW) u.facing = Math.atan2(this._mouseW.y - u.y, this._mouseW.x - u.x);
    // 대시 진행 중: 관성 이동(입력 무시)
    if (ai.dashT > 0) { ai.dashT -= dt; u.x += ai.dvx * dt; u.y += ai.dvy * dt; this._clampUser(); return; }
    // 스태미나 재생(대시 외) — AI와 동일
    ai.stamina = Math.min(def.maxStamina, ai.stamina + def.staminaRegen * (ai.exhausted ? 2 : 1) * dt);
    if (ai.exhausted && ai.stamina >= def.maxStamina) ai.exhausted = false;
    // WASD 이동 방향(화면 기준: +y가 아래 → W는 -y)
    let ix = 0, iy = 0;
    if (this._keys['w']) iy -= 1; if (this._keys['s']) iy += 1;
    if (this._keys['a']) ix -= 1; if (this._keys['d']) ix += 1;
    const len = Math.hypot(ix, iy);
    // 대시: 스페이스 — 이동 입력 방향(없으면 마우스 조준 방향)으로
    if (this._keys[' '] && !ai.exhausted && ai.stamina >= def.dashStamina) {
      const da = len > 1e-6 ? Math.atan2(iy, ix) : (u.facing ?? 0);
      ai.stamina -= def.dashStamina; if (ai.stamina <= 0) { ai.stamina = 0; ai.exhausted = true; }
      ai.dashT = def.dashDur; ai.invulnT = def.dashInvuln;
      const spd = def.dashDist / def.dashDur; ai.dvx = Math.cos(da) * spd; ai.dvy = Math.sin(da) * spd;
      this._keys[' '] = false;  // 한 번 누름 = 대시 1회(떼었다 다시 눌러야 재발동)
      u.x += ai.dvx * dt; u.y += ai.dvy * dt; this._clampUser(); return;
    }
    // 일반 이동
    if (len > 1e-6) { u.x += ix / len * def.moveSpeed * dt; u.y += iy / len * def.moveSpeed * dt; }
    this._clampUser();
  }
  _histAt(gt) {
    const h = this._hist;
    if (gt >= h[h.length - 1].t) return { x: this.user.x, y: this.user.y };
    if (gt <= h[0].t) return { x: h[0].x, y: h[0].y };
    let lo = 0, hi = h.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (h[m].t <= gt) lo = m; else hi = m; }
    const a = h[lo], b = h[hi], f = (b.t - a.t) ? (gt - a.t) / (b.t - a.t) : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  // 패턴-로컬 시각 τ → 전역 시각 매핑한 유저 조회 함수
  _userFn(localT) { const base = this._clock - localT; return (τ) => this._userAt(base + τ); }

  // ── 재생 루프 ───────────────────────────────────
  toggle() { this.playing ? this.pause() : this.play(); }
  play() {
    if (this.mode === 'single' && !this.pattern) return;
    if (this.mode === 'bt' && !this.entity?.bt?.length) return;
    this.playing = true; this.controls.querySelector('#pb-play').textContent = '⏸';
    this._last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      // ── 계측: rAF 간격(frame) / sim / render ms (EMA). _perf로 HUD 표시 ──
      const frameMs = this._perfLast ? now - this._perfLast : 16.7; this._perfLast = now;
      const wt0 = performance.now();
      const dt = Math.min(0.05, (now - this._last) / 1000) * this.speed; this._last = now;
      this._clock += dt;
      this._hist.push({ t: this._clock, x: this.user.x, y: this.user.y }); // 전역 시각 기준 유저 기록
      // 청크 트림: shift()(O(n)) 매 프레임 대신 가끔 한 덩어리 제거(amortized O(1)). 최근 ~16s 유지로 충분.
      if (this._hist.length > 1600) this._hist.splice(0, 600);
      this._updateProjWorld(dt); // 월드 투사체 선회+직진 적분

      if (this.mode === 'single') {
        const sp = this._singlePat();
        this.t += dt; const dur = sp.duration || 1;
        if (this.t >= dur) { this.t -= dur; this._scanT = 0; this._noteScanSingle = 0; } // 루프: 스캔만 초기화(음표 누적은 유지)
        this.scrub.value = this.t;
        // 지속 지형 스폰(이번 프레임에 새로 발동한 지형). 같은 시뮬 결과를 render가 재사용(이중 시뮬 제거).
        const snap = sim.simulateUpTo(sp, Math.max(1e-4, this.t), { user: this._userFn(this.t), rotationSpeed: this.entity?.rotationSpeed ?? 360, mapSize: this.field, size: this.entity?.size });
        this._singleSnap = snap; this._singleSnapT = this.t;
        for (const f of snap.fires) if (f.time > this._scanT && f.time <= this.t) {
          if (f.type === '지형') this._spawnTerrain(f);
          else if (f.type === '투사체') this._spawnProjectiles(f);
        }
        // 음표 누적(머리 위 표시용) — 루프 반복마다 쌓여 5에서 멈춤
        for (const f of snap.fires) if (f.type === '음표카운터' && f.time > this._noteScanSingle && f.time <= this.t)
          this._singleNotes = Math.max(0, Math.min(sim.NOTE_MAX, this._singleNotes + (f.amount || 1)));
        this._noteScanSingle = this.t; this._scanT = this.t;
        if (this.userAI) this._stepUserAI(dt, snap.state, sp, this.t);
        else if (this.userManual) this._stepUserManual(dt);
      } else {
        this._stepBt(dt);
        if (this.userAI) this._stepUserAI(dt, this.bt.state, this.bt.cur, this.bt.localT);
        else if (this.userManual) this._stepUserManual(dt);
      }
      const wt1 = performance.now();
      this.render();
      const wt2 = performance.now();
      // EMA(0.1) 누적
      const p = this._perf || (this._perf = { frame: 16.7, sim: 0, render: 0, work: 0 });
      p.frame += (frameMs - p.frame) * 0.1;
      p.sim += ((wt1 - wt0) - p.sim) * 0.1;
      p.render += ((wt2 - wt1) - p.render) * 0.1;
      p.work += ((wt2 - wt0) - p.work) * 0.1;
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  pause() { this.playing = false; if (this._raf) cancelAnimationFrame(this._raf); this.controls?.querySelector('#pb-play') && (this.controls.querySelector('#pb-play').textContent = '▶'); }
  reset() { this.t = 0; this._resetBt(); this._resetWorld(); if (this.userAI) this._resetAI(); this.scrub.value = 0; this.render(); }
  _spawnTerrain(f) { const d = this._terrDef(f.ev); this.terrains.push({ pts: f.pts, terrain: d.terrain, size: d.size || 4, duration: d.duration || 4, born: this._clock }); }
  // 투사체를 월드 객체로 스폰(패턴 전환·종료와 무관하게 lifetime까지 유지). 각 발의 방향을 발사 시점에 확정.
  _spawnProjectiles(f) {
    const pd = this._projDef(f.ev);
    const spd = pd.speed || 10, turn = (pd.homing || 0) / 100 * Math.PI * 2, life = pd.lifetime || 2; // 호밍100%=360°/s 선회
    const custom = f.ev.dir === '커스텀' && f.ev.customSpawns?.length ? f.ev.customSpawns : null;
    const burst = f.burstK != null, n = burst ? 1 : (f.ev.count || 1);
    for (let k = 0; k < n; k++) {
      const kk = burst ? f.burstK : k;
      const c = custom ? custom[kk % custom.length] : null;
      const ox = f.x + (c ? c.x : 0), oy = f.y + (c ? c.y : 0);
      const ang = c ? c.angle
        : f.ev.dir === '랜덤360' ? sim.seeded(f.ev.id, kk + 1) * sim.TAU
        : f.ev.dir === '균일360' ? f.dir + (kk / n) * sim.TAU
        : f.ev.dir === '공격각도내 랜덤' ? (f.cone ? f.cone.axis + (sim.seeded(f.ev.id, kk + 1) - 0.5) * f.cone.widthRad : f.dir)
        : f.dir + (k - (n - 1) / 2) * 0.12;
      this.projWorld.push({ x: ox, y: oy, ang, spd, turn, life, born: this._clock });
    }
  }
  // 매 프레임 적분: 진행 방향(ang)만 유저로 선회(turn rad/s)하며 자기 속도로 직진. 좌표를 끌어당기지 않음.
  _updateProjWorld(dt) {
    const u = this._userAt(this._clock);
    for (const p of this.projWorld) {
      if (p.turn > 0) { const des = Math.atan2(u.y - p.y, u.x - p.x); p.ang = sim.rotToward(p.ang, des, p.turn * dt); }
      p.x += Math.cos(p.ang) * p.spd * dt; p.y += Math.sin(p.ang) * p.spd * dt;
    }
    this.projWorld = this.projWorld.filter((p) => this._clock - p.born <= p.life);
  }
  // 월드 투사체 렌더(재생 중) — 적분된 현재 위치 사용
  _drawProjWorld() {
    if (!this.playing) return;
    const x = this.ctx;
    for (const p of this.projWorld) {
      const [sx, sy] = this.w2s(p.x, p.y);
      x.fillStyle = '#f0883e'; x.beginPath(); x.arc(sx, sy, 4, 0, sim.TAU); x.fill();
    }
  }
  // 스크럽 미리보기용: 정지(고정 유저) 상태에서 발사~age 까지 선회 적분한 위치
  _steerPath(ox, oy, ang, spd, turn, age) {
    const u = this._userAt(this._clock); let x = ox, y = oy, a = ang; const dt = 1 / 60;
    for (let t = 0; t < age - 1e-6; t += dt) {
      const step = Math.min(dt, age - t);
      if (turn > 0) { const des = Math.atan2(u.y - y, u.x - x); a = sim.rotToward(a, des, turn * step); }
      x += Math.cos(a) * spd * step; y += Math.sin(a) * spd * step;
    }
    return { x, y };
  }
  // 이벤트의 defId → 엔티티 정의 해석(없으면 인라인 fallback)
  _projDef(ev) { return (this.entity?.projectiles || []).find((p) => p.id === ev.defId) || ev; }
  _terrDef(ev) { return (this.entity?.terrains || []).find((t) => t.id === ev.defId) || ev; }

  // ── BT 루프 ─────────────────────────────────────
  _resetBt() {
    this.bt = {
      mode: '수비', phaseIdx: 0, cd: {}, cur: null, localT: 0, clock: 0,
      state: { mx: 0, my: 0, facing: 0 },
      notes: 0,      // 음표 카운터(보스 머리 위)
      weapon: 0,     // 0=1번 무기(bt) · 1=2번 무기(bt2)
      loops: 0, repeatDone: false, noteScan: 0,
    };
  }
  _stepBt(dt) {
    const b = this.bt, e = this.entity;            // 전역시각 = this._clock (tick에서 이미 +dt)
    for (const k in b.cd) b.cd[k] = Math.max(0, b.cd[k] - dt);
    const cur = this._userAt(this._clock);          // 현재(라이브) 유저 — 거리/선택용
    const d = Math.hypot(b.state.mx - cur.x, b.state.my - cur.y);
    if (!b.cur) {
      const row = sim.pickPattern(e, {
        mode: b.mode, phaseIdx: b.phaseIdx, distance: d, cd: b.cd,
        bt: this._activeBT(), notes: b.notes, usesNotes: this._usesNotes,
        pos: { x: b.state.mx, y: b.state.my }, user: cur, lim: this.field / 2 - (e.size || 0), // 벽 판정
      });
      const p = row && e.patterns.find((x) => x.id === row.patternId);
      if (!p) return;                    // 후보 없음 → 대기
      b.cur = p; b.curRow = row; b.localT = 0; this._btScanT = 0;
      b.loops = 0; b.repeatDone = false; b.noteScan = 0;
      b.switches = sim.modeSwitches(p); b.applied = new Set(); b.explicitMode = false;
      // 음표 소모는 특수 패턴 안의 음표카운터(−amount) 이벤트가 처리(예: 0.5s에 −5).
      // 누락 대비 안전망은 특수 종료 시점에서 처리.
    }
    b.localT += dt;
    // 모드전환 이벤트: 해당 시간 지나면 모드 변경(자동 교대 대신)
    for (const sw of b.switches) {
      if (b.localT >= sw.time && !b.applied.has(sw)) { b.mode = sim.resolveMode(sw.toMode, b.mode); b.applied.add(sw); b.explicitMode = true; }
    }
    const r = sim.simulateUpTo(b.cur, Math.min(b.localT, b.cur.duration), { user: this._userFn(b.localT), rotationSpeed: e.rotationSpeed, init: b.state, mapSize: this.field, size: e.size });
    this._btSnapshot = { ...r, pattern: b.cur };
    // 지속 지형/투사체 스폰(패턴 전환·반복과 무관하게 월드에 유지)
    for (const f of r.fires) if (f.time > this._btScanT && f.time <= b.localT) {
      if (f.type === '지형') this._spawnTerrain(f);
      else if (f.type === '투사체') this._spawnProjectiles(f);
    }
    this._btScanT = b.localT;
    // 음표 카운터 스캔(이번 프레임에 새로 도달한 음표 이벤트). 음수 amount면 소모. 0 미만 방지.
    for (const f of r.fires) if (f.type === '음표카운터' && f.time > b.noteScan && f.time <= b.localT) b.notes = Math.max(0, b.notes + (f.amount || 1));
    b.noteScan = b.localT;

    // 하드코딩 반복: repeat.segEnd 도달 시 (거리 조건 + 벽으로 막히지 않음) 이면 구간 재실행.
    //  max = 총 시전 횟수(초기 1회 포함). 벽 때문에 대쉬 불가하면 즉시 중단.
    const rep = b.cur.repeat;
    if (rep && rep.segEnd && !b.repeatDone && b.localT >= rep.segEnd) {
      const bandIdx = sim.bandFor(e, d);
      const feasNow = sim.patternFeasible(b.cur, { pos: { x: r.state.mx, y: r.state.my }, user: cur, lim: this.field / 2 - (e.size || 0) });
      if (b.loops < (rep.max ?? 1) - 1 && bandIdx <= (rep.maxBand ?? 99) && feasNow) {
        b.state = r.state;                 // 이동 누적 후 구간 처음부터 다시
        b.localT = 0; b.loops++; this._btScanT = 0; b.noteScan = 0;
        b.applied = new Set();
        return;                            // 이번 프레임 완료 처리 스킵
      }
      b.repeatDone = true;                  // 조건 불충족(거리/벽/횟수) → 잔여 구간 진행 후 종료
    }

    // 취소 조건: 현재 거리 d 가 BT 행의 [inclusive, exclusive] 를 벗어나면 패턴 중단(특수는 예외)
    const row = b.curRow;
    const cancel = row && row.mode !== '특수' && (d <= row.inclusive || d >= row.exclusive);
    if (b.localT >= b.cur.duration || cancel) {
      b.state = r.state;                       // 누적 위치 유지
      b.cd[b.cur.id] = b.cur.cooldown || 0;     // 패턴 쿨 시작
      const wasSpecial = b.curRow?.mode === '특수';
      // 안전망: 특수가 끝났는데 음표가 여전히 가득(소모 이벤트 누락)이면 강제 소모
      if (wasSpecial && this._usesNotes && b.notes >= sim.NOTE_MAX) b.notes -= sim.NOTE_MAX;
      // 특수 패턴 종료 후 자동 무기 교체(이중 무기일 때) + 교체 이펙트
      if (wasSpecial && this._hasDual) { b.weapon = 1 - b.weapon; b.mode = '수비'; this._weaponFx = { born: this._clock, name: this._weaponName(), w: b.weapon }; }
      // 명시적 모드전환이 있었으면 자동 교대 안 함. 특수도 교대 안 함.
      else if (!b.explicitMode && !wasSpecial) b.mode = b.mode === '공격' ? '수비' : '공격';
      b.cur = null; b.curRow = null;
    }
  }

  // ── 렌더 ────────────────────────────────────────
  render() {
    const x = this.ctx; if (!x) return;
    const S = this.canvas.width;
    x.clearRect(0, 0, S, S); x.fillStyle = '#0b0f14'; x.fillRect(0, 0, S, S);
    this._grid();
    this._walls();
    let state, fires, activeType, patt;
    const localT = this.mode === 'single' ? this.t : (this.bt?.localT || 0);
    this._uf = this._userFn(localT);  // 이번 프레임 유저 조회(패턴-로컬→전역 매핑)
    if (this.mode === 'single' && this.pattern) {
      const sp = this._singlePat();
      // 재생 중엔 tick이 같은 t로 이미 시뮬한 결과를 재사용. 정지(스크럽)/t 불일치 시에만 새로 시뮬.
      const r = (this.playing && this._singleSnap && this._singleSnapT === this.t)
        ? this._singleSnap
        : sim.simulateUpTo(sp, Math.max(0.0001, this.t), { user: this._uf, rotationSpeed: this.entity?.rotationSpeed ?? 360, mapSize: this.field, size: this.entity?.size });
      state = r.state; fires = r.fires; activeType = r.activeType; patt = sp;
    } else if (this.mode === 'bt' && this._btSnapshot) {
      state = this._btSnapshot.state; fires = this._btSnapshot.fires; activeType = this._btSnapshot.activeType; patt = this._btSnapshot.pattern;
    } else { state = { mx: 0, my: 0, facing: 0 }; fires = []; }
    this._bands(state);
    this._drawTerrains();   // 지속 지형(월드 장판)
    this._drawProjWorld();  // 지속 투사체(월드 객체)
    this._coneFan(fires, localT, state);   // 공격각도 부채꼴(투사체 아래)
    this._fires(fires, localT, state);
    this._indicators(state, patt);
    this._monster(state);
    this._drawWeaponFx(state);
    // 음표 카운터: BT=누적 상태 / 단일=재생 중 누적(_singleNotes) · 스크럽 중엔 현재 시각까지의 합
    const noteCount = this.mode === 'bt'
      ? (this.bt?.notes || 0)
      : (this.playing ? this._singleNotes
        : (fires || []).filter((f) => f.type === '음표카운터' && f.time <= localT).reduce((s, f) => s + (f.amount || 1), 0));
    this._noteShown = noteCount;
    this._notes(state, noteCount);
    this._user();
    this._hud(state, activeType, patt);
    // _refreshControls()는 상태 변경 핸들러에서만 호출(매 프레임 DOM 쓰기 제거).
  }
  // 보스 머리 위 음표 카운터(왼→오 정렬, NOTE_MAX 도달 시 강조)
  _notes(st, count) {
    if (!count || !this._usesNotes) return;
    const x = this.ctx; const r = (this.entity?.size || 0.6) * this.scale;
    const [mx, my] = this.w2s(st.mx, st.my);
    const top = my - Math.max(8, r) - 12;
    // 왼쪽 정렬: 첫 음표를 보스 왼쪽 가장자리에 고정, 오른쪽으로 추가
    const gap = 13, x0 = mx - Math.max(8, r);
    const full = count >= sim.NOTE_MAX;
    x.textAlign = 'left'; x.font = 'bold 14px sans-serif';
    for (let i = 0; i < count; i++) {
      x.fillStyle = full ? '#ffd33d' : '#c9a227';
      x.fillText('♪', x0 + i * gap, top);
    }
    x.textAlign = 'start';
  }
  // 공격각도: 현재 시각 기준 직전에 확정된 부채꼴을 보스에서 반투명 표시
  _coneFan(fires, tNow, st) {
    let cone = null;
    for (const f of fires) if (f.type === '공격각도' && f.time <= tNow + 1e-9) cone = f; // 최신
    if (!cone) return;
    const x = this.ctx; const [sx, sy] = this.w2s(st.mx, st.my);
    const reach = Math.max(this.field, 12) * this.scale; // 화면 밖까지 충분히
    const a0 = cone.axis - cone.widthRad / 2, a1 = cone.axis + cone.widthRad / 2;
    x.save();
    x.fillStyle = 'rgba(240,136,62,0.12)'; x.strokeStyle = 'rgba(240,136,62,0.55)'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(sx, sy);
    x.arc(sx, sy, reach, a0, a1); x.closePath(); x.fill(); x.stroke();
    // 중심축 점선
    x.setLineDash([5, 4]); x.strokeStyle = 'rgba(240,136,62,0.5)';
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(cone.axis) * reach, sy + Math.sin(cone.axis) * reach); x.stroke();
    x.restore();
  }
  // 맵 경계(벽) — 맵은 원점 중심 field×field. 가장자리에 벽 테두리.
  _walls() {
    const x = this.ctx; const S = this.canvas.width;
    x.save(); x.strokeStyle = '#6e7681'; x.lineWidth = 3;
    x.strokeRect(1.5, 1.5, S - 3, S - 3);
    x.restore();
  }
  _grid() {
    const x = this.ctx; x.strokeStyle = '#161b22'; x.lineWidth = 1;
    for (let m = -this.field; m <= this.field; m++) {
      const [sx] = this.w2s(m, 0), [, sy] = this.w2s(0, m);
      x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, this.canvas.height); x.stroke();
      x.beginPath(); x.moveTo(0, sy); x.lineTo(this.canvas.width, sy); x.stroke();
    }
  }
  _bands(st) {
    const x = this.ctx; const e = this.entity; if (!e) return;
    const [mx, my] = this.w2s(st.mx, st.my);
    x.save(); x.setLineDash([4, 4]);
    for (const b of e.distanceBands) {
      x.strokeStyle = '#30363d88'; x.beginPath(); x.arc(mx, my, b.max * this.scale, 0, sim.TAU); x.stroke();
      x.fillStyle = '#8b949e'; x.font = '10px sans-serif';
      x.fillText(b.name, mx + b.max * this.scale * 0.7, my - b.max * this.scale * 0.7);
    }
    x.restore();
  }
  _fires(fires, tNow, st) {
    const x = this.ctx;
    for (const f of fires) {
      const age = tNow - f.time;
      if (f.type === '공격') {
        if (age < 0 || age > 0.18) continue; // 타격 순간 플래시
        const a = 1 - age / 0.18; this._drawAttack(f.geom, `rgba(248,81,73,${a})`, true);
        const up = this._uf(f.time); const [ux, uy] = this.w2s(up.x, up.y);
        x.fillStyle = f.geom.hit ? '#f85149' : '#8b949e'; x.font = 'bold 12px sans-serif';
        x.fillText(f.geom.hit ? 'HIT' : 'MISS', ux + 8, uy - 8);
      } else if (f.type === '투사체' && !this.playing) {
        // 재생 중엔 월드 투사체(_drawProjWorld)가 그림. 스크럽(정지)에서만 패턴-로컬 미리보기.
        const pd = this._projDef(f.ev);
        if (age < 0) continue; const life = pd.lifetime || 2; if (age > life) continue;
        const spd = pd.speed || 10, turn = (pd.homing || 0) / 100 * Math.PI * 2;
        const custom = f.ev.dir === '커스텀' && f.ev.customSpawns?.length ? f.ev.customSpawns : null;
        // 연사(burst)는 fire 1개=투사체 1발(seed는 burstK). 아니면 count발을 한 번에.
        const burst = f.burstK != null;
        const n = burst ? 1 : (f.ev.count || 1);
        for (let k = 0; k < n; k++) {
          const kk = burst ? f.burstK : k;            // 난수 시드 인덱스
          const c = custom ? custom[kk % custom.length] : null;
          const ox = f.x + (c ? c.x : 0), oy = f.y + (c ? c.y : 0);
          const ang = c ? c.angle
            : f.ev.dir === '랜덤360' ? sim.seeded(f.ev.id, kk + 1) * sim.TAU
            : f.ev.dir === '균일360' ? f.dir + (kk / n) * sim.TAU
            : f.ev.dir === '공격각도내 랜덤' ? (f.cone ? f.cone.axis + (sim.seeded(f.ev.id, kk + 1) - 0.5) * f.cone.widthRad : f.dir)
            : f.dir + (k - (n - 1) / 2) * 0.12;
          const p = this._steerPath(ox, oy, ang, spd, turn, age); // 선회 적분(정지=고정 유저)
          const [sx, sy] = this.w2s(p.x, p.y);
          x.fillStyle = '#f0883e'; x.beginPath(); x.arc(sx, sy, 4, 0, sim.TAU); x.fill();
        }
      } else if (f.type === '순간이동') {
        if (age < 0 || age > 0.4) continue; const a = 1 - age / 0.4;
        const [sx, sy] = this.w2s(f.x, f.y);
        x.strokeStyle = `rgba(34,211,238,${a})`; x.lineWidth = 2;
        x.beginPath(); x.arc(sx, sy, (0.3 + age * 6) * this.scale, 0, sim.TAU); x.stroke();
      } else if (f.type === '지형' && !this.playing) {
        // 재생 중이 아닐 때(스크럽)만 패턴 타임라인 기준으로 표시. 재생은 지속 지형(_drawTerrains) 사용.
        const td = this._terrDef(f.ev);
        const dur = td.duration || 4, rad = (td.size || 4) / 2;
        if (age < 0 || age > dur) continue;
        this._terrainCircle(f.pts, td.terrain, rad, 0.25 + 0.45 * (1 - age / dur));
      } else if (f.type === '회복') {
        if (age < 0 || age > 0.8) continue; const a = 1 - age / 0.8;
        const [sx, sy] = this.w2s(f.x, f.y);
        x.strokeStyle = `rgba(63,185,80,${a})`; x.lineWidth = 2;
        x.beginPath(); x.arc(sx, sy, (0.4 + age * 5) * this.scale, 0, sim.TAU); x.stroke();
        x.fillStyle = `rgba(63,185,80,${a})`; x.font = 'bold 13px sans-serif'; x.textAlign = 'center';
        x.fillText(`+${f.amount} 회복`, sx, sy - (0.4 + age * 5) * this.scale - 4);
        x.textAlign = 'start';
      }
    }
  }
  // 지속 지형(월드 장판) — _clock 기준 수명, 패턴 전환/루프와 무관하게 유지
  _drawTerrains() {
    if (!this.playing) return;
    this.terrains = this.terrains.filter((t) => this._clock - t.born <= t.duration);
    for (const t of this.terrains) {
      const a = 0.2 + 0.45 * (1 - (this._clock - t.born) / t.duration);
      this._terrainCircle(t.pts, t.terrain, t.size / 2, a);
    }
  }
  _terrainCircle(pts, terrain, rad, a) {
    const x = this.ctx, col = TERRAIN_COLORS[terrain] || '#888';
    for (const p of pts) {
      const [sx, sy] = this.w2s(p.x, p.y);
      x.fillStyle = col + Math.round(Math.max(0, Math.min(1, a)) * 120).toString(16).padStart(2, '0');
      x.beginPath(); x.arc(sx, sy, rad * this.scale, 0, sim.TAU); x.fill();
      x.strokeStyle = col + '99'; x.beginPath(); x.arc(sx, sy, rad * this.scale, 0, sim.TAU); x.stroke();
    }
  }
  _drawAttack(g, color, fill) {
    const x = this.ctx; x.save(); x.strokeStyle = color; x.fillStyle = color.replace(/[\d.]+\)$/, '0.18)'); x.lineWidth = 2;
    if (g.kind === 'circle') { const [sx, sy] = this.w2s(g.x, g.y); x.beginPath(); x.arc(sx, sy, g.r * this.scale, 0, sim.TAU); fill && x.fill(); x.stroke(); }
    else if (g.kind === 'rect') {
      const [sx, sy] = this.w2s(g.x, g.y); x.translate(sx, sy); x.rotate(g.face);
      x.beginPath(); x.rect(0, -g.wid / 2 * this.scale, g.len * this.scale, g.wid * this.scale); fill && x.fill(); x.stroke();
    } else if (g.kind === 'all') { x.fillStyle = color.replace(/[\d.]+\)$/, '0.10)'); x.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    x.restore();
  }
  _indicators(st, patt) {
    if (!patt) return; const x = this.ctx; const t = this.mode === 'single' ? this.t : (this.bt?.localT || 0);
    const all = [...patt.events, ...patt.events.filter((e) => e.composite).flatMap((e) => e.sub || [])];
    for (const ev of all) {
      if (ev.type !== '공격' || !ev.indicator) continue;
      const start = ev.time - (ev.indicatorTime || 0);
      if (t < start || t > ev.time) continue;
      const k = (t - start) / Math.max(0.01, ev.indicatorTime || 0.01);
      this._drawAttack(sim.attackGeom(ev, st, this._uf(t)), `rgba(248,81,73,${0.25 + 0.6 * k})`, false);
    }
  }
  _monster(st) {
    const x = this.ctx; const [sx, sy] = this.w2s(st.mx, st.my); const r = (this.entity?.size || 0.6) * this.scale; const rr = Math.max(6, r);
    // 무기 상태: BT + 이중 무기일 때 무기색 굵은 링 + 이름표
    if (this.mode === 'bt' && this._hasDual) {
      const wc = WEAPON_COLORS[this.bt?.weapon || 0] || '#fff';
      x.strokeStyle = wc; x.lineWidth = 3.5; x.beginPath(); x.arc(sx, sy, rr + 4, 0, sim.TAU); x.stroke();
      x.fillStyle = wc; x.font = 'bold 11px sans-serif'; x.textAlign = 'center';
      x.fillText(this._weaponName(), sx, sy + rr + 16); x.textAlign = 'start';
    }
    x.fillStyle = this.entity?.kind === 'boss' ? '#f0883e' : '#3fb950';
    x.beginPath(); x.arc(sx, sy, rr, 0, sim.TAU); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(st.facing) * Math.max(8, r), sy + Math.sin(st.facing) * Math.max(8, r)); x.stroke();
  }
  // 무기 교체 순간 플래시(확장 링 + 텍스트)
  _drawWeaponFx(st) {
    const fx = this._weaponFx; if (!fx) return;
    const age = this._clock - fx.born; if (age < 0 || age > 0.9) { if (age > 0.9) this._weaponFx = null; return; }
    const x = this.ctx; const [sx, sy] = this.w2s(st.mx, st.my); const a = 1 - age / 0.9; const wc = WEAPON_COLORS[fx.w] || '#fff';
    x.save();
    x.strokeStyle = wc; x.globalAlpha = a; x.lineWidth = 3;
    x.beginPath(); x.arc(sx, sy, (0.6 + age * 9) * this.scale, 0, sim.TAU); x.stroke();
    x.globalAlpha = 1; x.fillStyle = wc; x.font = 'bold 16px sans-serif'; x.textAlign = 'center';
    x.fillText(`⚔ ${fx.name}`, sx, sy - (this.entity?.size || 0.6) * this.scale - 28);
    x.textAlign = 'start'; x.restore();
  }
  _user() {
    const x = this.ctx; const u = this._userAt(this._clock);
    const [sx, sy] = this.w2s(u.x, u.y);
    // 무적(대시) 표시: 흰 링
    if ((this.userAI || this.userManual) && this._ai?.invulnT > 0) { x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(sx, sy, 10, 0, sim.TAU); x.stroke(); }
    // 수동 조작: 마우스 조준 방향 표시
    if (this.userManual && this.user.facing != null) {
      x.strokeStyle = '#ffd33d'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(this.user.facing) * 15, sy + Math.sin(this.user.facing) * 15); x.stroke();
    }
    x.fillStyle = '#ffd33d'; x.beginPath(); x.arc(sx, sy, 7, 0, sim.TAU); x.fill();
    x.strokeStyle = '#0b0f14'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#ffd33d'; x.font = '9px sans-serif';
    x.fillText(this.userManual ? '유저(조작)' : this.userAI ? '유저(AI)' : '유저', sx + 9, sy + 3);
    // 스태미나 바(AI·수동 공통)
    if ((this.userAI || this.userManual) && this._ai) {
      const def = this._activeUserDef(), w = 22, r = this._ai.stamina / def.maxStamina;
      x.fillStyle = '#30363d'; x.fillRect(sx - w / 2, sy - 16, w, 3);
      x.fillStyle = this._ai.exhausted ? '#f85149' : '#3fb950'; x.fillRect(sx - w / 2, sy - 16, w * r, 3);
    }
  }
  _hud(st, activeType, patt) {
    if (!this.hud) return;
    // 재생 중엔 HUD 텍스트를 ~15Hz로만 갱신(innerHTML 재파싱=레이아웃/페인트 비용 분리). 캔버스는 60Hz 유지.
    if (this.playing) { const now = performance.now(); if (now - (this._hudLast || 0) < 66) return; this._hudLast = now; }
    const u = this._userAt(this._clock);
    const d = Math.hypot(st.mx - u.x, st.my - u.y).toFixed(1);
    const col = TYPE_COLORS[activeType] || '#8b949e';
    const tShow = (this.mode === 'single' ? this.t : (this.bt?.localT || 0)).toFixed(2);
    this.hud.innerHTML = `
      <span class="hud-t">⏱ ${tShow}s</span>
      <span>거리 <b>${d}m</b></span>
      ${patt ? `<span>패턴 <b>${esc(patt.name)}</b></span>` : ''}
      ${activeType ? `<span style="color:${col}">● ${activeType}</span>` : ''}
      ${this.mode === 'bt' ? `<span>모드 <b>${this.bt?.mode || '-'}</b></span>` : ''}
      ${this.mode === 'bt' && this._hasDual ? `<span>무기 <b>${esc(this._weaponName())}</b></span>` : ''}
      ${this._usesNotes ? `<span>음표 <b style="color:${(this._noteShown || 0) >= sim.NOTE_MAX ? '#ffd33d' : '#c9a227'}">${this._noteShown || 0}</b>/${sim.NOTE_MAX}</span>` : ''}
      ${this.playing && this._perf ? `<span style="color:${this._perf.frame > 20 ? '#f85149' : '#3fb950'}">⚡ ${(1000 / this._perf.frame).toFixed(0)}fps · 작업${this._perf.work.toFixed(1)}ms (sim${this._perf.sim.toFixed(1)}/그림${this._perf.render.toFixed(1)})</span>` : ''}`;
  }
}
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// 패턴(복합 하위 포함)에 음표카운터 이벤트가 있는지
function hasNoteEvent(p) {
  return (p.events || []).some((e) => e.type === '음표카운터'
    || (e.composite && (e.sub || []).some((s) => s.type === '음표카운터')));
}
