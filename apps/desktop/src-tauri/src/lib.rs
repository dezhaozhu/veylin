mod sidecar;
mod web_view;

use sidecar::Sidecar;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Sidecar::new())
        .invoke_handler(tauri::generate_handler![
            web_view::hide_web_view,
            web_view::open_web_view,
            web_view::read_web_view,
            web_view::resize_web_view,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            // Spawn the sidecar in the background and show the window immediately;
            // the web frontend renders a splash and waits for /health before
            // mounting business UI, so the app feels responsive on launch.
            app.state::<Sidecar>().spawn(&handle);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            match event {
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { has_visible_windows, .. } => {
                    if !has_visible_windows {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                    app_handle.state::<Sidecar>().kill();
                }
                _ => {}
            }
        });
}
