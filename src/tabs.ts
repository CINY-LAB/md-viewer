// 탭 상태. UI는 subscribe 로 변경을 받아 다시 그린다.
// 탭 식별은 경로가 아니라 id 로 한다 (저장 전 새 파일은 경로가 없음).
export interface Tab {
  id: number;
  path: string | null; // 저장 전 새 파일은 null
  name: string;
  text: string; // 편집 중인 현재 내용
  saved: string | null; // 마지막으로 저장된(읽은) 내용. 저장 전 새 파일은 null
  mode: "view" | "edit";
  scroll: number;
  closeArmed: boolean; // 수정 중인 탭을 닫을 때 한 번 더 누르게 하는 표시
}

const tabs: Tab[] = [];
let activeId: number | null = null;
let seq = 0;
let newSeq = 0;
const listeners: Array<() => void> = [];

export const subscribe = (fn: () => void) => listeners.push(fn);
const emit = () => listeners.forEach((fn) => fn());

export const allTabs = () => tabs;
export const activeTab = (): Tab | null => tabs.find((t) => t.id === activeId) ?? null;
// 저장 전 새 파일은 항상 수정됨으로 본다.
export const isDirty = (t: Tab) => t.saved === null || t.text !== t.saved;
export const hasUnsaved = () => tabs.some(isDirty);

// 이미 열린 파일이면 그 탭을 활성화하고, 아니면 새 탭을 만든다.
export function addFileTab(path: string, name: string, text: string): Tab {
  let t = tabs.find((x) => x.path === path);
  if (!t) {
    t = { id: ++seq, path, name, text, saved: text, mode: "view", scroll: 0, closeArmed: false };
    tabs.push(t);
  }
  activeId = t.id;
  emit();
  return t;
}

// 새 파일: 편집 모드, 메모리에만 보관함. 저장할 때 경로를 고른다.
export function addNewTab(): Tab {
  const t: Tab = { id: ++seq, path: null, name: `새 파일 ${++newSeq}`, text: "", saved: null, mode: "edit", scroll: 0, closeArmed: false };
  tabs.push(t);
  activeId = t.id;
  emit();
  return t;
}

export function activate(id: number) {
  if (tabs.some((t) => t.id === id)) {
    activeId = id;
    emit();
  }
}

// 닫으면 true. 수정 내용이 있으면 첫 호출은 경고만 하고 false 를 돌려줌.
export function closeTab(id: number): boolean {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return true;
  const t = tabs[i];
  if (isDirty(t) && !t.closeArmed) {
    t.closeArmed = true;
    emit();
    return false;
  }
  tabs.splice(i, 1);
  if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
  emit();
  return true;
}

export function touch() {
  emit();
}
