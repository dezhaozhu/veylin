mod sidecar;
mod web_view;

use sidecar::Sidecar;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::new())
        .invoke_handler(tauri::generate_handler![
            web_view::open_web_view,
            web_view::read_web_view,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<Sidecar>().spawn(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Ensure the sidecar is terminated when the app exits.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                app_handle.state::<Sidecar>().kill();
            }
        });
}
