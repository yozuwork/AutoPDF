"""以桌面視窗或瀏覽器啟動圖片轉 PDF 小幫手。"""

from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import importlib.util
import json
import os
import pathlib
import socketserver
import threading
import webbrowser
from datetime import datetime

from auto_converter import convert_folder, discover_groups


APP_ROOT = pathlib.Path(__file__).resolve().parent
APP_TITLE = "圖片轉 PDF 小幫手"
SETTINGS_PATH = pathlib.Path(os.environ.get("LOCALAPPDATA", pathlib.Path.home())) / "ImageToPDF" / "settings.json"
SEQUENCE_PATH = SETTINGS_PATH.with_name("sequence.json")


class StaticRequestHandler(http.server.SimpleHTTPRequestHandler):
    """只提供 app.py 所在資料夾內的前端檔案。"""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format_string: str, *args: object) -> None:
        return


class LocalServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class DesktopApi:
    """提供自訂標題列使用的最小化、最大化與關閉功能。"""

    def __init__(self) -> None:
        self.window = None
        self.maximized = False
        self.conversion_lock = threading.Lock()

    def minimize(self) -> None:
        if self.window is not None:
            self.window.minimize()

    def toggle_maximize(self) -> None:
        if self.window is None:
            return
        if self.maximized:
            self.window.restore()
        else:
            self.window.maximize()
        self.maximized = not self.maximized

    def close(self) -> None:
        if self.window is not None:
            self.window.destroy()

    def choose_folder(self) -> str:
        if self.window is None:
            return ""
        import webview

        result = self.window.create_file_dialog(webview.FOLDER_DIALOG, allow_multiple=False)
        if not result:
            return ""
        if isinstance(result, (list, tuple)):
            return str(result[0]) if result else ""
        return str(result)

    def open_folder(self, folder_path: str = "") -> dict:
        folder = pathlib.Path(folder_path).expanduser() if folder_path else pathlib.Path.home() / "Downloads"
        if not folder.is_dir():
            return {"success": False, "error": "資料夾不存在或目前無法開啟"}
        try:
            os.startfile(str(folder))
            return {"success": True, "path": str(folder)}
        except OSError as error:
            return {"success": False, "error": f"無法開啟資料夾：{error}"}

    def load_settings(self) -> dict:
        try:
            return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return {}

    def save_settings(self, settings: dict) -> bool:
        try:
            SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = SETTINGS_PATH.with_suffix(".tmp")
            temporary_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary_path.replace(SETTINGS_PATH)
            return True
        except (OSError, TypeError, ValueError):
            return False

    def next_system_name(self) -> str:
        today = datetime.now().strftime("%Y%m%d")
        try:
            state = json.loads(SEQUENCE_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            state = {}
        sequence = int(state.get("sequence", 0)) + 1 if state.get("date") == today else 1
        SEQUENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
        SEQUENCE_PATH.write_text(
            json.dumps({"date": today, "sequence": sequence}, ensure_ascii=False),
            encoding="utf-8",
        )
        return f"{today}{sequence:03d}"

    def run_auto_conversion(self, settings: dict) -> dict:
        if not self.conversion_lock.acquire(blocking=False):
            return {"success": False, "error": "已有一個自動轉換工作正在執行"}
        try:
            system_name = self.next_system_name() if settings.get("namingMode") == "system" else None
            return convert_folder(settings, system_name)
        finally:
            self.conversion_lock.release()

    def scan_auto_conversion(self, settings: dict) -> dict:
        return discover_groups(settings)

    def run_auto_group(self, settings: dict, group: dict) -> dict:
        if not self.conversion_lock.acquire(blocking=False):
            return {"success": False, "error": "已有一個自動轉換工作正在執行"}
        try:
            group_settings = {
                **settings,
                "groupFolder": group.get("path", ""),
                "rootImagesOnly": bool(group.get("rootImagesOnly")),
            }
            system_name = self.next_system_name() if settings.get("namingMode") == "system" else None
            return convert_folder(group_settings, system_name)
        finally:
            self.conversion_lock.release()


def create_server(port: int) -> LocalServer:
    handler = functools.partial(StaticRequestHandler, directory=str(APP_ROOT))
    return LocalServer(("127.0.0.1", port), handler)


def run_in_browser(server: LocalServer, url: str) -> None:
    print(f"{APP_TITLE} 已啟動：{url}")
    print("按 Ctrl+C 可停止程式。")
    webbrowser.open(url)
    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()


def run_in_desktop_window(server: LocalServer, url: str, debug: bool) -> bool:
    if importlib.util.find_spec("webview") is None:
        return False

    try:
        import webview

        api = DesktopApi()
        window = webview.create_window(
            APP_TITLE,
            url,
            js_api=api,
            width=1180,
            height=820,
            min_size=(760, 600),
            frameless=True,
            easy_drag=True,
            background_color="#f3f2fa",
        )
        api.window = window
        webview.start(debug=debug)
        return True
    except Exception as error:
        print(f"桌面視窗無法啟動，將改用瀏覽器：{error}")
        return False


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=APP_TITLE)
    parser.add_argument("--browser", action="store_true", help="直接使用預設瀏覽器開啟")
    parser.add_argument("--debug", action="store_true", help="開啟桌面視窗的除錯模式")
    parser.add_argument("--port", type=int, default=0, help="指定本機連接埠，預設自動選擇")
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    server = create_server(args.port)
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/"

    if args.browser:
        run_in_browser(server, url)
        return

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    try:
        if not run_in_desktop_window(server, f"{url}?desktop=1", args.debug):
            server.shutdown()
            server.server_close()
            server = create_server(port)
            run_in_browser(server, url)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
