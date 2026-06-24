// ============================================================
//  드래그로 리스트 순서 변경 (패턴 리스트 · BT 표 공용)
//  · 각 행 안의 .drag-handle 을 잡고 끌면 그 위치로 이동.
//  · rowEls 와 arr 는 같은 순서/길이여야 함. 적용 후 onReorder() 로 재렌더.
//  · 표(tr)·div 리스트 모두 동작(포인터 Y 기준 삽입 위치 계산).
// ============================================================
export function enableDragSort(rowEls, arr, onReorder) {
  const clear = () => rowEls.forEach((r) => r.classList.remove('drag-over', 'drag-over-end'));
  rowEls.forEach((el, idx) => {
    const handle = el.querySelector('.drag-handle');
    if (!handle) return;
    handle.addEventListener('click', (e) => e.stopPropagation()); // 핸들 클릭이 행 선택 토글로 새지 않게
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      let to = idx; // 삽입 위치(이 인덱스 "앞"). rowEls.length = 맨 끝.
      el.classList.add('dragging');
      const onMove = (ev) => {
        to = rowEls.length;
        for (let i = 0; i < rowEls.length; i++) {
          const rc = rowEls[i].getBoundingClientRect();
          if (ev.clientY < rc.top + rc.height / 2) { to = i; break; }
        }
        clear();
        if (to < rowEls.length) rowEls[to].classList.add('drag-over');
        else rowEls[rowEls.length - 1].classList.add('drag-over-end');
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        el.classList.remove('dragging'); clear();
        const insertAt = idx < to ? to - 1 : to; // from 제거 후 보정
        if (insertAt !== idx) { const [it] = arr.splice(idx, 1); arr.splice(insertAt, 0, it); onReorder(); }
        // 이동 없음(그냥 클릭) → DOM 원상복귀만 하고 재렌더/변경표시 안 함
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}
