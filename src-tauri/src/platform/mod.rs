// OS 전용 코드는 이 폴더에만 둔다. 나머지 모듈은 아래 함수만 호출한다.
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::display_path;

#[cfg(not(windows))]
pub fn display_path(p: &std::path::Path) -> String {
    p.to_string_lossy().into_owned()
}
