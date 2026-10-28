// 파일 열기 진입점. 열기 버튼, (2단계) 명령줄 인자, 드래그 앤 드롭, 두 번째 실행,
// (macOS) 열기 이벤트가 모두 openTarget 하나로 들어온다.
// 경로를 허용 목록에 등록하는 일은 Rust(대화상자/이벤트)만 한다. 여기서는 읽기만 요청한다.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { addFileTab } from "./tabs";

export interface Opened {
  path: string;
  name: string;
}

export async function openTarget(path: string, name?: string): Promise<void> {
  const text = await invoke<string>("read_file", { path });
  // 파일 이름은 표시용일 뿐이라 경로 구분자 둘 다 처리함 (권한 판단에는 쓰지 않음)
  addFileTab(path, name ?? (path.split(/[\\/]/).pop() || path), text);
}

interface OpenBatch {
  files: Opened[];
  errors: string[];
}

// 실행 인자(파일 연결 더블클릭, 두 번째 실행)로 들어온 파일을 연다.
// 경로 등록과 검사는 Rust 가 이미 끝낸 뒤라 여기서는 받아서 읽기만 요청한다.
// 먼저 mdv-open 수신을 등록하고 frontend_ready 로 그동안 쌓인 묶음을 받는다 (콜드 스타트 유실 방지).
export async function initOpenEvents(onMessage: (msg: string) => void): Promise<void> {
  const handle = (b: OpenBatch) => {
    if (b.errors.length) onMessage(b.errors.join(" / "));
    for (const f of b.files) void openTarget(f.path, f.name).catch((e) => onMessage(String(e)));
  };
  await listen<OpenBatch>("mdv-open", (e) => handle(e.payload));
  (await invoke<OpenBatch[]>("frontend_ready")).forEach(handle);
}

// 열기 대화상자(Rust)로 파일을 골라 연다. 취소하면 아무 일도 없음.
export async function openFileDialog(): Promise<void> {
  const f = await invoke<Opened | null>("open_file");
  if (f) await openTarget(f.path, f.name);
}
