use std::path::Path;

// canonicalize 결과의 `\\?\` 접두사를 화면용 경로에서 제거한다.
pub fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => rest.to_string(),
        _ => s.into_owned(),
    }
}
