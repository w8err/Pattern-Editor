// ============================================================
//  data/manifest.json 생성기
//  웹(정적 호스팅)에선 fetch가 디렉토리 목록을 못 읽으므로,
//  data/ 안의 모든 엔티티 .json 경로·종류를 manifest로 적어 둔다.
//  → 웹 팀원이 폴더 열기 없이 배포 데이터를 자동 로드(읽기)할 수 있게.
//
//  사용:  node tools/gen-manifest.mjs
//  ※ data/ 에 파일을 추가/삭제/이름변경한 뒤엔 다시 실행하고 함께 커밋할 것.
// ============================================================
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATA = join(ROOT, 'data');

async function walk(dir, out) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) { await walk(p, out); continue; }
    if (!name.endsWith('.json') || name === 'manifest.json') continue;
    let kind = null, ename = name.replace(/\.json$/, '');
    try { const d = JSON.parse(await readFile(p, 'utf8')); kind = d.kind || null; if (d.name) ename = d.name; } catch {}
    // 경로는 data/ 기준 상대 + 슬래시 통일
    out.push({ path: relative(DATA, p).split('\\').join('/'), kind, name: ename });
  }
}

const files = [];
await walk(DATA, files);
files.sort((a, b) => a.path.localeCompare(b.path, 'ko'));
const manifest = { count: files.length, files }; // generated(타임스탬프) 제외 — 목록 같으면 diff 0
await writeFile(join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`manifest.json 생성: ${files.length}개 파일`);
for (const f of files) console.log(`  · ${f.path}  [${f.kind || '?'}]`);
