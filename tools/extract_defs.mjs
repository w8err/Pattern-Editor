// 기존 데이터의 인라인 투사체/지형 값 → 엔티티 정의(defId 참조)로 추출 (1회성)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uid } from '../js/model.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function findOrAddProj(ent, ev) {
  const key = (p) => `${p.damage}|${p.speed}|${p.lifetime}|${p.homing}`;
  const want = { damage: ev.damage ?? 50, speed: ev.speed ?? 12, lifetime: ev.lifetime ?? 1.5, homing: ev.homing ?? 0 };
  let def = ent.projectiles.find((p) => key(p) === key(want));
  if (!def) { def = { id: uid(), name: `투사체 ${want.damage}뎀`, ...want }; ent.projectiles.push(def); }
  return def.id;
}
function findOrAddTerrain(ent, ev) {
  const key = (t) => `${t.terrain}|${t.size}|${t.duration}`;
  const want = { terrain: ev.terrain ?? '둔화', size: ev.size ?? 4, duration: ev.duration ?? 4 };
  let def = ent.terrains.find((t) => key(t) === key(want));
  if (!def) { def = { id: uid(), name: `${want.terrain} ${want.size}m/${want.duration}s`, ...want }; ent.terrains.push(def); }
  return def.id;
}

function convEvent(ent, ev) {
  if (ev.type === '투사체' && ev.defId == null && ev.damage != null) {
    ev.defId = findOrAddProj(ent, ev);
    delete ev.damage; delete ev.speed; delete ev.lifetime; delete ev.homing;
  }
  if (ev.type === '지형' && ev.defId == null && ev.terrain != null) {
    ev.defId = findOrAddTerrain(ent, ev);
    delete ev.terrain; delete ev.size; delete ev.duration;
  }
  for (const s of ev.sub || []) convEvent(ent, s);
}

let n = 0;
for (const sub of ['보스', '몬스터']) {
  for (const f of readdirSync(join(DATA, sub))) {
    const path = join(DATA, sub, f);
    const ent = JSON.parse(readFileSync(path, 'utf8'));
    ent.projectiles ??= []; ent.terrains ??= [];
    for (const p of ent.patterns) for (const ev of p.events) convEvent(ent, ev);
    writeFileSync(path, JSON.stringify(ent, null, 2), 'utf8');
    if (ent.projectiles.length || ent.terrains.length) {
      console.log(`${sub}/${f}: 투사체정의 ${ent.projectiles.length}, 지형정의 ${ent.terrains.length}`);
      n++;
    }
  }
}
console.log(`완료 — ${n}개 엔티티에 정의 생성`);
