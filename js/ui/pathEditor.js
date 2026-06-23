// ============================================================
//  ⑦ 경로 에디터 (별도 모달 창)
//  mode='dash'     : 마우스로 이동 동선(상대 경로) 그리기 + 도착점 편집(점 클릭)
//  mode='projpath' : 투사체 궤적 — 마우스로 곡선을 드래그해 그림 + 자동 곡선 보정
//                    곡선 시작점 = 생성위치, 시작 방향 = 발사방향. +x = 유저 방향.
//  좌표 = 미터, 중앙 = 몬스터 원점(0,0). 오른쪽(+x) = 유저 방향 기준.
// ============================================================
const VIEW = 18;            // 보이는 영역(m)
const SZ = 460;             // 캔버스 px
const SCALE = SZ / VIEW;
const w2s = (x, y) => [SZ / 2 + x * SCALE, SZ / 2 + y * SCALE];
const s2w = (sx, sy) => [(sx - SZ / 2) / SCALE, (sy - SZ / 2) / SCALE];
const r2 = (v) => Math.round(v * 100) / 100;

// ── 곡선 보정 ───────────────────────────────────────────────
// 점→선분 수직거리(Ramer–Douglas–Peucker용)
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}
// 손떨림 점 제거 — RDP 단순화
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], a, b); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  return [a, b];
}
// Catmull-Rom 스플라인으로 점들을 통과하는 매끄러운 곡선으로 재샘플
function catmullRom(pts, perSeg = 10) {
  if (pts.length < 3) return pts.slice();
  const out = []; const P = [pts[0], ...pts, pts[pts.length - 1]]; // 끝점 클램프
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// 이동평균(점을 실제로 옮겨 손떨림 완화) — 양 끝은 고정
function movingAvg(pts, passes = 2) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const o = [p[0]];
    for (let i = 1; i < p.length - 1; i++) o.push({ x: (p[i - 1].x + p[i].x + p[i + 1].x) / 3, y: (p[i - 1].y + p[i].y + p[i + 1].y) / 3 });
    o.push(p[p.length - 1]); p = o;
  }
  return p;
}
// 호 길이 균일 간격 재샘플(저장 점 수 절감 + 등속 추종에 유리)
function resampleByDist(pts, step = 0.25) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]]; let acc = 0, prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let seg = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y);
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      const np = { x: prev.x + (pts[i].x - prev.x) * t, y: prev.y + (pts[i].y - prev.y) * t };
      out.push(np); prev = np; seg = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y); acc = 0;
    }
    acc += seg; prev = pts[i];
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 1].x - last.x, out[out.length - 1].y - last.y) > 1e-6) out.push(last);
  return out;
}
// 프리핸드 원본 → 보정 곡선: 솎기 → 이동평균(떨림완화) → RDP → Catmull-Rom → 균일 재샘플
function smoothFreehand(raw) {
  const filt = [];
  for (const p of raw) { const last = filt[filt.length - 1]; if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.08) filt.push(p); }
  if (filt.length < 3) return filt.map((p) => ({ x: r2(p.x), y: r2(p.y) }));
  const avg = movingAvg(filt, 2);            // 손떨림 완화(점 이동)
  const simp = rdp(avg, 0.12);               // 중복점 제거
  const smooth = catmullRom(simp, 6);        // 매끄러운 곡선
  const res = resampleByDist(smooth, 0.25);  // 균일 간격(점 수 절감)
  return res.map((p) => ({ x: r2(p.x), y: r2(p.y) }));
}

export function openPathEditor(mode, ev, onSave) {
  const isDash = mode === 'dash';
  const isPath = mode === 'projpath';
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const title = isDash ? '대쉬 경로 편집' : '투사체 궤적 편집';
  const hint = isDash ? '빈 곳 클릭=점 추가 · 점 드래그=이동 · 마지막 점이 도착지'
    : '드래그로 곡선을 그리세요 · 놓으면 자동 보정 · 시작점=생성위치, +x(오른쪽)=발사 순간 유저 방향';
  bg.innerHTML = `
    <div class="modal">
      <div class="modal-hd">
        <b>${title}</b>
        <span class="dim small">${hint}</span>
        <span class="grow"></span>
        <button class="mini" data-a="undo">${isDash ? '되돌리기' : '다시 그리기'}</button>
        <button class="mini" data-a="clear">지움</button>
      </div>
      <canvas width="${SZ}" height="${SZ}"></canvas>
      <div class="modal-ft">
        <button class="btn" data-a="cancel">취소</button>
        <button class="btn primary" data-a="save">저장</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  const canvas = bg.querySelector('canvas');
  const ctx = canvas.getContext('2d');

  // 작업 데이터(딥카피)
  let pts = ((isDash ? ev.customPath : ev.projPath) || []).map((p) => ({ ...p }));
  let raw = null;     // 궤적: 드래그 중 프리핸드 원본
  let drawing = false;

  // ── 렌더 ──
  function render() {
    ctx.clearRect(0, 0, SZ, SZ); ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, SZ, SZ);
    // 그리드
    ctx.strokeStyle = '#161b22';
    for (let m = -VIEW; m <= VIEW; m++) { const [sx] = w2s(m, 0), [, sy] = w2s(0, m); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, SZ); ctx.moveTo(0, sy); ctx.lineTo(SZ, sy); ctx.stroke(); }
    // 몬스터 폰(원점) ↔ 유저 폰(+x 방향) — 둘 다 표시
    const [ox, oy] = w2s(0, 0);
    const [ux, uy] = w2s(7, 0); // 유저 폰 위치(+x = 유저 방향 기준점)
    ctx.strokeStyle = '#3a4250'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ux, uy); ctx.stroke(); ctx.setLineDash([]);
    // 몬스터 폰(초록)
    ctx.fillStyle = '#3fb950'; ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#3fb950'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('몬스터', ox, oy + 22);
    // 유저 폰(노랑) — 시뮬레이터 유저색과 동일
    ctx.fillStyle = '#ffd33d'; ctx.beginPath(); ctx.arc(ux, uy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffd33d'; ctx.fillText('유저 →', ux, uy - 12);
    ctx.textAlign = 'start';

    if (isDash) {
      ctx.strokeStyle = '#bc8cff'; ctx.lineWidth = 2; ctx.beginPath();
      const full = [{ x: 0, y: 0 }, ...pts];
      full.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
      pts.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); ctx.fillStyle = i === pts.length - 1 ? '#f0883e' : '#bc8cff'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill(); });
    } else {
      // 드래그 중인 프리핸드 원본(흐리게)
      if (raw && raw.length > 1) {
        ctx.strokeStyle = '#f0883e44'; ctx.lineWidth = 1; ctx.beginPath();
        raw.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
      }
      // 보정된 궤적(진하게) + 시작점(생성위치)·끝점
      if (pts.length > 1) {
        ctx.strokeStyle = '#f0883e'; ctx.lineWidth = 2; ctx.beginPath();
        pts.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
        const [bx, by] = w2s(pts[0].x, pts[0].y);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill(); // 생성위치(시작점)
        ctx.fillStyle = '#0b0f14'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('생성', bx, by + 3); ctx.textAlign = 'start';
        const [ex, ey] = w2s(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.fillStyle = '#f0883e'; ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill(); // 끝점
      } else if (!drawing) {
        ctx.fillStyle = '#8b949e'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('드래그해서 곡선을 그리세요', ...w2s(0, 4)); ctx.textAlign = 'start';
      }
    }
  }

  // ── 입력 ──
  const posOf = (e) => { const r = canvas.getBoundingClientRect(); return s2w(e.clientX - r.left, e.clientY - r.top); };
  let drag = null; // dash: {idx}
  canvas.addEventListener('mousedown', (e) => {
    const [wx, wy] = posOf(e);
    if (isPath) { drawing = true; raw = [{ x: wx, y: wy }]; render(); return; }
    // dash: 점 클릭/추가
    const hit = pts.findIndex((p) => Math.hypot(p.x - wx, p.y - wy) < 0.5);
    if (hit >= 0) drag = { idx: hit };
    else { pts.push({ x: r2(wx), y: r2(wy) }); render(); }
  });
  window.addEventListener('mousemove', onMove);
  function onMove(e) {
    if (isPath) { if (!drawing) return; const [wx, wy] = posOf(e); raw.push({ x: wx, y: wy }); render(); return; }
    if (!drag) return; const [wx, wy] = posOf(e);
    pts[drag.idx].x = r2(wx); pts[drag.idx].y = r2(wy); render();
  }
  window.addEventListener('mouseup', () => {
    if (isPath && drawing) { drawing = false; if (raw && raw.length > 1) pts = smoothFreehand(raw); raw = null; render(); return; }
    drag = null;
  });

  // ── 버튼 ──
  function close() { window.removeEventListener('mousemove', onMove); bg.remove(); }
  bg.querySelector('[data-a="undo"]').onclick = () => { if (isDash) pts.pop(); else { pts = []; raw = null; } render(); };
  bg.querySelector('[data-a="clear"]').onclick = () => { pts = []; raw = null; render(); };
  bg.querySelector('[data-a="cancel"]').onclick = close;
  bg.querySelector('[data-a="save"]').onclick = () => {
    if (isDash) ev.customPath = pts.map((p) => ({ x: p.x, y: p.y }));
    else ev.projPath = pts.length > 1 ? pts.map((p) => ({ x: p.x, y: p.y })) : null;
    onSave?.(); close();
  };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });

  render();
}
