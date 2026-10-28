// 파일 접근 명령. 사용자 정의 명령은 Tauri 권한 범위(scope)를 거치지 않으므로
// 허용 목록(정확히 일치하는 파일 경로)에 등록된 파일만 읽고 쓴다.
// 등록은 Rust 에서 띄운 열기/저장 대화상자의 결과로만 한다. 프런트가 경로를 등록하는 명령은 없다.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::platform::display_path;

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const TEXT_EXTS: [&str; 4] = ["md", "markdown", "mdx", "txt"];

#[derive(Default)]
pub struct Allowed(pub Mutex<HashSet<PathBuf>>);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Opened {
    pub path: String,
    pub name: String,
}

fn has_text_ext(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| TEXT_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub(crate) fn ensure_text_ext(p: &Path) -> Result<(), String> {
    if has_text_ext(p) {
        Ok(())
    } else {
        Err("허용되지 않는 확장자임 (md, markdown, mdx, txt만 가능)".to_string())
    }
}

// 저장 경로 정리: 확장자가 없으면 .md 를 붙이고, 허용 외 확장자는 거부한다.
pub fn normalize_save_path(p: &Path) -> Result<PathBuf, String> {
    let mut out = p.to_path_buf();
    if out.extension().is_none() {
        out.set_extension("md");
    }
    ensure_text_ext(&out)?;
    Ok(out)
}

// 경로를 실제 경로로 바꾼 뒤 허용 목록과 정확히 일치하는지 검사한다. 존재하지 않는 경로는 거부한다.
pub fn resolve_allowed(path: &str, allowed: &HashSet<PathBuf>) -> Result<PathBuf, String> {
    let canon = fs::canonicalize(path).map_err(|e| format!("경로를 열 수 없음: {e}"))?;
    if allowed.contains(&canon) {
        Ok(canon)
    } else {
        Err("허용되지 않은 파일임".to_string())
    }
}

pub fn read_file_impl(path: &str, allowed: &HashSet<PathBuf>) -> Result<String, String> {
    let p = resolve_allowed(path, allowed)?;
    ensure_text_ext(&p)?;
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아님".to_string());
    }
    if meta.len() > MAX_READ_BYTES {
        return Err("파일이 너무 큼 (10MB 초과)".to_string());
    }
    fs::read_to_string(&p).map_err(|e| format!("텍스트로 읽을 수 없음: {e}"))
}

// 임시 파일에 쓴 뒤 rename 한다. 쓰는 중 종료되어도 원본이 손상되지 않는다.
fn atomic_write(p: &Path, content: &str) -> Result<(), String> {
    let mut tmp_name = p.file_name().ok_or("파일 이름 없음")?.to_os_string();
    tmp_name.push(".mdv-tmp");
    let tmp = p.with_file_name(tmp_name);
    let result = fs::write(&tmp, content).and_then(|_| fs::rename(&tmp, p));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| format!("저장 실패: {e}"))
}

pub fn write_file_impl(path: &str, content: &str, allowed: &HashSet<PathBuf>) -> Result<(), String> {
    let p = resolve_allowed(path, allowed)?;
    ensure_text_ext(&p)?;
    if !p.is_file() {
        return Err("기존 파일만 저장할 수 있음".to_string());
    }
    atomic_write(&p, content)
}

pub(crate) fn register(state: &State<'_, Allowed>, canon: &Path) -> Result<Opened, String> {
    let name = canon
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    state.0.lock().map_err(|e| e.to_string())?.insert(canon.to_path_buf());
    Ok(Opened { path: display_path(canon), name })
}

fn allowed_of(state: &State<'_, Allowed>) -> HashSet<PathBuf> {
    state.0.lock().map(|g| g.clone()).unwrap_or_default()
}

// 열기 대화상자를 Rust 에서 띄우고, 사용자가 고른 파일만 허용 목록에 등록한다.
#[tauri::command]
pub async fn open_file(
    app: tauri::AppHandle,
    state: State<'_, Allowed>,
) -> Result<Option<Opened>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Markdown / 텍스트", &TEXT_EXTS)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    ensure_text_ext(&canon)?;
    if !canon.is_file() {
        return Err("파일이 아님".to_string());
    }
    register(&state, &canon).map(Some)
}

// 저장 대화상자를 Rust 에서 띄우고, 고른 경로에 내용을 쓴 뒤 허용 목록에 등록한다.
#[tauri::command]
pub async fn save_file_as(
    app: tauri::AppHandle,
    content: String,
    suggested: Option<String>,
    state: State<'_, Allowed>,
) -> Result<Option<Opened>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dlg = app.dialog().file().add_filter("Markdown / 텍스트", &TEXT_EXTS);
    if let Some(name) = suggested {
        dlg = dlg.set_file_name(name);
    }
    let Some(picked) = dlg.blocking_save_file() else {
        return Ok(None);
    };
    let chosen = picked.into_path().map_err(|e| e.to_string())?;
    // 이미 있는 파일(심볼릭 링크 포함)이면 실제 대상 기준으로 확장자를 검사한다.
    let target = if chosen.exists() {
        fs::canonicalize(&chosen).map_err(|e| e.to_string())?
    } else {
        chosen
    };
    let target = normalize_save_path(&target)?;
    atomic_write(&target, &content)?;
    let canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    register(&state, &canon).map(Some)
}

#[tauri::command]
pub fn read_file(path: String, state: State<'_, Allowed>) -> Result<String, String> {
    read_file_impl(&path, &allowed_of(&state))
}

#[tauri::command]
pub fn write_file(path: String, content: String, state: State<'_, Allowed>) -> Result<(), String> {
    write_file_impl(&path, &content, &allowed_of(&state))
}

// 창 닫기 요청 처리. 저장하지 않은 내용이 있으면 Rust 확인창으로 묻고, 승인하면 종료한다.
#[tauri::command]
pub async fn request_exit(app: tauri::AppHandle, has_unsaved: bool) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    if has_unsaved {
        let ok = app
            .dialog()
            .message("저장하지 않은 내용이 있음. 저장하지 않고 종료할까요?")
            .title("mdv")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("종료".into(), "취소".into()))
            .blocking_show();
        if !ok {
            return Ok(());
        }
    }
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    // 테스트마다 고유한 임시 폴더를 만든다. 반환값은 (폴더, 허용 목록).
    fn setup() -> (PathBuf, HashSet<PathBuf>) {
        let n = N.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("mdv-test-{}-{}", std::process::id(), n));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("sub")).unwrap();
        (fs::canonicalize(&base).unwrap(), HashSet::new())
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    // 파일을 만들고 허용 목록에 넣는다 (실제로는 대화상자 결과만 이 경로로 들어온다).
    fn add(base: &Path, allowed: &mut HashSet<PathBuf>, name: &str, body: &str) -> PathBuf {
        let p = base.join(name);
        fs::write(&p, body).unwrap();
        let c = fs::canonicalize(&p).unwrap();
        allowed.insert(c.clone());
        c
    }

    #[test]
    fn allows_registered_file() {
        let (base, mut al) = setup();
        let f = add(&base, &mut al, "a.md", "x");
        assert_eq!(resolve_allowed(&s(&f), &al).unwrap(), f);
    }

    #[test]
    fn rejects_unregistered_file() {
        let (base, al) = setup();
        fs::write(base.join("a.md"), "x").unwrap();
        assert!(resolve_allowed(&s(&base.join("a.md")), &al).is_err());
    }

    #[test]
    fn rejects_other_file_in_same_folder() {
        let (base, mut al) = setup();
        add(&base, &mut al, "a.md", "x");
        fs::write(base.join("b.md"), "secret").unwrap();
        assert!(read_file_impl(&s(&base.join("b.md")), &al).is_err());
    }

    #[test]
    fn dotdot_path_resolves_to_exact_file_only() {
        let (base, mut al) = setup();
        add(&base, &mut al, "a.md", "x");
        fs::write(base.join("b.md"), "secret").unwrap();
        let ok = base.join("sub/../a.md");
        let bad = base.join("sub/../b.md");
        assert!(resolve_allowed(&s(&ok), &al).is_ok());
        assert!(resolve_allowed(&s(&bad), &al).is_err());
    }

    #[test]
    fn rejects_missing_path_and_empty_list() {
        let (base, al) = setup();
        assert!(resolve_allowed(&s(&base.join("none.md")), &al).is_err());
        assert!(resolve_allowed(&s(&base), &al).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_to_unregistered_file() {
        let (base, mut al) = setup();
        add(&base, &mut al, "a.md", "x");
        fs::write(base.join("secret.md"), "s").unwrap();
        std::os::unix::fs::symlink(base.join("secret.md"), base.join("link.md")).unwrap();
        assert!(resolve_allowed(&s(&base.join("link.md")), &al).is_err());
    }

    #[test]
    fn read_rechecks_extension() {
        let (base, mut al) = setup();
        let f = add(&base, &mut al, "run.exe", "x");
        assert!(read_file_impl(&s(&f), &al).is_err());
    }

    #[test]
    fn write_replaces_content_and_leaves_no_temp() {
        let (base, mut al) = setup();
        let f = add(&base, &mut al, "a.md", "old");
        write_file_impl(&s(&f), "new", &al).unwrap();
        assert_eq!(read_file_impl(&s(&f), &al).unwrap(), "new");
        assert!(!base.join("a.md.mdv-tmp").exists());
    }

    #[test]
    fn write_rejects_unregistered_and_disallowed_extension() {
        let (base, mut al) = setup();
        fs::write(base.join("o.md"), "old").unwrap();
        assert!(write_file_impl(&s(&base.join("o.md")), "x", &al).is_err());
        assert_eq!(fs::read_to_string(base.join("o.md")).unwrap(), "old");
        let exe = add(&base, &mut al, "run.exe", "old");
        assert!(write_file_impl(&s(&exe), "x", &al).is_err());
        assert_eq!(fs::read_to_string(&exe).unwrap(), "old");
    }

    #[test]
    fn write_rejects_new_files() {
        let (base, mut al) = setup();
        add(&base, &mut al, "a.md", "x");
        assert!(write_file_impl(&s(&base.join("new.md")), "x", &al).is_err());
    }

    #[test]
    fn save_path_gets_default_extension() {
        assert_eq!(normalize_save_path(Path::new("notes")).unwrap(), PathBuf::from("notes.md"));
        assert_eq!(normalize_save_path(Path::new("a.TXT")).unwrap(), PathBuf::from("a.TXT"));
        assert_eq!(normalize_save_path(Path::new("a.markdown")).unwrap(), PathBuf::from("a.markdown"));
    }

    #[test]
    fn save_path_rejects_other_extensions() {
        assert!(normalize_save_path(Path::new("evil.exe")).is_err());
        assert!(normalize_save_path(Path::new("a.md.bat")).is_err());
    }

    #[test]
    fn atomic_write_creates_new_file_without_temp() {
        let (base, _) = setup();
        let p = base.join("fresh.md");
        atomic_write(&p, "hello").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "hello");
        assert!(!base.join("fresh.md.mdv-tmp").exists());
    }
}
