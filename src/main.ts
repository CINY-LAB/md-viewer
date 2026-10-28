// 부팅과 화면 연결
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { actionOf } from "./keys";
import { activate, activeTab, addNewTab, allTabs, closeTab, hasUnsaved, isDirty, subscribe, touch, type Tab } from "./tabs";
import { toggleCheckbox } from "./render";
import { initOpenEvents, openFileDialog, type Opened } from "./open";
import { initViewer, showView, viewScroll } from "./viewer";
import { focusEditor, initEditor, setEditorDark, setEditorText, setEditorWrap } from "./editor";
import { applyCss, isDark, loadSettings, onSystemThemeChange, saveSettings } from "./settings";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

let shownId: number | null = null; // 지금 화면에 그려진 탭
let refreshing = false;
let settings = loadSettings();

function status(msg: string) {
  $("status").textContent = msg;
}
const fail = (e: unknown) => status(String(e));

async function openFile() {
  try {
    await openFileDialog();
  } catch (e) {
    fail(e);
  }
}

function newFile() {
  addNewTab();
  focusEditor();
}

async function save() {
  const t = activeTab();
  if (!t || !isDirty(t)) return;
  try {
    if (t.path === null) {
      // 새 파일: 저장 대화상자(Rust)에서 경로를 고른다. 확장자가 없으면 .md 가 붙음.
      const f = await invoke<Opened | null>("save_file_as", { content: t.text, suggested: `${t.name}.md` });
      if (!f) return;
      t.path = f.path;
      t.name = f.name;
    } else {
      await invoke("write_file", { path: t.path, content: t.text });
    }
    t.saved = t.text;
    t.closeArmed = false;
    touch();
    status(`저장함: ${t.name}`);
  } catch (e) {
    fail(e);
  }
}

function setMode(mode: "view" | "edit") {
  const t = activeTab();
  if (!t || t.mode === mode) return;
  t.mode = mode;
  touch();
  if (mode === "edit") focusEditor();
}
const toggleEdit = () => {
  const t = activeTab();
  if (t) setMode(t.mode === "edit" ? "view" : "edit");
};

// 보기 모드에서 체크박스를 눌렀을 때: 그 줄의 [ ] / [x] 만 바꾼다.
// 수정 중인 내용이 없던 파일은 바로 저장하고, 수정 중이면 저장하지 않고 수정됨 표시만 한다.
async function onCheckbox(line: number) {
  const t = activeTab();
  if (!t) return;
  const next = toggleCheckbox(t.text, line);
  if (next === null) return status("체크박스를 바꾸지 못함 (해당 줄을 찾을 수 없음)");
  const wasDirty = isDirty(t);
  t.text = next;
  t.closeArmed = false;
  touch();
  if (wasDirty) return status("수정됨 (저장 전)");
  try {
    await invoke("write_file", { path: t.path, content: t.text });
    t.saved = t.text;
    touch();
    status(`저장함: ${t.name}`);
  } catch (e) {
    fail(e);
  }
}

function renderToolbar(t: Tab | null) {
  $("modeView").classList.toggle("on", !!t && t.mode === "view");
  $("modeEdit").classList.toggle("on", !!t && t.mode === "edit");
  ($("modeView") as HTMLButtonElement).disabled = !t;
  ($("modeEdit") as HTMLButtonElement).disabled = !t;
  ($("saveBtn") as HTMLButtonElement).disabled = !t || !isDirty(t);
  $("pathLine").textContent = !t ? "열린 파일 없음" : (t.path ?? "저장되지 않은 새 파일");
}

function renderTabs() {
  const bar = $("tabs");
  bar.replaceChildren();
  const cur = activeTab();
  for (const t of allTabs()) {
    const el = document.createElement("div");
    el.className = "tab" + (t === cur ? " active" : "") + (t.closeArmed ? " armed" : "");
    el.title = t.closeArmed ? "저장하지 않은 내용이 있음. 한 번 더 누르면 닫음" : (t.path ?? "저장되지 않은 새 파일");
    const label = document.createElement("span");
    label.textContent = (isDirty(t) ? "● " : "") + t.name + (t.mode === "edit" ? " (편집)" : "");
    const x = document.createElement("button");
    x.className = "tab-close";
    x.textContent = "×";
    x.onclick = (ev) => {
      ev.stopPropagation();
      closeTab(t.id);
    };
    el.append(label, x);
    el.onclick = () => activate(t.id);
    bar.append(el);
  }
}

function renderContent() {
  const t: Tab | null = activeTab();
  const prev = allTabs().find((x) => x.id === shownId);
  if (prev && prev !== t && !$("viewer").hidden) prev.scroll = viewScroll();
  $("empty").hidden = !!t;
  $("viewer").hidden = !t || t.mode !== "view";
  $("editor").hidden = !t || t.mode !== "edit";
  if (t) {
    if (t.mode === "edit") setEditorText(t.text);
    else showView(t.text, shownId === t.id ? viewScroll() : t.scroll);
  }
  shownId = t?.id ?? null;
}

function refresh() {
  refreshing = true;
  try {
    renderToolbar(activeTab());
    renderTabs();
    renderContent();
  } finally {
    refreshing = false;
  }
}

// ---------- 설정 ----------
function applySettings() {
  applyCss(settings);
  setEditorDark(isDark(settings));
  setEditorWrap(settings.wrap);
}
function initSettingsPanel() {
  const theme = $("setTheme") as HTMLSelectElement;
  const size = $("setSize") as HTMLSelectElement;
  const wrap = $("setWrap") as HTMLInputElement;
  theme.value = settings.theme;
  size.value = String(settings.fontSize);
  wrap.checked = settings.wrap;
  const change = () => {
    settings = { theme: theme.value as typeof settings.theme, fontSize: Number(size.value), wrap: wrap.checked };
    saveSettings(settings);
    applySettings();
  };
  theme.onchange = size.onchange = wrap.onchange = change;
  $("settingsBtn").onclick = () => ($("settingsPanel").hidden = !$("settingsPanel").hidden);
  onSystemThemeChange(() => {
    if (settings.theme === "system") applySettings();
  });
}

// ---------- 부팅 ----------
applyCss(settings);
initViewer((line) => void onCheckbox(line));
initEditor(
  $("editor"),
  {
    onChange: (text) => {
      const t = activeTab();
      if (refreshing || !t || t.mode !== "edit") return;
      t.text = text;
      t.closeArmed = false;
      touch();
    },
    onSave: () => void save(),
    onToggle: toggleEdit,
  },
  { dark: isDark(settings), wrap: settings.wrap },
);
initSettingsPanel();
subscribe(refresh);

$("newBtn").onclick = newFile;
$("openBtn").onclick = () => void openFile();
$("saveBtn").onclick = () => void save();
$("modeView").onclick = () => setMode("view");
$("modeEdit").onclick = () => setMode("edit");

// 파일 연결/두 번째 실행으로 들어온 파일 열기. 허용되지 않은 인자는 상태줄에만 표시된다.
void initOpenEvents(status).catch(fail);

// 창 닫기: 저장하지 않은 내용이 있으면 Rust 확인창이 뜬다.
void listen("mdv-close-requested", () => {
  void invoke("request_exit", { hasUnsaved: hasUnsaved() }).catch(fail);
});

window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return; // 에디터 안에서 이미 처리된 단축키
  const a = actionOf(e);
  if (!a) return;
  e.preventDefault();
  if (a === "openFile") void openFile();
  else if (a === "newFile") newFile();
  else if (a === "toggleEdit") toggleEdit();
  else if (a === "save") void save();
  else if (a === "closeTab") {
    const t = activeTab();
    if (t && !closeTab(t.id)) status("저장하지 않은 내용이 있음. 한 번 더 누르면 닫음");
  }
});
refresh();
