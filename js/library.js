// ============================================================
//  공유 정의 레지스트리 (투사체/지형)
//  · 정의는 두 문서 파일에 산다: data/투사체.json(kind:'projectiles'), data/지형.json(kind:'terrains').
//    각 문서 = { schema, kind, items:[ 정의… ] }.
//  · 이 모듈은 그 두 문서 객체의 "참조"만 들고 있다(메모리 단일 출처). 편집/저장은 일반 파일 흐름.
//  · resolve/list: 라이브러리 우선 → 엔티티 로컬(레거시) 폴백(이전 전까지 안 깨지게).
// ============================================================
import * as model from './model.js';

let _proj = { items: [] }; // 투사체.json 문서 객체
let _terr = { items: [] }; // 지형.json 문서 객체

export function registerProjDoc(doc) { if (doc) { doc.items ??= []; _proj = doc; } }
export function registerTerrDoc(doc) { if (doc) { doc.items ??= []; _terr = doc; } }
export function projItems() { return _proj.items; }
export function terrItems() { return _terr.items; }
export function resetDocs() { _proj = { items: [] }; _terr = { items: [] }; } // 모드/폴더 전환 시

export function resolveProj(defId, entity) {
  return _proj.items.find((d) => d.id === defId) || (entity?.projectiles || []).find((d) => d.id === defId) || null;
}
export function resolveTerr(defId, entity) {
  return _terr.items.find((d) => d.id === defId) || (entity?.terrains || []).find((d) => d.id === defId) || null;
}
function _merge(libItems, localList) {
  const out = libItems.slice();
  for (const d of (localList || [])) if (!libItems.some((x) => x.id === d.id)) out.push({ ...d, _legacy: true });
  return out;
}
export function listProj(entity) { return _merge(_proj.items, entity?.projectiles); }
export function listTerr(entity) { return _merge(_terr.items, entity?.terrains); }
export function hasLocalDefs(entity) { return !!((entity?.projectiles || []).length || (entity?.terrains || []).length); }

// 엔티티의 로컬(레거시) 정의를 두 문서로 이전 + 이벤트 defId 리매핑 + 키 제거.
//  이름+내용 동일하면 재사용(중복 안 만듦). 반환: { added(문서 추가 수), hadLocal }.
export function migrateEntity(entity) {
  const same = (a, b) => { const s = (o) => JSON.stringify({ ...o, id: 0, _legacy: 0 }); return s(a) === s(b); };
  let added = 0;
  const lift = (localList, items) => {
    const map = {};
    for (const d of (localList || [])) {
      const ex = items.find((t) => same(t, d));
      if (ex) { map[d.id] = ex.id; continue; }
      const nd = { ...d }; nd.id = model.uid(); delete nd._legacy; items.push(nd); map[d.id] = nd.id; added++;
    }
    return map;
  };
  const hadLocal = hasLocalDefs(entity);
  const pm = lift(entity.projectiles, _proj.items);
  const tm = lift(entity.terrains, _terr.items);
  const all = (entity.patterns || []).flatMap((p) => [...p.events, ...p.events.flatMap((e) => e.sub || [])]);
  for (const e of all) {
    if (e.type === '투사체' && e.defId && pm[e.defId]) e.defId = pm[e.defId];
    if (e.type === '지형' && e.defId && tm[e.defId]) e.defId = tm[e.defId];
  }
  delete entity.projectiles; delete entity.terrains; // 몬스터 데이터에서 정의 제거
  return { added, hadLocal };
}
