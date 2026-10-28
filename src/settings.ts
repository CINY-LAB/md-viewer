// 설정 3개(테마, 글꼴 크기, 편집기 줄 바꿈). localStorage 에 저장한다.
export interface Settings {
  theme: "system" | "light" | "dark";
  fontSize: number; // 13~20
  wrap: boolean;
}

const KEY = "mdv.settings";
const DEFAULTS: Settings = { theme: "system", fontSize: 15, wrap: true };
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const size = Number(raw.fontSize);
    return {
      theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system",
      fontSize: Number.isFinite(size) ? Math.min(20, Math.max(13, Math.round(size))) : DEFAULTS.fontSize,
      wrap: typeof raw.wrap === "boolean" ? raw.wrap : DEFAULTS.wrap,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 실패는 무시함 (이번 실행에만 적용) */
  }
}

export const isDark = (s: Settings) => s.theme === "dark" || (s.theme === "system" && darkQuery.matches);

// 시스템 테마가 바뀌었을 때 알림을 받는다 (테마가 '시스템'일 때만 의미가 있음).
export function onSystemThemeChange(fn: () => void) {
  darkQuery.addEventListener("change", fn);
}

export function applyCss(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = isDark(s) ? "dark" : "light";
  root.style.setProperty("--font-size", `${s.fontSize}px`);
}
