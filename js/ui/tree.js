// ============================================================
//  디렉토리 트리 UI (유니티 Project 탭 스타일)
//  폴더/엔티티파일 표시 · 생성/삭제/선택. 선택 콜백으로 에디터에 전달.
// ============================================================
import * as store from '../storage.js';
import * as model from '../model.js';

export class TreeView {
  constructor(rootEl, { onSelectFile, onChange }) {
    this.el = rootEl;
    this.onSelectFile = onSelectFile;
    this.onChange = onChange; // 파일 생성/삭제 후 → main이 manifest 자동 갱신
    this.rootNode = null;
    this.selected = null;     // 선택된 node(dir 또는 file)
    this.expanded = new Set(); // 펼쳐진 dir 핸들 name 경로
    this.dirtyKey = null;      // 미저장 변경이 있는 파일 경로키(1개) — 빨간 느낌표
  }

  // 인스펙터의 미저장 상태 반영(파일 1개만 열려 편집되므로 단일 키로 충분)
  setDirty(node, dirty) {
    const key = node && node.parent ? this._key(node) : null; // 가상 노드(기본 유저)는 무시
    const next = dirty ? key : null;
    if (next === this.dirtyKey) return;
    this.dirtyKey = next;
    this.render();
  }

  setRoot(node) { this.rootNode = node; this.dirtyKey = null; this.selected = null; this.expanded.add(this._key(node)); this.render(); }

  // 선택을 특정 노드로 되돌림(미저장 보호로 이동 취소 시) — 선택 하이라이트만 복원, onSelectFile은 안 부름
  reselect(node) { this.selected = node; this.render(); }

  _key(node) { // 경로 키(이름 체인) — 펼침 상태 보존용
    const seg = []; let n = node;
    while (n) { seg.unshift(n.name); n = n.parent; }
    return seg.join('/');
  }

  // 현재 선택의 "부모 디렉토리 핸들" — 새 항목을 만들 위치
  targetDir() {
    const n = this.selected;
    if (!n) return this.rootNode?.handle ?? null;
    return n.kind === 'dir' ? n.handle : n.parent.handle;
  }
  targetDirNode() {
    const n = this.selected;
    if (!n) return this.rootNode;
    return n.kind === 'dir' ? n : n.parent;
  }

  async refresh() {
    if (!this.rootNode) return;
    const sel = this.selected ? this._key(this.selected) : null;
    this.rootNode = await store.buildTree(this.rootNode.handle, null);
    // 선택 복원
    this.selected = sel ? this._find(this.rootNode, sel) : null;
    this.render();
  }
  _find(node, key) {
    if (this._key(node) === key) return node;
    for (const c of node.children ?? []) { const r = this._find(c, key); if (r) return r; }
    return null;
  }

  render() {
    this.el.innerHTML = '';
    if (!this.rootNode) { this.el.innerHTML = '<div class="tree-empty">폴더를 열어주세요</div>'; return; }
    this.el.appendChild(this._renderNode(this.rootNode, 0));
  }

  _renderNode(node, depth) {
    const row = document.createElement('div');
    row.className = 'tree-row' + (node === this.selected ? ' sel' : '');
    row.style.paddingLeft = (depth * 14 + 6) + 'px';

    if (node.kind === 'dir') {
      const open = this.expanded.has(this._key(node));
      row.innerHTML = `<span class="tw">${open ? '▾' : '▸'}</span><span class="ti">📁</span><span class="tn">${esc(node.name)}</span>`;
      row.onclick = (e) => {
        e.stopPropagation();
        this.selected = node;
        if (open) this.expanded.delete(this._key(node)); else this.expanded.add(this._key(node));
        this.render();
      };
    } else {
      const dirty = this.dirtyKey && this._key(node) === this.dirtyKey;
      row.innerHTML = `<span class="tw"></span><span class="ti">📄${dirty ? '<i class="dirty-badge">!</i>' : ''}</span><span class="tn">${esc(node.name.replace(/\.json$/, ''))}</span>`;
      row.onclick = (e) => {
        e.stopPropagation();
        this.selected = node;
        this.render();
        this.onSelectFile?.(node);
      };
    }

    const wrap = document.createElement('div');
    wrap.appendChild(row);
    if (node.kind === 'dir' && this.expanded.has(this._key(node))) {
      for (const c of node.children ?? []) wrap.appendChild(this._renderNode(c, depth + 1));
    }
    return wrap;
  }

  // ── 액션 ───────────────────────────────────────
  async newFolder() {
    const dir = this.targetDir(); if (!dir) return;
    const name = prompt('새 폴더 이름', '새폴더'); if (!name) return;
    this.expanded.add(this._key(this.targetDirNode()));
    await store.createFolder(dir, name);
    await this.refresh();
    await this.onChange?.(); // 폴더만으론 manifest 안 바뀌지만 일관성 위해 호출
  }

  async newEntity(kind) {
    const dir = this.targetDir(); if (!dir) return;
    const ent = model.newEntity(kind);
    const label = kind === 'boss' ? '보스' : kind === 'user' ? '유저' : '몬스터';
    const name = prompt(`새 ${label} 이름`, ent.name);
    if (!name) return;
    ent.name = name;
    this.expanded.add(this._key(this.targetDirNode()));
    const fh = await store.createEntityFile(dir, ent, model.serialize(ent));
    await this.refresh();
    await this.onChange?.(); // 새 엔티티 → manifest 갱신
    // 방금 만든 파일 선택
    const node = this._findFileByName(this.rootNode, fh.name);
    if (node) { this.selected = node; this.render(); this.onSelectFile?.(node); }
  }
  _findFileByName(node, fname) {
    if (node.kind === 'file' && node.name === fname) return node;
    for (const c of node.children ?? []) { const r = this._findFileByName(c, fname); if (r) return r; }
    return null;
  }

  async deleteSelected() {
    const n = this.selected;
    if (!n || n === this.rootNode) return;
    if (n.web) { return; } // 웹(배포 데이터)은 삭제 불가
    const isDir = n.kind === 'dir';
    if (!confirm(`${isDir ? '폴더' : '파일'} "${n.name}" 삭제?${isDir ? ' (안의 내용 전부)' : ''}`)) return;
    await store.removeEntry(n.parent.handle, n.name, isDir);
    this.selected = null;
    await this.refresh();
    await this.onChange?.(); // 삭제 → manifest 갱신
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
