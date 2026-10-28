import { renderMarkdown } from "./render";

const el = () => document.getElementById("viewer") as HTMLElement;

export function showView(text: string, scroll = 0) {
  const v = el();
  v.innerHTML = renderMarkdown(text); // html:false 로 렌더된 결과만 넣음
  v.scrollTop = scroll;
}

export const viewScroll = () => el().scrollTop;

// 본문 링크는 앱 안에서 이동하지 않도록 막고, 체크박스 클릭은 줄 번호로 알린다.
export function initViewer(onCheckbox: (line: number) => void) {
  el().addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("a")) e.preventDefault();
    if (target instanceof HTMLInputElement && target.classList.contains("task-list-item-checkbox")) {
      e.preventDefault(); // 화면 상태는 다시 렌더링해서 맞춘다
      const line = Number(target.dataset.line);
      if (Number.isInteger(line)) onCheckbox(line);
    }
  });
}
