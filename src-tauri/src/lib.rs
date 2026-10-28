mod fs_cmds;
mod open_args;
mod platform;

use std::path::Path;

use tauri::{Emitter, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 단일 인스턴스 플러그인은 반드시 가장 먼저 등록한다.
    // 두 번째 실행의 인자를 기존 창으로 넘기고, 그 프로세스는 바로 종료된다.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            open_args::handle_open(app, &argv, Path::new(&cwd));
            open_args::focus_main(app);
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(fs_cmds::Allowed::default())
        .manage(open_args::Pending::default())
        .setup(|app| {
            // 첫 실행 인자 (파일 연결로 더블클릭한 경우). 프런트가 준비될 때까지 큐에 쌓인다.
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            open_args::handle_open(app.handle(), &args, &cwd);
            Ok(())
        })
        .on_window_event(|window, event| {
            // 창을 바로 닫지 않고 프런트에 알린다. 저장 여부 확인 뒤 request_exit 로 종료한다.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("mdv-close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            fs_cmds::open_file,
            fs_cmds::save_file_as,
            fs_cmds::read_file,
            fs_cmds::write_file,
            fs_cmds::request_exit,
            open_args::frontend_ready
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: 파인더에서 파일 열기 이벤트도 같은 진입점으로 보낸다.
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = _event {
                    let mut args = vec![String::new()];
                    args.extend(
                        urls.iter()
                            .filter_map(|u| u.to_file_path().ok())
                            .map(|p| p.to_string_lossy().into_owned()),
                    );
                    open_args::handle_open(_app, &args, Path::new("/"));
                }
            }
        });
}
