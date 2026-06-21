// ============================================================
//  시뮬레이션 코어 (순수 로직 — 캔버스 비의존, 헤드리스 검증 가능)
//  이벤트 타임라인을 시간축으로 해석해 몬스터 상태/발생물(fire)을 계산.
//  · 이벤트.time = "이 시간까지 완료" → 이벤트 i는 (prev.time, e.time] 구간 점유.
//  · 공격/투사체/지형 = 순간 발생(fire). 걷기/대쉬/추적/몸회전 = 구간 이동.
//  · 복합 하위의 공격/투사체/지형은 글로벌 시간에 병렬 발생(이동 효과는 v1 생략).
// ============================================================

export const TAU = Math.PI * 2;
export const norm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export function rotToward(cur, target, maxStep) {
  const d = norm(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
// 문자열 시드 → 0~1 의사난수(재시뮬 시 안정적)
export function seeded(str, i = 0) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

const INSTANT = new Set(['공격', '투사체', '지형']);

// fire 이벤트 목록(복합 하위 포함) 평탄화 → [{ev, time, burstK?}]
// 투사체 interval>0 & count>1 이면 count발을 간격마다 연사(마지막 발이 ev.time).
function fireEvents(pattern) {
  const out = [];
  const add = (e) => {
    if (!INSTANT.has(e.type)) return;
    if (e.type === '투사체' && e.interval > 0 && (e.count || 1) > 1) {
      const n = e.count;
      for (let k = 0; k < n; k++) out.push({ ev: e, time: e.time - (n - 1 - k) * e.interval, burstK: k });
    } else out.push({ ev: e, time: e.time });
  };
  for (const e of pattern.events) { add(e); if (e.composite && e.sub) for (const s of e.sub) add(s); }
  return out;
}
// 공격각도(부채꼴 설정) 이벤트 — 복합 하위 포함
function coneEvents(pattern) {
  const out = [];
  for (const e of pattern.events) {
    if (e.type === '공격각도') out.push(e);
    if (e.composite && e.sub) for (const s of e.sub) if (s.type === '공격각도') out.push(s);
  }
  return out.sort((a, b) => a.time - b.time);
}
// 회복 이벤트 — 복합 하위 포함
function healEvents(pattern) {
  const out = [];
  for (const e of pattern.events) {
    if (e.type === '회복') out.push(e);
    if (e.composite && e.sub) for (const s of e.sub) if (s.type === '회복') out.push(s);
  }
  return out.sort((a, b) => a.time - b.time);
}

// 순간이동 이벤트(복합 하위 포함)
function teleportEvents(pattern) {
  const out = [];
  for (const e of pattern.events) {
    if (e.type === '순간이동') out.push(e);
    if (e.composite && e.sub) for (const s of e.sub) if (s.type === '순간이동') out.push(s);
  }
  return out.sort((a, b) => a.time - b.time);
}
// 음표카운터 이벤트(복합 하위 포함)
function noteEvents(pattern) {
  const out = [];
  for (const e of pattern.events) {
    if (e.type === '음표카운터') out.push(e);
    if (e.composite && e.sub) for (const s of e.sub) if (s.type === '음표카운터') out.push(s);
  }
  return out.sort((a, b) => a.time - b.time);
}
// 텔레포트 도착지 계산 → st 즉시 변경
const clampN = (v, lim) => Math.max(-lim, Math.min(lim, v));
function applyTeleport(te, st, u, lim = 99999) {
  const r = te.dist || 7;
  if (te.dest === '유저 위치') { st.mx = clampN(u.x, lim); st.my = clampN(u.y, lim); return; }
  if (te.dest === '맵 랜덤') { st.mx = clampN((seeded(te.id, 1) - .5) * 16, lim); st.my = clampN((seeded(te.id, 2) - .5) * 16, lim); return; }
  // 유저로부터 랜덤: 후보 12개 중 벽을 피해 "맵 중앙(0,0)에 가장 가까운" 지점 선택
  const ph = seeded(te.id) * TAU; let best = { x: clampN(u.x, lim), y: clampN(u.y, lim) }, bd = Infinity;
  for (let i = 0; i < 12; i++) {
    const a = ph + i / 12 * TAU;
    const x = clampN(u.x + Math.cos(a) * r, lim), y = clampN(u.y + Math.sin(a) * r, lim);
    const dc = Math.hypot(x, y);
    if (dc < bd) { bd = dc; best = { x, y }; }
  }
  st.mx = best.x; st.my = best.y;
}

// 상대 경로(시작점 0,0 기준)를 진행도 prog(0~1)로 보간
export function pathAt(points, prog) {
  const pts = [{ x: 0, y: 0 }, ...points];
  const seg = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push(l); total += l; }
  if (total < 1e-6) return { x: 0, y: 0 };
  let d = prog * total;
  for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const f = seg[i] ? d / seg[i] : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; } d -= seg[i]; }
  return points[points.length - 1];
}

// 공격 히트박스 기하 + 유저 명중 판정. 중심은 몬스터에서 facing 방향 offset m.
export function attackGeom(ev, st, user) {
  const face = st.facing, off = ev.offset || 0;
  const cx = st.mx + Math.cos(face) * off, cy = st.my + Math.sin(face) * off;
  if (ev.area === '특정지역') {
    if (ev.zone === '맵전체') return { kind: 'all', hit: true };
    const zx = ev.zone === '유저추적' || ev.zone === '유저마지막위치' ? user.x : cx;
    const zy = ev.zone === '유저추적' || ev.zone === '유저마지막위치' ? user.y : cy;
    const r = ev.sizeA || 2;
    return { kind: 'circle', x: zx, y: zy, r, hit: dist(zx, zy, user.x, user.y) <= r };
  }
  if (ev.shape === '사각형' || ev.area === '길이와폭') {
    const len = ev.sizeA || 3, wid = ev.sizeB || 1.5;
    // 사각형: 중심(cx,cy)에서 전방으로 len, 좌우 wid/2
    const dx = user.x - cx, dy = user.y - cy;
    const fwd = dx * Math.cos(face) + dy * Math.sin(face);
    const side = -dx * Math.sin(face) + dy * Math.cos(face);
    const hit = fwd >= 0 && fwd <= len && Math.abs(side) <= wid / 2;
    return { kind: 'rect', x: cx, y: cy, face, len, wid, hit };
  }
  // 원형(지름) 또는 나로부터거리
  const r = ev.area === '지름' ? (ev.sizeA || 3) / 2 : (ev.sizeA || 3);
  return { kind: 'circle', x: cx, y: cy, r, hit: dist(cx, cy, user.x, user.y) <= r };
}

// 한 구간(이벤트 타입)에 대한 이동 적용 — st를 변형
function applyMove(st, ev, step, user, rotSpeedRad, dashCache, ctx) {
  if (!ev) return;
  const angToUser = Math.atan2(user.y - st.my, user.x - st.mx);
  switch (ev.type) {
    case '추적': case '몸회전':
      st.facing = rotToward(st.facing, angToUser, rotSpeedRad * step);
      break;
    case '걷기': {
      st.facing = rotToward(st.facing, angToUser, rotSpeedRad * step); // 걷기는 추적 동반
      const d = dist(st.mx, st.my, user.x, user.y);
      // 양옆 걷기: 랜덤 좌/우(이벤트 시드 고정) 측면 이동 / 정면은 유저 초과 안 함
      const dir = ev.side ? angToUser + (seeded(ev.id) < 0.5 ? -1 : 1) * Math.PI / 2 : angToUser;
      const move = ev.side ? (ev.speed || 4) * step : Math.min((ev.speed || 4) * step, d);
      st.mx += Math.cos(dir) * move; st.my += Math.sin(dir) * move;
      break;
    }
    case '대쉬': {
      // 커스텀 경로: 시작점 기준 상대 경로를 진행도로 따라감
      if (ev.dir === '커스텀' && ev.customPath?.length) {
        const c = dashCache[ev.id] ??= { start: { x: st.mx, y: st.my } };
        const span = Math.max(0.05, ctx.segEnd - ctx.segStart);
        const prog = Math.min(1, Math.max(0, (ctx.t - ctx.segStart) / span));
        const pt = pathAt(ev.customPath, prog);
        st.mx = c.start.x + pt.x; st.my = c.start.y + pt.y;
        break;
      }
      // 뒤곡선: 진입 시 축(유저 반대)·시작점 캐시 → 진행도로 2차 베지에 보간(도착지=뒤대각)
      if (ev.dir === '뒤곡선') {
        const c = dashCache[ev.id] ??= computeCurve(ev, angToUser, st, ctx.lim);
        const span = Math.max(0.05, ctx.segEnd - ctx.segStart);
        const prog = Math.min(1, Math.max(0, (ctx.t - ctx.segStart) / span));
        const pt = bezier2(c.P0, c.P1, c.P2, prog);
        st.mx = c.start.x + pt.x; st.my = c.start.y + pt.y;
        break;
      }
      const c = dashCache[ev.id] || (dashCache[ev.id] = computeDashDir(ev, angToUser, ctx, st));
      const v = (ev.dist || 4) / c.span;
      st.mx += Math.cos(c.dir) * v * step; st.my += Math.sin(c.dir) * v * step;
      // 대쉬 중엔 보는 방향 고정(진입 시점 방향 유지) — 유저 추적 안 함
      break;
    }
    // 대기 / 공격 / 투사체 / 지형 → 본체 이동 없음(복합 하위는 fire로 처리)
  }
}
// 벽 회피: 좌/우 후보 중 맵 안(±lim)에 드는 쪽 선택. centerBias면 둘 다 가능할 때 "중앙에 가까운 쪽" 선호.
function chooseSide(sx, sy, angL, angR, dist, ev, lim, centerBias) {
  const end = (a) => ({ x: sx + Math.cos(a) * dist, y: sy + Math.sin(a) * dist });
  const L = end(angL), R = end(angR);
  const okL = Math.abs(L.x) <= lim && Math.abs(L.y) <= lim;
  const okR = Math.abs(R.x) <= lim && Math.abs(R.y) <= lim;
  if (okL && !okR) return angL;
  if (okR && !okL) return angR;
  if (centerBias && okL && okR) { // 둘 다 가능 → 중앙(0,0)에 가까운 도착지 선호
    const dL = Math.hypot(L.x, L.y), dR = Math.hypot(R.x, R.y);
    if (Math.abs(dL - dR) > 0.2) return dL < dR ? angL : angR;
  }
  return seeded(ev.id) < 0.5 ? angL : angR; // 둘 다(또는 둘 다 불가) → 랜덤
}
// 뒤곡선: P0=시작 · P2=도착(유저 반대 ±45°, 벽 회피한 쪽) · P1=곧장 뒤(축) dist*curve.
// → 먼저 뒤로 빠졌다가 대각(옆)으로 휘어 나감. axis/시작점은 진입 시점 값으로 캐시.
function computeCurve(ev, angToUser, st, lim = 99999) {
  const axis = angToUser + Math.PI;                  // 유저 반대(뒤)
  const dist = ev.dist || 4, curve = ev.curve ?? 0.6;
  const endAng = chooseSide(st.mx, st.my, axis - Math.PI / 4, axis + Math.PI / 4, dist, ev, lim, false);
  return {
    start: { x: st.mx, y: st.my },
    P0: { x: 0, y: 0 },
    P1: { x: Math.cos(axis) * dist * curve, y: Math.sin(axis) * dist * curve }, // control = 곧장 뒤
    P2: { x: Math.cos(endAng) * dist, y: Math.sin(endAng) * dist },
  };
}
function bezier2(a, b, c, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y };
}
// 좌우·뒤대각은 벽 회피(안전한 쪽 선택). 직선·후퇴·왼/오른쪽은 고정(벽은 위치 클램프로 정지).
function computeDashDir(ev, angToUser, ctx, st) {
  let dir = angToUser;
  const dist = ev.dist || 4, lim = ctx.lim ?? 99999;
  if (ev.dir === '후퇴') dir = angToUser + Math.PI;
  else if (ev.dir === '뒤대각') {
    const ax = angToUser + Math.PI;
    dir = chooseSide(st.mx, st.my, ax - Math.PI / 4, ax + Math.PI / 4, dist, ev, lim, false);
  }
  else if (ev.dir === '왼쪽') dir = angToUser - Math.PI / 2;
  else if (ev.dir === '오른쪽') dir = angToUser + Math.PI / 2;
  else if (ev.dir === '좌우') dir = chooseSide(st.mx, st.my, angToUser - Math.PI / 2, angToUser + Math.PI / 2, dist, ev, lim, true); // 좌우=중앙 선호
  return { dir, span: Math.max(0.05, (ctx.segEnd - ctx.segStart) || 1) };
}

// 파생 배열(정렬된 evs/fires/teles/notes/cones/heals)은 패턴 구조에만 의존(t 무관)하므로
// 패턴별 1회만 계산하고 캐시. 배열은 이벤트 "참조"만 담고 필드값은 시뮬 중 라이브로 읽으므로,
// 무효화가 필요한 변경은 type/time/(투사체)interval·count 뿐 → 그 시그니처가 바뀔 때만 재계산.
const _derivedCache = new WeakMap();
function _foldEv(h, e) {
  h = Math.imul(h ^ ((e.time * 1000) | 0), 16777619);
  const t = e.type || '';
  for (let k = 0; k < t.length; k++) h = Math.imul(h ^ t.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (((e.interval || 0) * 1000) | 0), 16777619);
  h = Math.imul(h ^ (e.count || 0), 16777619);
  return h >>> 0;
}
function _patternSig(pattern) {
  const ev = pattern.events; let h = (ev.length + 1) >>> 0;
  for (let i = 0; i < ev.length; i++) {
    h = _foldEv(h, ev[i]);
    const sub = ev[i].sub;
    if (sub) for (let j = 0; j < sub.length; j++) h = _foldEv(h, sub[j]);
  }
  return h >>> 0;
}
function getDerived(pattern) {
  const sig = _patternSig(pattern);
  const c = _derivedCache.get(pattern);
  if (c && c.sig === sig) return c.d;
  const d = {
    evs: [...pattern.events].sort((a, b) => a.time - b.time),
    fires: fireEvents(pattern).sort((a, b) => a.time - b.time),
    teles: teleportEvents(pattern),
    notes: noteEvents(pattern),
    cones: coneEvents(pattern),
    heals: healEvents(pattern),
  };
  _derivedCache.set(pattern, { sig, d });
  return d;
}

// 패턴을 0→tEnd 까지 시뮬(매 프레임 재계산 → 스크럽/결정성).
export function simulateUpTo(pattern, tEnd, opts = {}) {
  const userAt = opts.user || (() => ({ x: 5, y: 0 }));
  const rotSpeedRad = ((opts.rotationSpeed ?? 360) * Math.PI / 180);
  const st = { mx: opts.init?.mx ?? 0, my: opts.init?.my ?? 0, facing: opts.init?.facing ?? 0 };
  const { evs, fires, teles, notes, cones, heals } = getDerived(pattern);
  const dashCache = {};
  const dt = 1 / 60;
  // 맵 경계(벽): 중심 0, 한 변 mapSize. 보스 중심은 ±(half - 반경) 안으로 클램프.
  const half = (opts.mapSize ?? 99999) / 2, lim = Math.max(0.1, half - (opts.size ?? 0));
  const clampPos = () => { st.mx = Math.max(-lim, Math.min(lim, st.mx)); st.my = Math.max(-lim, Math.min(lim, st.my)); };
  let t = 0, fi = 0, ti = 0, ni = 0, ci = 0, hi = 0, si = 0;
  let activeCone = null; // 현재 활성 부채꼴 {axis, widthRad}
  const out = [];
  let guard = 0;
  clampPos();
  while (t < tEnd - 1e-9 && guard++ < 100000) {
    const step = Math.min(dt, tEnd - t);
    // 현재 세그먼트 = time이 t 이상인 첫 이벤트. t는 단조 증가하므로 포인터만 전진(O(1)/스텝).
    while (si < evs.length && evs[si].time < t - 1e-9) si++;
    const seg = si < evs.length ? evs[si] : null;
    const prevT = (si > 0 && si < evs.length) ? evs[si - 1].time : 0;
    applyMove(st, seg, step, userAt(t), rotSpeedRad, dashCache, { t, segStart: prevT, segEnd: seg?.time ?? 0, lim });
    clampPos(); // 모든 이동은 벽 안으로 강제
    const t2 = t + step;
    // 순간이동: 해당 시간에 즉시 점프(위치 스냅)
    while (ti < teles.length && teles[ti].time <= t2 + 1e-9) {
      const te = teles[ti];
      applyTeleport(te, st, userAt(te.time), lim);
      clampPos();
      out.push({ type: '순간이동', time: te.time, x: st.mx, y: st.my, ev: te });
      ti++;
    }
    while (ni < notes.length && notes[ni].time <= t2 + 1e-9) {
      const ne = notes[ni];
      out.push({ type: '음표카운터', time: ne.time, amount: ne.amount || 1, ev: ne });
      ni++;
    }
    while (hi < heals.length && heals[hi].time <= t2 + 1e-9) {
      const he = heals[hi];
      out.push({ type: '회복', time: he.time, amount: he.amount || 0, x: st.mx, y: st.my, ev: he });
      hi++;
    }
    // 공격각도: 이 시점의 facing을 축으로 부채꼴 확정(이후 투사체 참조 + 표시)
    while (ci < cones.length && cones[ci].time <= t2 + 1e-9) {
      const ce = cones[ci], widthRad = (ce.angle ?? 90) * Math.PI / 180;
      activeCone = { axis: st.facing, widthRad };
      out.push({ type: '공격각도', time: ce.time, x: st.mx, y: st.my, axis: st.facing, widthRad, ev: ce });
      ci++;
    }
    while (fi < fires.length && fires[fi].time <= t2 + 1e-9) {
      const entry = fires[fi], fe = entry.ev, ft = entry.time, u = userAt(ft);
      const snap = { mx: st.mx, my: st.my, facing: st.facing };
      if (fe.type === '공격') out.push({ type: '공격', time: ft, geom: attackGeom(fe, snap, u), ev: fe });
      else if (fe.type === '투사체') {
        // 기본은 몸 방향. 유저조준=발사 순간 유저 위치. 공격각도내 랜덤=부채꼴 안 무작위(렌더가 각 발 처리).
        let pdir = snap.facing, cone = null;
        if (fe.dir === '유저조준') pdir = Math.atan2(u.y - snap.my, u.x - snap.mx);
        else if (fe.dir === '공격각도내 랜덤' && activeCone) { cone = activeCone; pdir = activeCone.axis; }
        out.push({ type: '투사체', time: ft, x: snap.mx, y: snap.my, dir: pdir, cone, burstK: entry.burstK ?? null, ev: fe });
      }
      else if (fe.type === '지형') {
        const pts = [];
        for (let k = 0; k < (fe.count || 1); k++) {
          let bx, by;
          if (fe.pos === '몬스터 위치') { bx = snap.mx + Math.cos(snap.facing) * (fe.offset || 0); by = snap.my + Math.sin(snap.facing) * (fe.offset || 0); }
          else if (fe.pos === '맵 랜덤') { bx = (seeded(fe.id, k) - .5) * 16; by = (seeded(fe.id, k + 9) - .5) * 16; }
          else { bx = u.x; by = u.y; } // 유저 위치
          if (k) { bx += (seeded(fe.id, k) - .5) * 2; by += (seeded(fe.id, k + 9) - .5) * 2; }
          pts.push({ x: bx, y: by });
        }
        out.push({ type: '지형', time: ft, pts, ev: fe });
      }
      fi++;
    }
    t = t2;
  }
  // 현재 활성 세그먼트(HUD)
  const segNow = evs.find((e) => e.time >= tEnd - 1e-9) || null;
  return { state: st, fires: out, activeType: segNow?.type || (evs.length ? '종료' : null) };
}

// ── 반복 구간 결정론적 펼치기(단일 모드 미리보기) ──
//  repeat.segEnd 이하 = 루프 구간(n번 복제), 초과 = 꼬리(맨 뒤 1회).
//  이벤트 id에 #i 부여 → dashCache/seeded가 루프마다 새로(랜덤360·뒤대각 매번 다름).
//  결과는 repeat 없는 평범한 긴 패턴 → simulateUpTo로 그대로 스크럽 가능.
export function expandPattern(pattern, n) {
  const rep = pattern.repeat;
  if (!rep || !rep.segEnd || !(n > 1)) return pattern;
  const seg = rep.segEnd, eps = 1e-9;
  const cloneEv = (e, i, dt) => {
    const c = { ...e, id: `${e.id}#${i}`, time: Math.round((e.time + dt) * 1e4) / 1e4 };
    if (e.sub) c.sub = e.sub.map((s) => ({ ...s, id: `${s.id}#${i}`, time: Math.round((s.time + dt) * 1e4) / 1e4 }));
    return c;
  };
  const loop = pattern.events.filter((e) => e.time <= seg + eps);
  const tail = pattern.events.filter((e) => e.time > seg + eps);
  const events = [];
  for (let i = 0; i < n; i++) for (const e of loop) events.push(cloneEv(e, i, i * seg));
  for (const e of tail) events.push(cloneEv(e, n - 1, (n - 1) * seg));
  const duration = Math.round(((n - 1) * seg + pattern.duration) * 1e4) / 1e4;
  return { ...pattern, events, duration, repeat: null, _expanded: n };
}

// ── 벽 때문에 대쉬 수행이 불가능한 패턴 판정(벽 회피의 기본 시스템) ──
//  대쉬 후보 방향 중 "대쉬거리 × frac(기본 0.8) 이상" 갈 수 있는 게 하나도 없으면 그 패턴은 수행 불가.
//  좌우/뒤곡선 등 후보 2개는 한쪽만 열려도 가능(chooseSide가 그쪽 선택). 대쉬 없는 패턴은 항상 가능.
function clearance(px, py, ang, lim, max) { // 박스 [-lim,lim]² 벽까지 거리
  const cx = Math.cos(ang), cy = Math.sin(ang); let t = max;
  if (cx > 1e-6) t = Math.min(t, (lim - px) / cx); else if (cx < -1e-6) t = Math.min(t, (-lim - px) / cx);
  if (cy > 1e-6) t = Math.min(t, (lim - py) / cy); else if (cy < -1e-6) t = Math.min(t, (-lim - py) / cy);
  return Math.max(0, t);
}
function dashCandidates(ev, angToUser) {
  switch (ev.dir) {
    case '직선': return [angToUser];
    case '후퇴': return [angToUser + Math.PI];
    case '왼쪽': return [angToUser - Math.PI / 2];
    case '오른쪽': return [angToUser + Math.PI / 2];
    case '좌우': return [angToUser - Math.PI / 2, angToUser + Math.PI / 2];
    case '뒤대각': case '뒤곡선': { const ax = angToUser + Math.PI; return [ax - Math.PI / 4, ax + Math.PI / 4]; }
    default: return null; // 커스텀 등 → 검사 제외(가능으로 간주)
  }
}
function patternDashes(pattern) {
  const out = [];
  for (const e of pattern.events) { if (e.type === '대쉬') out.push(e); if (e.composite && e.sub) for (const s of e.sub) if (s.type === '대쉬') out.push(s); }
  return out;
}
export function patternFeasible(pattern, ctx) {
  if (ctx.lim == null || !ctx.pos || !ctx.user) return true; // 맵 정보 없으면 항상 가능
  const ang = Math.atan2(ctx.user.y - ctx.pos.y, ctx.user.x - ctx.pos.x);
  const frac = ctx.feasFrac ?? 0.8;
  for (const ev of patternDashes(pattern)) {
    const cands = dashCandidates(ev, ang);
    if (!cands) continue;
    const dist = ev.dist || 4, need = dist * frac;
    if (!cands.some((a) => clearance(ctx.pos.x, ctx.pos.y, a, ctx.lim, dist) >= need)) return false;
  }
  return true;
}

// ── BT 패턴 선택(확정 알고리즘) → 매칭된 행 반환 ──
//  1) 특수행(쿨 준비·음표게이트) → 2) 현재모드행 위→아래. 벽으로 수행 불가한 패턴은 건너뜀.
//  ctx.bt: 활성 무기의 BT 행. ctx.usesNotes: 음표 시스템. ctx.pos/user/lim: 벽 판정용.
export const NOTE_MAX = 5; // 특수 패턴 발동에 필요·소모하는 음표 수(고정 규칙)
export function pickPattern(entity, ctx) {
  const rows = ctx.bt || entity.bt;
  // 행의 거리밴드 범위에 현재 거리가 들어오면 매칭(밴드 겹침 허용). bandFor 단일값 비교 X.
  const inBand = (r) => { if (r.band < 0) return true; const b = entity.distanceBands[r.band]; return !!b && ctx.distance >= (b.min ?? 0) && ctx.distance <= b.max; };
  const feasible = (r) => { const p = entity.patterns.find((x) => x.id === r.patternId); return !p || patternFeasible(p, ctx); };
  const okRow = (r) => r.patternId
    && (r.phaseIdx < 0 || r.phaseIdx === ctx.phaseIdx)
    && inBand(r)
    && (!ctx.cd[r.patternId] || ctx.cd[r.patternId] <= 0)
    && feasible(r);
  if (ctx.usesNotes) {
    // 음표 시스템: 음표가 NOTE_MAX 이상이면 특수 패턴 강제 발동(쿨/거리 무시, 페이즈만 일치)
    if ((ctx.notes ?? 0) >= NOTE_MAX) for (const r of rows)
      if (r.mode === '특수' && r.patternId && (r.phaseIdx < 0 || r.phaseIdx === ctx.phaseIdx) && feasible(r)) return r;
  } else {
    for (const r of rows) if (r.mode === '특수' && okRow(r)) return r;           // 레거시: 특수 우선
  }
  for (const r of rows) if (r.mode === ctx.mode && okRow(r)) return r;           // 현재 모드(불가 패턴은 스킵→다음)
  return null;
}
// 패턴 내 모드전환 이벤트(복합 하위 포함) 추출 — [{time,toMode}]
export function modeSwitches(pattern) {
  const out = [];
  for (const e of pattern.events) {
    if (e.type === '모드전환') out.push({ time: e.time, toMode: e.toMode || '토글' });
    if (e.composite && e.sub) for (const s of e.sub) if (s.type === '모드전환') out.push({ time: s.time, toMode: s.toMode || '토글' });
  }
  return out.sort((a, b) => a.time - b.time);
}
export function resolveMode(toMode, cur) {
  if (toMode === '토글') return cur === '공격' ? '수비' : '공격';
  return toMode; // '공격' | '수비'
}

export function bandFor(entity, d) {
  const b = entity.distanceBands;
  for (let i = 0; i < b.length; i++) if (d >= (b[i].min ?? 0) && d <= b[i].max) return i;
  return b.length - 1;
}
