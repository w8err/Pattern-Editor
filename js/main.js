// ============================================================
//  BB 몬스터 패턴 에디터 — 엔트리
//  ①단계: 폴더 열기 → 디렉토리 트리 → 엔티티 생성/선택/저장
// ============================================================
import * as store from './storage.js';
import * as model from './model.js';
import { TreeView } from './ui/tree.js';
import { Inspector } from './ui/inspector.js';
import { Playback } from './ui/stage.js';

const $ = (s) => document.querySelector(s);

const playback = new Playback({
  canvas: $('#pb-canvas'), controls: $('#pb-controls'),
  hud: $('#pb-hud'), scrub: $('#pb-scrub'),
});

const tree = new TreeView($('#tree'), {
  onSelectFile: async (node) => {
    if (node === inspector.fileNode) return; // 이미 열려있는 파일 → 재로딩으로 편집 날리지 않음
    // 미저장 변경 보호: 다른 파일로 이동 시 경고(취소 시 현재 파일·편집 유지)
    if (inspector.dirty && inspector.fileNode) {
      const ok = confirm('저장하지 않은 변경이 있습니다.\n\n확인 = 저장 후 이동\n취소 = 현재 파일에 머무름(편집 유지)');
      if (!ok) { tree.reselect(inspector.fileNode); return; }
      await inspector.save();
    }
    try {
      const data = await readEntity(node);
      inspector.load(model.deserialize(JSON.stringify(data)), node);
    } catch (err) {
      toast('파일 읽기 실패: ' + err.message, true);
    }
  },
  onChange: () => syncManifest(), // 생성/삭제 후 manifest 자동 갱신
});

// 로컬(소유자) 폴더의 data/manifest.json을 실제 트리에 맞춰 다시 씀.
//  파일 생성/삭제/이름변경 때마다 호출 → '수동 gen-manifest 깜빡' 사고 방지.
//  웹 모드(fetch 읽기 전용)에선 쓸 수 없으므로 건너뜀.
async function syncManifest() {
  if (webMode || !localHandle) return;
  try { await store.regenManifest(localHandle); }
  catch (err) { toast('manifest 갱신 실패: ' + err.message, true); }
}

const inspector = new Inspector($('#inspector'), {
  onSave: async (entity, fileNode) => {
    try {
      // 기본 유저(가상 노드): 파일 없이 localStorage에 보존
      if (fileNode?.virtual === 'default-user') {
        store.saveDefaultUser(model.serialize(entity));
        playback.setDefaultUser(defaultUserEntity());
        toast('기본 유저 저장됨 (이 브라우저에 보존)');
        return;
      }
      // 웹 보기 모드: 서버에 못 쓰므로 이 브라우저(localStorage)에만 임시 저장
      if (fileNode?.web) {
        store.saveWebEdit(fileNode.path, model.serialize(entity));
        await refreshUsers();
        refreshModeUI('web');
        toast('이 브라우저에 임시 저장됨 (공유 안 됨)');
        return;
      }
      // 이름이 바뀌면 파일명도 동기화(rename)
      const text = model.serialize(entity);
      await store.renameFile(fileNode.parent.handle, fileNode.name, entity.name, text);
      await tree.refresh();
      await syncManifest();   // 이름 변경 시 manifest의 path·name 동기화
      await refreshUsers();   // 유저 데이터 변경 반영(AI 드롭다운)
      toast('저장됨: ' + entity.name);
    } catch (err) {
      toast('저장 실패: ' + err.message, true);
    }
  },
  onEntityLoad: (entity) => playback.setEntity(entity),
  onPatternSelect: (pattern) => playback.setPattern(pattern),
  onDirtyChange: (fileNode, dirty) => tree.setDirty(fileNode, dirty), // 미저장 표시
});

// ── 기본 유저(하루): 폴더 없이 편집 가능, localStorage 보존 ──
//  저장된 값이 있으면 그걸, 없으면 코드 기본값(newUser). ✎ 버튼으로 편집.
function defaultUserEntity() {
  const raw = store.loadDefaultUserRaw();
  if (raw) { try { return model.deserialize(raw); } catch {} }
  const u = model.newUser(); u.name = '기본 유저(하루)';
  return u;
}
playback.setDefaultUser(defaultUserEntity());
playback.onEditDefaultUser = () => {
  inspector.load(defaultUserEntity(), { virtual: 'default-user', name: '기본 유저' });
};

// ── 모드 세그먼트(배포/로컬) ──────────────────────
$('#mode-web').onclick = () => setMode('web');
$('#mode-local').onclick = () => setMode('local');
$('#btn-web-reset').onclick = async () => {
  if (!confirm('이 브라우저의 임시 편집을 모두 초기화할까요? (배포 데이터로 되돌아갑니다)')) return;
  store.clearWebEdits();
  inspector.entity = null; inspector.fileNode = null;
  inspector.el.innerHTML = '<div class="insp-empty">엔티티를 선택하세요</div>';
  await setMode('web');
  toast('로컬 편집 초기화됨');
};

// ── 툴바 ─────────────────────────────────────────
$('#btn-open').onclick = openFolder;
$('#btn-newfolder').onclick = () => tree.newFolder();
$('#btn-newboss').onclick = () => tree.newEntity('boss');
$('#btn-newmonster').onclick = () => tree.newEntity('monster');
$('#btn-newuser').onclick = () => tree.newEntity('user');
$('#btn-del').onclick = () => tree.deleteSelected();

// 확장 그룹 토글(버튼 오른쪽으로 하위 목록 펼침)
function makeExpander(btnSel, menuSel) {
  const btn = $(btnSel), menu = $(menuSel);
  btn.onclick = () => {
    const open = menu.hasAttribute('hidden');
    menu.toggleAttribute('hidden', !open);
    btn.classList.toggle('open', open);
  };
}
makeExpander('#btn-create', '#create-menu');
makeExpander('#btn-userdata', '#userdata-menu');

async function openFolder() {
  if (!store.isSupported()) {
    toast('이 브라우저는 File System Access API 미지원 (크롬/엣지 권장)', true);
    return;
  }
  try {
    const handle = await store.pickRoot();
    await mountRoot(handle);
  } catch (err) {
    if (err.name !== 'AbortError') toast('폴더 열기 실패: ' + err.message, true);
  }
}

// ── 데이터 소스 모드 ──────────────────────────────
//  'web'   = 배포 data/ (fetch 읽기 전용, 편집은 localStorage 오버레이)
//  'local' = 로컬 폴더 (FSA, 실제 .json 읽기/쓰기) — 소유자/편집자
let webMode = false;       // web 모드 여부(읽기 경로 분기에 사용)
let localHandle = null;    // 현재/마지막으로 연 로컬 폴더 핸들

// 모드 전환의 단일 진입점. 세그먼트 버튼·부팅·초기화에서 모두 이걸 호출.
async function setMode(mode) {
  if (mode === 'web') {
    const ok = await tryLoadWeb();
    if (!ok) { toast('배포 데이터를 불러올 수 없습니다 (data/manifest.json 없음)', true); refreshModeUI('local'); return; }
  } else {
    webMode = false;
    if (localHandle) await mountRoot(localHandle); // 이미 연 폴더가 있으면 그대로 다시 로드
    else showLocalEmpty();                          // 없으면 폴더 열기 유도
  }
  refreshModeUI(mode);
}

async function mountRoot(handle) {
  if (!(await store.verifyPermission(handle, true))) { toast('폴더 권한이 필요합니다', true); return; }
  const node = await store.buildTree(handle, null);
  webMode = false; localHandle = handle;
  tree.setRoot(node);
  $('#root-name').textContent = handle.name;
  $('#hint').textContent = '';
  setReady(true);
  await refreshUsers();
  refreshModeUI('local');
}

// 로컬 모드인데 아직 폴더를 안 연 상태 — 빈 트리 + 안내
function showLocalEmpty() {
  tree.setRoot(null);
  tree.el.innerHTML = '<div class="tree-empty">📂 폴더를 열어 로컬 데이터를 편집하세요</div>';
  $('#root-name').textContent = '';
  $('#hint').textContent = '';
  setReady(false);
  playback.setUsers([]);
}

// 배포 사이트의 data/ 자동 로드(폴더 열기 없이 보기/플레이테스트). 성공 시 true.
async function tryLoadWeb() {
  const man = await store.fetchManifest();
  if (!man) return false;
  webMode = true;
  tree.setRoot(store.buildTreeFromManifest(man));
  $('#root-name').textContent = ''; // 세그먼트가 이미 '배포 데이터'를 표시 → 중복 라벨 제거
  $('#hint').textContent = '읽기 전용 · 편집은 이 브라우저에만 저장(공유 안 됨)';
  setReady(false); // 생성/삭제(파일 쓰기) 불가 — 편집·저장(localStorage)은 가능
  await refreshUsers();
  return true;
}

// 모드 세그먼트 하이라이트 + 액션 버튼(폴더 열기/다시 열기/편집 초기화) 노출 정리
function refreshModeUI(mode) {
  $('#mode-web').classList.toggle('on', mode === 'web');
  $('#mode-local').classList.toggle('on', mode === 'local');
  const mounted = mode === 'local' && !!localHandle;
  // 폴더 열기: 로컬 모드에서만. 미연결이면 primary로 강조.
  const open = $('#btn-open');
  open.style.display = mode === 'local' ? '' : 'none';
  open.classList.toggle('primary', !mounted);
  open.textContent = mounted ? '📂 다른 폴더' : '📂 폴더 열기';
  // 다시 열기: 로컬 모드 + 저장된 폴더 있고 + 아직 미연결일 때만(아래 tryRestore에서 표시 토글)
  if (mode !== 'local' || mounted) $('#btn-reconnect').style.display = 'none';
  else if (savedRoot) $('#btn-reconnect').style.display = '';
  // 로컬 편집 초기화: web 모드 + 오버레이 있을 때만
  $('#btn-web-reset').style.display = (mode === 'web' && store.hasWebEdits()) ? '' : 'none';
}

// 파일 노드 읽기 — 웹(fetch/오버레이) vs FSA(handle) 통합
async function readEntity(node) {
  if (node.web) {
    const edits = store.loadWebEdits();
    if (edits[node.path]) return JSON.parse(edits[node.path]);
    return store.fetchEntity(node.path);
  }
  return store.readJson(node.handle);
}

// 트리에서 kind:'user' 파일을 모아 플레이백 AI 드롭다운에 전달
async function refreshUsers() {
  const users = [];
  const walk = async (n) => {
    if (!n) return;
    if (n.kind === 'file' && !(n.web && n.entKind && n.entKind !== 'user')) { // 웹은 manifest의 entKind로 미리 거름
      try { const d = await readEntity(n); if (d.kind === 'user') users.push({ name: n.name.replace(/\.json$/, ''), data: model.deserialize(JSON.stringify(d)) }); } catch {}
    }
    for (const c of n.children ?? []) await walk(c);
  };
  await walk(tree.rootNode);
  playback.setUsers(users);
}

// ── 세션 복원: 이전에 연 폴더 재연결(소유자/편집자) ──
let savedRoot = null; // 이전에 연 폴더 핸들(있으면 '다시 열기' 버튼 노출)
async function tryRestore() {
  if (!store.isSupported()) return;
  savedRoot = await store.getSavedRoot();
  if (savedRoot) {
    const btn = $('#btn-reconnect');
    btn.textContent = `↻ 다시 열기: ${savedRoot.name}`;
    btn.onclick = async () => {
      try { await mountRoot(savedRoot); } catch (err) { toast('재연결 실패: ' + err.message, true); }
    };
  }
}

function setReady(on) {
  for (const id of ['#btn-create', '#btn-newfolder', '#btn-newboss', '#btn-newmonster', '#btn-newuser', '#btn-del'])
    $(id).disabled = !on;
}

// ── 토스트 ───────────────────────────────────────
let toastTimer = null;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
}

// ── 단축키: Ctrl+S 로 현재 열린 엔티티 저장 ────────
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (inspector.entity && inspector.fileNode) inspector.save();
    else toast('저장할 파일이 없습니다', true);
  }
});

// ── 패널 크기 조절(좌우 드래그) ───────────────────
function makeResizer(handle, panel, grow) { // grow: 'left'=+dx, 'right'=-dx
  let sx = 0, sw = 0, on = false;
  handle.addEventListener('mousedown', (e) => { on = true; sx = e.clientX; sw = panel.getBoundingClientRect().width; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!on) return;
    const dx = e.clientX - sx, w = Math.max(200, Math.min(window.innerWidth - 320, grow === 'left' ? sw + dx : sw - dx));
    panel.style.width = w + 'px'; panel.style.flexBasis = w + 'px';
    playback.resize(); playback.render();
  });
  window.addEventListener('mouseup', () => { if (on) { on = false; document.body.style.cursor = ''; playback.resize(); playback.render(); } });
}
makeResizer($('#rsz-side'), $('#sidebar'), 'left');
makeResizer($('#rsz-stage'), $('#stage'), 'right');

// ── 부팅: 이전 폴더 재연결 버튼 준비 → 배포 데이터로 시작 ──
setReady(false);
boot();
async function boot() {
  await tryRestore();                  // 소유자: 이전 폴더 기록 확인(다시 열기 버튼 준비)
  const web = await tryLoadWeb();      // 기본 진입: 배포 data/ 자동 로드(보기·플레이테스트·로컬 편집)
  if (web) {
    refreshModeUI('web');
  } else if (savedRoot) {
    await setMode('local');            // 배포 데이터 없으나 이전 로컬 폴더 있음 → 로컬 모드로
  } else {
    refreshModeUI('local'); showLocalEmpty();
    if (!store.isSupported())
      $('#hint').textContent = '⚠ 데이터를 불러올 수 없습니다 (배포 사이트 또는 로컬 서버에서 실행하세요)';
  }
}
