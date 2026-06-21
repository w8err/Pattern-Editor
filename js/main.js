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
      const data = await store.readJson(node.handle);
      inspector.load(model.deserialize(JSON.stringify(data)), node);
    } catch (err) {
      toast('파일 읽기 실패: ' + err.message, true);
    }
  },
});

const inspector = new Inspector($('#inspector'), {
  onSave: async (entity, fileNode) => {
    try {
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
});

// ── 툴바 ─────────────────────────────────────────
$('#btn-open').onclick = openFolder;
$('#btn-newfolder').onclick = () => tree.newFolder();
$('#btn-newboss').onclick = () => tree.newEntity('boss');
$('#btn-newmonster').onclick = () => tree.newEntity('monster');
$('#btn-newuser').onclick = () => tree.newEntity('user');
$('#btn-del').onclick = () => tree.deleteSelected();

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

async function mountRoot(handle) {
  if (!(await store.verifyPermission(handle, true))) { toast('폴더 권한이 필요합니다', true); return; }
  const node = await store.buildTree(handle, null);
  tree.setRoot(node);
  $('#root-name').textContent = handle.name;
  setReady(true);
  await refreshUsers();
}

// 트리에서 kind:'user' 파일을 모아 플레이백 AI 드롭다운에 전달
async function refreshUsers() {
  const users = [];
  const walk = async (n) => {
    if (!n) return;
    if (n.kind === 'file') {
      try { const d = await store.readJson(n.handle); if (d.kind === 'user') users.push({ name: n.name.replace(/\.json$/, ''), data: model.deserialize(JSON.stringify(d)) }); } catch {}
    }
    for (const c of n.children ?? []) await walk(c);
  };
  await walk(tree.rootNode);
  playback.setUsers(users);
}

// ── 세션 복원: 이전에 연 폴더 재연결 ──────────────
async function tryRestore() {
  if (!store.isSupported()) { $('#hint').textContent = '⚠ 크롬/엣지에서 localhost로 실행하세요 (File System Access API 필요)'; return; }
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
  for (const id of ['#btn-newfolder', '#btn-newboss', '#btn-newmonster', '#btn-newuser', '#btn-del'])
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

setReady(false);
tryRestore();
