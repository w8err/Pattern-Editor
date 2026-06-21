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
    else if (name.endsWith('.json')) files.push(h);
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
