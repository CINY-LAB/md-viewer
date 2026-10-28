// 실행 인자(파일 연결로 더블클릭, 명령줄, 두 번째 실행)로 받은 파일을 탭으로 여는 경로.
// 인자 해석, 확장자 검사, 허용 목록 등록은 모두 Rust 에서 한다. 프런트는 통과한 경로를 받아 읽기만 요청한다.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::fs_cmds::{ensure_text_ext, register, Allowed, Opened};

#[derive(Debug, Default, PartialEq)]
pub struct Parsed {
    pub files: Vec<PathBuf>,
    pub errors: Vec<String>,
}

// 인자 목록을 해석한다. args[0] (실행 파일)과 `-` 로 시작하는 인자는 건너뛴다.
// 상대 경로는 인자를 넘긴 쪽 프로세스의 cwd 기준으로 푼다 (앱 자신의 cwd 가 아님).
pub fn parse_args(args: &[String], cwd: &Path) -> Parsed {
    let mut out = Parsed::default();
    for arg in args.iter().skip(1) {
        if arg.is_empty() || arg.starts_with('-') {
            continue;
        }
        let raw = PathBuf::from(arg);
        let full = if raw.is_absolute() { raw } else { cwd.join(raw) };
        let Ok(canon) = fs::canonicalize(&full) else {
            out.errors.push(format!("무시함: {arg} (없는 경로)"));
            continue;
        };
        if !canon.is_file() {
            out.errors.push(format!("무시함: {arg} (파일이 아님)"));
            continue;
        }
        if let Err(e) = ensure_text_ext(&canon) {
            out.errors.push(format!("무시함: {arg} ({e})"));
            continue;
        }
        if !out.files.contains(&canon) {
            out.files.push(canon);
        }
    }
    out
}

// 프런트로 보내는 묶음. files 는 이미 허용 목록에 등록된 파일, errors 는 무시한 인자 설명.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct OpenEvent {
    pub files: Vec<Opened>,
    pub errors: Vec<String>,
}

#[derive(Default)]
struct Inner {
    ready: bool,
    queue: Vec<OpenEvent>,
}

// 콜드 스타트 대비 대기 큐. 프런트가 준비되기 전에 도착한 인자는 큐에 쌓아 둔다.
#[derive(Default)]
pub struct Pending(Mutex<Inner>);

impl Pending {
    // 준비 전이면 큐에 넣고 None, 준비 후면 바로 보낼 수 있게 Some 으로 돌려준다.
    pub fn push(&self, ev: OpenEvent) -> Option<OpenEvent> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if g.ready {
            Some(ev)
        } else {
            g.queue.push(ev);
            None
        }
    }

    // 준비 완료로 바꾸고 쌓인 큐를 비워 돌려준다 (한 번의 잠금 안에서 처리해 유실/중복을 막는다).
    pub fn take_ready(&self) -> Vec<OpenEvent> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        g.ready = true;
        std::mem::take(&mut g.queue)
    }
}

// 파일 열기 요청의 단일 진입점: 해석 -> 허용 목록 등록 -> 프런트 전달(또는 큐 적재).
// 호출처: 첫 실행 인자, 두 번째 실행 콜백, (macOS) 열기 이벤트.
pub fn handle_open(app: &AppHandle, args: &[String], cwd: &Path) {
    let parsed = parse_args(args, cwd);
    let allowed = app.state::<Allowed>();
    let mut ev = OpenEvent { files: Vec::new(), errors: parsed.errors };
    for f in &parsed.files {
        match register(&allowed, f) {
            Ok(o) => ev.files.push(o),
            Err(e) => ev.errors.push(e),
        }
    }
    if ev.files.is_empty() && ev.errors.is_empty() {
        return;
    }
    if let Some(ev) = app.state::<Pending>().push(ev) {
        let _ = app.emit("mdv-open", ev);
    }
}

// 창을 최소화 상태에서 복원하고 앞으로 가져온다. (Windows 포그라운드 제한으로 깜빡임에 그칠 수 있음)
pub fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// 프런트가 mdv-open 수신 준비를 마쳤을 때 한 번 호출한다. 그동안 쌓인 묶음을 돌려준다.
#[tauri::command]
pub fn frontend_ready(pending: State<'_, Pending>) -> Vec<OpenEvent> {
    pending.take_ready()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    fn setup() -> PathBuf {
        let n = N.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("mdv-args-{}-{}", std::process::id(), n));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("한글 폴더")).unwrap();
        fs::canonicalize(&base).unwrap()
    }

    fn args(list: &[&str]) -> Vec<String> {
        std::iter::once("mdv.exe").chain(list.iter().copied()).map(String::from).collect()
    }

    fn canon(p: &Path) -> PathBuf {
        fs::canonicalize(p).unwrap()
    }

    #[test]
    fn absolute_path_is_accepted() {
        let base = setup();
        let f = base.join("a.md");
        fs::write(&f, "x").unwrap();
        let r = parse_args(&args(&[&f.to_string_lossy()]), Path::new("/nowhere"));
        assert_eq!(r.files, vec![canon(&f)]);
        assert!(r.errors.is_empty());
    }

    #[test]
    fn relative_path_uses_given_cwd() {
        let base = setup();
        fs::write(base.join("a.md"), "x").unwrap();
        let r = parse_args(&args(&["a.md"]), &base);
        assert_eq!(r.files, vec![canon(&base.join("a.md"))]);
        let none = parse_args(&args(&["a.md"]), &base.join("한글 폴더"));
        assert!(none.files.is_empty());
        assert_eq!(none.errors.len(), 1);
    }

    #[test]
    fn korean_and_space_paths_work() {
        let base = setup();
        let f = base.join("한글 폴더").join("내 문서 1.md");
        fs::write(&f, "x").unwrap();
        let r = parse_args(&args(&["한글 폴더/내 문서 1.md"]), &base);
        assert_eq!(r.files, vec![canon(&f)]);
    }

    #[test]
    fn disallowed_extension_folder_and_missing_are_ignored_with_message() {
        let base = setup();
        fs::write(base.join("run.exe"), "x").unwrap();
        fs::write(base.join("noext"), "x").unwrap();
        let r = parse_args(&args(&["run.exe", "noext", "한글 폴더", "none.md"]), &base);
        assert!(r.files.is_empty());
        assert_eq!(r.errors.len(), 4);
        assert!(r.errors.iter().all(|e| e.starts_with("무시함:")));
    }

    #[test]
    fn flags_and_program_name_are_skipped() {
        let base = setup();
        fs::write(base.join("a.md"), "x").unwrap();
        let r = parse_args(&args(&["--flag", "-x", "", "a.md"]), &base);
        assert_eq!(r.files, vec![canon(&base.join("a.md"))]);
        assert!(r.errors.is_empty());
        // args[0] 은 파일처럼 보여도 해석하지 않는다
        let only_prog = parse_args(&[base.join("a.md").to_string_lossy().into_owned()], &base);
        assert!(only_prog.files.is_empty() && only_prog.errors.is_empty());
    }

    #[test]
    fn multiple_args_keep_order_dedupe_and_mix_with_errors() {
        let base = setup();
        fs::write(base.join("a.md"), "x").unwrap();
        fs::write(base.join("b.txt"), "x").unwrap();
        fs::write(base.join("c.png"), "x").unwrap();
        let r = parse_args(&args(&["b.txt", "a.md", "./b.txt", "c.png"]), &base);
        assert_eq!(r.files, vec![canon(&base.join("b.txt")), canon(&base.join("a.md"))]);
        assert_eq!(r.errors.len(), 1);
    }

    fn ev(name: &str) -> OpenEvent {
        OpenEvent { files: vec![Opened { path: name.into(), name: name.into() }], errors: vec![] }
    }

    #[test]
    fn pending_queues_before_ready_and_drains_once() {
        let p = Pending::default();
        assert!(p.push(ev("a")).is_none());
        assert!(p.push(ev("b")).is_none());
        let drained = p.take_ready();
        assert_eq!(drained, vec![ev("a"), ev("b")]);
        assert!(p.take_ready().is_empty());
    }

    #[test]
    fn pending_passes_through_after_ready() {
        let p = Pending::default();
        p.take_ready();
        assert_eq!(p.push(ev("c")), Some(ev("c")));
        assert!(p.take_ready().is_empty());
    }
}
