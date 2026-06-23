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
    try {
      const data = await readEntity(node);
      inspector.load(model.deserialize(JSON.stringify(data)), node);
    } catch (err) {
      toast('파일 읽기 실패: ' + err.message, true);
    }
  },
});

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
        updateWebResetBtn();
        toast('이 브라우저에 임시 저장됨 (공유 안 됨)');
        return;
      }
      // 이름이 바뀌면 파일명도 동기화(rename)
      const text = model.serialize(entity);
      await store.renameFile(fileNode.parent.handle, fileNode.name, entity.name, text);
      await tree.refresh();
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

let webMode = false; // 웹(fetch 읽기 전용) 모드 — 폴더 미연결, 편집은 localStorage에만

async function mountRoot(handle) {
  if (!(await store.verifyPermission(handle, true))) { toast('폴더 권한이 필요합니다', true); return; }
  const node = await store.buildTree(handle, null);
  webMode = false; updateWebResetBtn();
  tree.setRoot(node);
  $('#root-name').textContent = handle.name;
  $('#hint').textContent = '';
  setReady(true);
  await refreshUsers();
}

// 배포 사이트의 data/ 자동 로드(폴더 열기 없이 보기/플레이테스트). 성공 시 true.
async function tryLoadWeb() {
  const man = await store.fetchManifest();
  if (!man) return false;
  webMode = true;
  tree.setRoot(store.buildTreeFromManifest(man));
  $('#root-name').textContent = '📦 배포 데이터';
  $('#hint').textContent = '읽기 전용 · 편집은 이 브라우저에만 저장(공유 안 됨)';
  setReady(false); // 생성/삭제(파일 쓰기) 불가 — 편집·저장(localStorage)은 가능
  await refreshUsers();
  updateWebResetBtn();
  return true;
}

// 웹 편집 초기화 버튼(있을 때만 노출)
function updateWebResetBtn() {
  let btn = $('#btn-web-reset');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btn-web-reset'; btn.className = 'btn';
    btn.textContent = '↺ 로컬 편집 초기화';
    btn.title = '이 브라우저에 임시 저장한 편집을 모두 지우고 배포 데이터로 되돌림';
    btn.onclick = async () => {
      if (!confirm('이 브라우저의 임시 편집을 모두 초기화할까요? (배포 데이터로 되돌아갑니다)')) return;
      store.clearWebEdits();
      inspector.entity = null; inspector.fileNode = null;
      inspector.el.innerHTML = '<div class="insp-empty">엔티티를 선택하세요</div>';
      await tryLoadWeb();
      toast('로컬 편집 초기화됨');
    };
    $('#root-name').after(btn);
  }
  btn.style.display = (webMode && store.hasWebEdits()) ? '' : 'none';
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
async function tryRestore() {
  if (!store.isSupported()) return;
  const saved = await store.getSavedRoot();
  if (saved) {
    const btn = $('#btn-reconnect');
    btn.style.display = '';
    btn.textContent = `↻ 다시 열기: ${saved.name}`;
    btn.onclick = async () => {
      try { await mountRoot(saved); } catch (err) { toast('재연결 실패: ' + err.message, true); }
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

// ── 부팅: 배포 데이터 자동 로드 → (소유자) 폴더 재연결 버튼 ──
setReady(false);
boot();
async function boot() {
  const web = await tryLoadWeb();                 // 웹 팀원: data/ 자동 로드(보기·플레이테스트·로컬 편집)
  await tryRestore();                             // 소유자: 이전 폴더 재연결 버튼 노출
  if (!web && !store.isSupported())
    $('#hint').textContent = '⚠ 데이터를 불러올 수 없습니다 (배포 사이트 또는 로컬 서버에서 실행하세요)';
}
