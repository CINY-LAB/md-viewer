// 단축키는 이 파일 한 곳에서만 정의한다. Mod = Windows/Linux는 Ctrl, macOS는 Cmd.
// CodeMirror keymap 표기("Mod-e")와 같은 문자열을 쓴다.
export const KEYS = {
  toggleEdit: "Mod-e",
  save: "Mod-s",
  openFile: "Mod-o",
  newFile: "Mod-n",
  closeTab: "Mod-w",
} as const;

export type KeyAction = keyof typeof KEYS;

// 키 이벤트가 정의된 단축키와 일치하는지 확인한다.
export function matches(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("-");
  const key = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1);
  const wantMod = mods.includes("Mod");
  const hasMod = e.ctrlKey || e.metaKey;
  if (wantMod !== hasMod) return false;
  if (mods.includes("Shift") !== e.shiftKey) return false;
  if (mods.includes("Alt") !== e.altKey) return false;
  return e.key.toLowerCase() === key;
}

export function actionOf(e: KeyboardEvent): KeyAction | null {
  for (const a of Object.keys(KEYS) as KeyAction[]) {
    if (matches(e, KEYS[a])) return a;
  }
  return null;
}
