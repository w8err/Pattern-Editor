// ============================================================
//  레거시(BB_패턴_시뮬레이터.html) → 신포맷 JSON 변환기
//  · 단일값 패턴 → 이벤트 타임라인(근사). 프레임 데이터 없어 추정.
//  · 보류 시스템(버프/힐/실드·천구SC·아현 음표/폼·군체)은 스킵, 게이트는 desc에 보존.
//  실행:  node editor/tools/migrate.mjs
// ============================================================
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newEvent } from '../js/model.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');                 // Simulater/
const HTML = join(ROOT, 'BB_패턴_시뮬레이터.html');
const OUT  = join(__dir, '..', 'data');               // editor/data/

const round2 = (x) => Math.round(x * 100) / 100;
const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').trim();

// ── 1) DEFS 리터럴 추출 + eval ────────────────────
const html = readFileSync(HTML, 'utf8');
const start = html.indexOf('const DEFS = {');
const endMark = html.indexOf('// ── 시뮬 상태');
const close = html.lastIndexOf('};', endMark);
const defsSrc = html.slice(start + 'const DEFS = '.length, close + 1);
const P = (o) => Object.assign({ dmg: 0, rng: 0, dur: 0.6, mv: null, mvd: 0, spd: 4, cd: 0 }, o);
const DEFS = new Function('P', 'return (' + defsSrc + ');')(P);

const DEFAULT_TIERS = { veryClose: [0, 2], close: [2, 5], mid: [5, 10], far: [10, 18], veryFar: [18, 999] };
const TIER_LABELS = { veryClose: '초근거리', close: '근거리', mid: '중거리', far: '장거리', veryFar: '초장거리' };

function bandsFrom(def) {
  const t = def.distTiers || DEFAULT_TIERS;
  return Object.keys(t).map((k) => ({ name: TIER_LABELS[k] || k, min: t[k][0], max: Math.min(t[k][1], 99) }));
}
function bandIndexForMax(bands, max) {
  for (let i = 0; i < bands.length; i++) if (max <= bands[i].max) return i;
  return bands.length - 1;
}

const SKIP_TYPES = new Set(['buff', 'swarm']);
const isKept = (p) => !SKIP_TYPES.has(p.type) && !p.special; // 휘모리(special) 등 폼시스템 제외
const ruleIsSpecial = (r) => r.hpLt != null || r.noteFull || r.once || r.scLt != null;

// ── 2) 이벤트 빌더 ───────────────────────────────
function ev(type, time, extra = {}) {
  const e = newEvent(type);
  e.time = round2(time);
  return Object.assign(e, extra);
}

function attackEvents(p) {
  const dur = p.dur, wind = round2(dur * 0.35), out = [];
  out.push(ev('추적', wind));                                   // 선딜=정렬/응시
  if (p.mv && p.mvd > 0) {
    const t = round2(dur * 0.7);
    if (p.mv === 'toward') out.push(ev('걷기', t, { speed: p.spd }));
    else out.push(ev('대쉬', t, { dir: p.mv === 'away' ? '후퇴' : '왼쪽', dist: p.mvd }));
  }
  const hits = p.hits?.length ? p.hits : [p.dmg];
  hits.forEach((h, i) => {
    const t = hits.length === 1 ? dur : round2(dur * (0.6 + 0.35 * (i / Math.max(1, hits.length - 1))));
    out.push(ev('공격', t, {
      indicator: true, indicatorTime: wind, damage: h,
      shape: '원형', area: '나로부터거리', sizeA: p.rng,
    }));
  });
  return out.sort((a, b) => a.time - b.time);
}
function moveEvents(p) {
  if (p.mv === 'toward') return [ev('걷기', p.dur, { speed: p.spd })];
  return [ev('대쉬', p.dur, { dir: p.mv === 'away' ? '후퇴' : '왼쪽', dist: p.mvd })];
}
function projEvents(p) {
  return [
    ev('추적', round2(p.dur * 0.4)),
    ev('투사체', p.dur, {
      damage: p.dmg, count: p.pcount || 1, speed: p.pspeed || 10,
      lifetime: p.pmax && p.pspeed ? round2(p.pmax / p.pspeed) : 2,
      homing: p.phoming ? 80 : 0, dir: '직선',
    }),
  ];
}

// 레거시 steps 타임라인(유웅 소) → 이벤트 직변환
function stepsEvents(p) {
  const s = p.steps, out = [];
  s.forEach((st, i) => {
    const nextT = i + 1 < s.length ? s[i + 1].t : p.dur;
    const span = Math.max(0.05, nextT - st.t);
    if (st.type === 'telegraph') out.push(ev(st.canRotate ? '추적' : '대기', nextT));
    else if (st.type === 'move') {
      if (st.mv === 'toward') out.push(ev('걷기', nextT, { speed: round2(st.mvd / span) }));
      else out.push(ev('대쉬', nextT, { dir: st.mv === 'away' ? '후퇴' : '왼쪽', dist: st.mvd }));
    } else if (st.type === 'hit') {
      out.push(ev('공격', st.t, { indicator: false, damage: st.dmg, shape: '원형', area: '나로부터거리', sizeA: st.rng }));
    } else if (st.type === 'proj') {
      out.push(ev('투사체', st.t, { damage: st.dmg, count: st.pcount || 1, speed: st.pspeed || 10 }));
    }
  });
  return out;
}

function convertPattern(p) {
  let events;
  if (p.steps?.length) events = stepsEvents(p);
  else if (p.type === 'move') events = moveEvents(p);
  else if (p.type === 'proj') events = projEvents(p);
  else events = attackEvents(p);
  // 패턴은 공격/이동 분류 없음(모드는 BT가 결정)
  return { id: p.id, name: p.name, duration: p.dur, cooldown: p.cd ?? 0, events };
}

// ── 3) 엔티티 변환 ───────────────────────────────
const report = { converted: [], dropped: [] };

function convertEntity(def) {
  const kind = def.type === 'boss' ? 'boss' : 'monster';
  const bands = bandsFrom(def);
  const kept = def.patterns.filter(isKept);
  const keptIds = new Set(kept.map((p) => p.id));
  def.patterns.filter((p) => !isKept(p)).forEach((p) =>
    report.dropped.push(`${def.name} · ${p.name} (${p.type}${p.special ? '/special' : ''})`));

  const e = {
    schema: 1, id: def.id, name: def.name, kind,
    hp: (def.phases || []).reduce((s, ph) => s + (ph.hp || 0), 0) || 1000,
    size: def.size ?? 0.6, rotationSpeed: def.turnSpeed ?? 360,
    description: '',
    distanceBands: bands,
    phases: (def.phases || []).map((ph) => ({
      name: ph.name, hp: ph.hp,
      transitionPatternId: ph.startPat && keptIds.has(ph.startPat) ? ph.startPat : null,
    })),
    patterns: kept.map(convertPattern),
    bt: [],
  };
  if (kind === 'boss') {
    e.specialModePatternIds = [];
  }

  const ptype = Object.fromEntries(def.patterns.map((p) => [p.id, p.type]));
  for (const r of def.rules || []) {
    if (!r.to || !keptIds.has(r.to)) continue;
    const special = ruleIsSpecial(r);
    const mode = special ? '특수' : (ptype[r.to] === 'move' ? '수비' : '공격');
    const descBits = [];
    if (r.dist) descBits.push(`거리 ${r.dist[0]}~${r.dist[1]}m`);
    if (r.prob != null) descBits.push(`확률 ${Math.round(r.prob * 100)}%`);
    if (r.cd) descBits.push('쿨게이트');
    if (r.hpLt != null) descBits.push(`HP<${r.hpLt}%`);
    if (r.form != null) descBits.push(`form${r.form}`);
    if (r.noteFull) descBits.push('음표MAX');
    if (r.once) descBits.push('1회');
    e.bt.push({
      id: 'bt-' + Math.random().toString(36).slice(2, 9),
      mode, phaseIdx: r.phase ? r.phase - 1 : -1,
      band: r.dist ? bandIndexForMax(bands, r.dist[1]) : -1,
      patternId: r.to, inclusive: 0, exclusive: 99, desc: descBits.join(' · '),
    });
    if (special && kind === 'boss' && !e.specialModePatternIds.includes(r.to))
      e.specialModePatternIds.push(r.to);
  }
  return e;
}

// ── 4) 파일 출력 ─────────────────────────────────
mkdirSync(join(OUT, '보스'), { recursive: true });
mkdirSync(join(OUT, '몬스터'), { recursive: true });

for (const [id, def] of Object.entries(DEFS)) {
  if (id === 'haru' || id === 'swarm_unit' || def.isHero) continue;
  const e = convertEntity(def);
  const sub = e.kind === 'boss' ? '보스' : '몬스터';
  const file = join(OUT, sub, safe(e.name) + '.json');
  writeFileSync(file, JSON.stringify(e, null, 2), 'utf8');
  report.converted.push(`${sub}/${safe(e.name)}.json  (패턴 ${e.patterns.length}, BT ${e.bt.length})`);
}

console.log('=== 변환 완료 ===');
report.converted.forEach((l) => console.log('  ✔', l));
console.log(`\n=== 스킵된 패턴 (보류 시스템) ${report.dropped.length}개 ===`);
report.dropped.forEach((l) => console.log('  -', l));
