import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { KEYS } from "./keys";

const themeSlot = new Compartment();
const wrapSlot = new Compartment();

let view: EditorView | null = null;

export interface EditorHooks {
  onChange: (text: string) => void;
  onSave: () => void;
  onToggle: () => void;
}

// 한 개의 에디터를 만들어 두고 탭을 바꿀 때 내용만 교체한다.
export function initEditor(host: HTMLElement, hooks: EditorHooks, opts: { dark: boolean; wrap: boolean }) {
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        markdown(),
        wrapSlot.of(opts.wrap ? EditorView.lineWrapping : []),
        themeSlot.of(opts.dark ? oneDark : []),
        keymap.of([
          { key: KEYS.save, preventDefault: true, run: () => (hooks.onSave(), true) },
          { key: KEYS.toggleEdit, preventDefault: true, run: () => (hooks.onToggle(), true) },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) hooks.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
}

export function setEditorDark(dark: boolean) {
  view?.dispatch({ effects: themeSlot.reconfigure(dark ? oneDark : []) });
}

export function setEditorWrap(wrap: boolean) {
  view?.dispatch({ effects: wrapSlot.reconfigure(wrap ? EditorView.lineWrapping : []) });
}

export function setEditorText(text: string) {
  if (!view || view.state.doc.toString() === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
}

export function focusEditor() {
  view?.focus();
}
