// 마크다운 렌더링. DOM에 의존하지 않는 순수 함수라 vitest로 바로 검사할 수 있다.
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/core";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import rust from "highlight.js/lib/languages/rust";

hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("rust", rust);
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts"], { languageName: "typescript" });
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["html"], { languageName: "xml" });

const md = new MarkdownIt({
  html: false, // 본문 HTML 실행 차단
  linkify: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* 하이라이트 실패 시 이스케이프된 원문으로 대체 */
      }
    }
    return ""; // 빈 문자열이면 markdown-it가 이스케이프 처리함
  },
})
  .use(footnote)
  .use(taskLists, { enabled: true });

// 체크박스에 소스 줄 번호(data-line)를 붙인다. 보기 모드에서 클릭한 칸의 줄을 찾기 위함.
// task-lists 플러그인이 먼저 체크박스를 만든 뒤 실행되도록 규칙 맨 끝에 추가한다.
md.core.ruler.push("mdv_task_line", (state) => {
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    const open = toks[i];
    if (open.type !== "list_item_open" || !open.map) continue;
    if (!String(open.attrGet("class") ?? "").includes("task-list-item")) continue;
    for (let j = i + 1; j < Math.min(i + 4, toks.length); j++) {
      if (toks[j].type !== "inline") continue;
      const box = toks[j].children?.[0];
      if (box && box.type === "html_inline" && box.content.includes("task-list-item-checkbox")) {
        box.content = box.content.replace("<input", `<input data-line="${open.map[0]}"`);
      }
      break;
    }
  }
  return true;
});

export function renderMarkdown(src: string): string {
  return md.render(src);
}

// `> `, `-`, `*`, `+`, `1.` 같은 접두를 허용하고 [ ] / [x] 만 바꾼다.
const TASK_LINE = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

// 소스의 line(0부터) 줄에 있는 체크박스를 뒤집은 새 텍스트를 돌려준다. 해당 줄이 체크박스가 아니면 null.
// 줄 끝(\r\n 포함)과 다른 줄은 건드리지 않는다.
export function toggleCheckbox(text: string, line: number): string | null {
  const re = /\r\n|\r|\n/g;
  let start = 0;
  for (let n = 0; ; n++) {
    const m = re.exec(text);
    const end = m ? m.index : text.length;
    if (n === line) {
      const seg = text.slice(start, end);
      const next = seg.replace(TASK_LINE, (_all, pre: string, c: string) => `${pre}[${c === " " ? "x" : " "}]`);
      return next === seg ? null : text.slice(0, start) + next + text.slice(end);
    }
    if (!m) return null;
    start = m.index + m[0].length;
  }
}
