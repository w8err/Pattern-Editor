// ============================================================
//  영속화 레이어 — File System Access API
//  · 사용자가 루트 폴더 선택 → 그 폴더를 실제 디렉토리로 사용
//  · 엔티티 1개 = .json 파일 1개, 폴더는 자유 분류(중첩 가능)
//  · 보안 컨텍스트 필요(https 또는 localhost). file:// 에선 동작 안 함.
// ============================================================

const SUPPORTED = 'showDirectoryPicker' in window;
const IDB_DB = 'bb-editor', IDB_STORE = 'handles', IDB_KEY = 'root';

export function isSupported() { return SUPPORTED; }

// ── 루트 핸들 IndexedDB 보존(세션 간 폴더 기억) ───
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const rq = tx.objectStore(IDB_STORE).get(key);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}

export async function getSavedRoot() {
  try { return (await idbGet(IDB_KEY)) || null; } catch { return null; }
}

// ── 기본 유저 데이터(폴더 없이 편집) — localStorage 보존 ───
//  파일/FSA 없이도 수정·저장 가능. 이 브라우저에만 보존됨.
const LS_DEFAULT_USER = 'bb-editor:default-user';
export function loadDefaultUserRaw() {
  try { return localStorage.getItem(LS_DEFAULT_USER); } catch { return null; }
}
export function saveDefaultUser(text) {
  try { localStorage.setItem(LS_DEFAULT_USER, text); return true; } catch { return false; }
}
export function resetDefaultUser() {
  try { localStorage.removeItem(LS_DEFAULT_USER); } catch {}
}

// ── 웹(정적 호스팅) 데이터 소스 — fetch 읽기 전용 ───
//  배포 사이트의 data/manifest.json + 각 .json 을 읽어 트리 구성.
//  편집/저장은 불가(서버에 못 씀) → 편집분은 localStorage 오버레이로 이 브라우저에만 보존.
export async function fetchManifest() {
  try { const r = await fetch('data/manifest.json', { cache: 'no-cache' }); if (!r.ok) return null; return await r.json(); }
  catch { return null; }
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
export async function fetchEntity(path) {
  const r = await fetch('data/' + encPath(path));
  if (!r.ok) throw new Error('불러오기 실패: ' + path);
  return await r.json();
}
// manifest → 트리(node.web=true, handle 없음). file 노드엔 path·entKind 보존.
export function buildTreeFromManifest(manifest, rootName = '📦 배포 데이터') {
  const root = { name: rootName, kind: 'dir', web: true, parent: null, children: [] };
  for (const f of manifest.files || []) {
    const parts = f.path.split('/'); let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let d = cur.children.find((c) => c.kind === 'dir' && c.name === parts[i]);
      if (!d) { d = { name: parts[i], kind: 'dir', web: true, parent: cur, children: [] }; cur.children.push(d); }
      cur = d;
    }
    cur.children.push({ name: parts[parts.length - 1], kind: 'file', web: true, path: f.path, entKind: f.kind, parent: cur });
  }
  const sort = (n) => { n.children?.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'ko') : a.kind === 'dir' ? -1 : 1)); n.children?.forEach(sort); };
  sort(root);
  return root;
}

// 웹 보기 모드의 편집 오버레이(localStorage) — path별 직렬화 텍스트. 공유 안 됨.
const LS_WEB_EDITS = 'bb-editor:web-edits';
export function loadWebEdits() { try { return JSON.parse(localStorage.getItem(LS_WEB_EDITS) || '{}'); } catch { return {}; } }
export function saveWebEdit(path, text) {
  const m = loadWebEdits(); m[path] = text;
  try { localStorage.setItem(LS_WEB_EDITS, JSON.stringify(m)); return true; } catch { return false; }
}
export function hasWebEdits() { try { return Object.keys(loadWebEdits()).length > 0; } catch { return false; } }
export function clearWebEdits() { try { localStorage.removeItem(LS_WEB_EDITS); } catch {} }

// ── 권한 ─────────────────────────────────────────
export async function verifyPermission(handle, write = true) {
  const opts = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

// ── 루트 선택 ────────────────────────────────────
export async function pickRoot() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbPut(IDB_KEY, handle);
  return handle;
}

// ── 트리 빌드(폴더/파일 재귀) ─────────────────────
//  node = { name, kind:'dir'|'file', handle, parent, children? }
export async function buildTree(dirHandle, parent = null) {
  const node = { name: dirHandle.name, kind: 'dir', handle: dirHandle, parent, children: [] };
  const dirs = [], files = [];
  for await (const [name, h] of dirHandle.entries()) {
    if (h.kind === 'directory') dirs.push(h);
    else if (name.endsWith('.json') && name !== 'manifest.json') files.push(h); // manifest는 엔티티 아님
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  for (const d of dirs) node.children.push(await buildTree(d, node));
  for (const f of files) node.children.push({ name: f.name, kind: 'file', handle: f, parent: node });
  return node;
}

// ── 읽기/쓰기 ────────────────────────────────────
export async function readJson(fileHandle) {
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

export async function writeFile(fileHandle, text) {
  const w = await fileHandle.createWritable();
  await w.write(text);
  await w.close();
}

// 안전 파일명(이름 → 파일명). 중복 시 호출측에서 처리.
function fileNameFor(name) {
  const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || '무제';
  return safe.endsWith('.json') ? safe : safe + '.json';
}

export async function createEntityFile(dirHandle, entity, text) {
  const fname = fileNameFor(entity.name);
  const fh = await dirHandle.getFileHandle(fname, { create: true });
  await writeFile(fh, text);
  return fh;
}

// 루트의 고정 이름 파일(정의 문서 등)이 없으면 기본 내용으로 생성. 생성했으면 true.
export async function ensureRootFile(rootHandle, name, defaultText) {
  try { await rootHandle.getFileHandle(name); return false; }
  catch { const fh = await rootHandle.getFileHandle(name, { create: true }); await writeFile(fh, defaultText); return true; }
}

export async function createFolder(dirHandle, name) {
  const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || '새폴더';
  return dirHandle.getDirectoryHandle(safe, { create: true });
}

export async function removeEntry(dirHandle, name, recursive = false) {
  await dirHandle.removeEntry(name, { recursive });
}

// 파일 이름 변경(rename = 신규 생성 + 기존 삭제). 폴더 rename은 추후.
export async function renameFile(dirHandle, oldName, newName, text) {
  const fh = await dirHandle.getFileHandle(fileNameFor(newName), { create: true });
  await writeFile(fh, text);
  if (fileNameFor(newName) !== oldName) await dirHandle.removeEntry(oldName);
  return fh;
}

// ── manifest 자동 갱신(FSA) ───────────────────────
//  tools/gen-manifest.mjs 의 브라우저판. 로컬 폴더(소유자)에서 파일을
//  생성/삭제/이름변경한 뒤 호출 → data/manifest.json 을 실제 트리에 맞춰 다시 씀.
//  (웹 모드는 fetch 읽기 전용이라 호출하지 않음)
export async function regenManifest(rootHandle) {
  const files = [];
  const walk = async (dirHandle, prefix) => {
    const ents = [];
    for await (const [name, h] of dirHandle.entries()) ents.push([name, h]);
    for (const [name, h] of ents) {
      const rel = prefix ? prefix + '/' + name : name;
      if (h.kind === 'directory') { await walk(h, rel); continue; }
      if (!name.endsWith('.json') || name === 'manifest.json') continue; // manifest는 엔티티 아님
      let kind = null, ename = name.replace(/\.json$/, '');
      try { const d = JSON.parse(await (await h.getFile()).text()); kind = d.kind || null; if (d.name) ename = d.name; } catch {}
      files.push({ path: rel, kind, name: ename });
    }
  };
  await walk(rootHandle, '');
  files.sort((a, b) => a.path.localeCompare(b.path, 'ko'));
  const manifest = { count: files.length, files }; // generated(타임스탬프) 제외 — 목록 같으면 diff 0
  const fh = await rootHandle.getFileHandle('manifest.json', { create: true });
  await writeFile(fh, JSON.stringify(manifest, null, 2) + '\n');
  return files.length;
}
