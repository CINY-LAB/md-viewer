import { describe, expect, it } from "vitest";
import { renderMarkdown, toggleCheckbox } from "./render";

describe("renderMarkdown", () => {
  it("표를 table 로 렌더링함", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("체크박스를 클릭 가능한 input checkbox 로 렌더링함", () => {
    const html = renderMarkdown("- [x] 완료\n- [ ] 할 일\n");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain("checked");
    expect(html).not.toContain("disabled");
  });

  it("체크박스에 소스 줄 번호(data-line)를 붙임", () => {
    const html = renderMarkdown("# 제목\n\n- [x] 완료\n- [ ] 할 일\n\n문단\n\n1. [ ] 번호\n");
    expect(html).toContain('data-line="2"');
    expect(html).toContain('data-line="3"');
    expect(html).toContain('data-line="7"');
  });

  it("코드 블록 안의 체크박스 문구에는 체크박스를 만들지 않음", () => {
    const html = renderMarkdown("```\n- [ ] 코드\n```\n");
    expect(html).not.toContain('type="checkbox"');
  });

  it("각주를 렌더링함", () => {
    const html = renderMarkdown("본문[^1]\n\n[^1]: 각주 내용\n");
    expect(html).toContain("footnote-ref");
    expect(html).toContain("각주 내용");
  });

  it("코드 블록에 하이라이트 클래스를 붙임", () => {
    const html = renderMarkdown("```java\nclass A { int x = 1; }\n```\n");
    expect(html).toContain("hljs-keyword");
  });

  it("알 수 없는 언어는 이스케이프된 원문으로 둠", () => {
    const html = renderMarkdown("```nolang\n<b>x</b>\n```\n");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("본문 HTML 을 실행하지 않고 이스케이프함", () => {
    const html = renderMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("javascript: 링크를 링크로 만들지 않음", () => {
    const html = renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("<a ");
  });
});

describe("toggleCheckbox", () => {
  it("[ ] 를 [x] 로, [x] 를 [ ] 로 바꾸고 다른 줄은 그대로 둠", () => {
    const src = "- [ ] a\n- [x] b\n- [ ] c\n";
    expect(toggleCheckbox(src, 0)).toBe("- [x] a\n- [x] b\n- [ ] c\n");
    expect(toggleCheckbox(src, 1)).toBe("- [ ] a\n- [ ] b\n- [ ] c\n");
  });

  it("대문자 [X] 도 해제함", () => {
    expect(toggleCheckbox("- [X] a", 0)).toBe("- [ ] a");
  });

  it("*, +, 번호 목록, 인용, 들여쓰기 접두를 허용함", () => {
    expect(toggleCheckbox("* [ ] a", 0)).toBe("* [x] a");
    expect(toggleCheckbox("+ [ ] a", 0)).toBe("+ [x] a");
    expect(toggleCheckbox("12. [ ] a", 0)).toBe("12. [x] a");
    expect(toggleCheckbox("> - [ ] a", 0)).toBe("> - [x] a");
    expect(toggleCheckbox("  - [ ] a", 0)).toBe("  - [x] a");
  });

  it("CRLF 줄 끝을 건드리지 않음", () => {
    expect(toggleCheckbox("- [ ] a\r\n- [ ] b\r\n", 1)).toBe("- [ ] a\r\n- [x] b\r\n");
  });

  it("같은 문구가 반복돼도 지정한 줄만 바꿈", () => {
    const src = "- [ ] same\n- [ ] same\n";
    expect(toggleCheckbox(src, 1)).toBe("- [ ] same\n- [x] same\n");
  });

  it("줄 내용 중간의 [ ] 는 바꾸지 않고 null 을 돌려줌", () => {
    expect(toggleCheckbox("text [ ] a", 0)).toBeNull();
    expect(toggleCheckbox("- item [ ] a", 0)).toBeNull();
  });

  it("범위를 벗어난 줄은 null", () => {
    expect(toggleCheckbox("- [ ] a", 5)).toBeNull();
    expect(toggleCheckbox("", 0)).toBeNull();
  });

  it("렌더가 붙인 data-line 으로 실제 줄을 찾을 수 있음", () => {
    const src = "# t\n\n- [ ] a\n- [ ] b\n";
    const lines = [...renderMarkdown(src).matchAll(/data-line="(\d+)"/g)].map((m) => Number(m[1]));
    expect(lines).toEqual([2, 3]);
    expect(toggleCheckbox(src, lines[1])).toBe("# t\n\n- [ ] a\n- [x] b\n");
  });
});
