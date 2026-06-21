// ============================================================
//  ⑦ 커스텀 경로 에디터 (별도 모달 창)
//  mode='dash' : 마우스로 이동 동선(상대 경로) 그리기 + 도착점 편집
//  mode='proj' : 투사체 생성 위치 + 날아가는 방향 편집(개수는 ev.count)
//  좌표 = 미터, 중앙 = 몬스터 원점(0,0). 오른쪽(+x) = 유저 방향 기준.
// ============================================================
const VIEW = 18;            // 보이는 영역(m)
const SZ = 460;             // 캔버스 px
const SCALE = SZ / VIEW;
const w2s = (x, y) => [SZ / 2 + x * SCALE, SZ / 2 + y * SCALE];
const s2w = (sx, sy) => [(sx - SZ / 2) / SCALE, (sy - SZ / 2) / SCALE];
const r2 = (v) => Math.round(v * 100) / 100;

export function openPathEditor(mode, ev, onSave) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const isDash = mode === 'dash';
  bg.innerHTML = `
    <div class="modal">
      <div class="modal-hd">
        <b>${isDash ? '대쉬 경로 편집' : '투사체 생성/방향 편집'}</b>
        <span class="dim small">${isDash ? '빈 곳 클릭=점 추가 · 점 드래그=이동 · 마지막 점이 도착지' : '점 드래그=위치 · 화살촉 드래그=방향 (개수 ' + (ev.count || 1) + ')'}</span>
        <span class="grow"></span>
        <button class="mini" data-a="undo">${isDash ? '되돌리기' : '기본값'}</button>
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
  let pts = isDash ? (ev.customPath ? ev.customPath.map((p) => ({ ...p })) : []) : null;
  let spawns = !isDash ? syncSpawns(ev.customSpawns, ev.count || 1) : null;

  function syncSpawns(src, n) {
    const out = (src || []).map((s) => ({ ...s }));
    while (out.length < n) out.push({ x: 0, y: -1 + out.length * 0.6, angle: 0 }); // 기본: 정면(+x)
    out.length = n;
    return out;
  }

  // ── 렌더 ──
  function render() {
    ctx.clearRect(0, 0, SZ, SZ); ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, SZ, SZ);
    // 그리드
    ctx.strokeStyle = '#161b22';
    for (let m = -VIEW; m <= VIEW; m++) { const [sx] = w2s(m, 0), [, sy] = w2s(0, m); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, SZ); ctx.moveTo(0, sy); ctx.lineTo(SZ, sy); ctx.stroke(); }
    // 원점(몬스터) + 유저 방향
    const [ox, oy] = w2s(0, 0);
    ctx.fillStyle = '#3fb950'; ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#22d3ee'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(...w2s(6, 0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#22d3ee'; ctx.font = '10px sans-serif'; ctx.fillText('유저 방향 →', ...w2s(3, -0.6));

    if (isDash) {
      ctx.strokeStyle = '#bc8cff'; ctx.lineWidth = 2; ctx.beginPath();
      const full = [{ x: 0, y: 0 }, ...pts];
      full.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
      pts.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y); ctx.fillStyle = i === pts.length - 1 ? '#f0883e' : '#bc8cff'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill(); });
    } else {
      spawns.forEach((s) => {
        const [sx, sy] = w2s(s.x, s.y);
        ctx.fillStyle = '#f0883e'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
        const tx = sx + Math.cos(s.angle) * 34, ty = sy + Math.sin(s.angle) * 34;
        ctx.strokeStyle = '#f0883e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = '#ffd6a8'; ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  // ── 입력 ──
  const posOf = (e) => { const r = canvas.getBoundingClientRect(); return s2w(e.clientX - r.left, e.clientY - r.top); };
  let drag = null; // {kind:'pt'|'pos'|'ang', idx}
  canvas.addEventListener('mousedown', (e) => {
    const [wx, wy] = posOf(e);
    if (isDash) {
      const hit = pts.findIndex((p) => Math.hypot(p.x - wx, p.y - wy) < 0.5);
      if (hit >= 0) drag = { kind: 'pt', idx: hit };
      else { pts.push({ x: r2(wx), y: r2(wy) }); render(); }
    } else {
      for (let i = 0; i < spawns.length; i++) {
        const s = spawns[i];
        const tx = s.x + Math.cos(s.angle) * (34 / SCALE), ty = s.y + Math.sin(s.angle) * (34 / SCALE);
        if (Math.hypot(tx - wx, ty - wy) < 0.5) { drag = { kind: 'ang', idx: i }; return; }
        if (Math.hypot(s.x - wx, s.y - wy) < 0.5) { drag = { kind: 'pos', idx: i }; return; }
      }
    }
  });
  window.addEventListener('mousemove', onMove);
  function onMove(e) {
    if (!drag) return; const [wx, wy] = posOf(e);
    if (drag.kind === 'pt') { pts[drag.idx].x = r2(wx); pts[drag.idx].y = r2(wy); }
    else if (drag.kind === 'pos') { spawns[drag.idx].x = r2(wx); spawns[drag.idx].y = r2(wy); }
    else if (drag.kind === 'ang') { const s = spawns[drag.idx]; s.angle = r2(Math.atan2(wy - s.y, wx - s.x)); }
    render();
  }
  window.addEventListener('mouseup', () => drag = null);

  // ── 버튼 ──
  function close() { window.removeEventListener('mousemove', onMove); bg.remove(); }
  bg.querySelector('[data-a="undo"]').onclick = () => { if (isDash) pts.pop(); else spawns = syncSpawns(null, ev.count || 1); render(); };
  bg.querySelector('[data-a="clear"]').onclick = () => { if (isDash) pts = []; else spawns.forEach((s) => { s.x = 0; s.y = 0; s.angle = 0; }); render(); };
  bg.querySelector('[data-a="cancel"]').onclick = close;
  bg.querySelector('[data-a="save"]').onclick = () => {
    if (isDash) ev.customPath = pts.map((p) => ({ x: p.x, y: p.y }));
    else ev.customSpawns = spawns.map((s) => ({ x: s.x, y: s.y, angle: s.angle }));
    onSave?.(); close();
  };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });

  render();
}
