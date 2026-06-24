use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

enum SidecarChild {
    Shell(CommandChild),
    Process(Child),
}

/// Handle to the spawned BFF server process.
pub struct Sidecar(Mutex<Option<SidecarChild>>);

impl Sidecar {
    pub fn new() -> Self {
        Sidecar(Mutex::new(None))
    }

    /// Spawn the Node BFF server. Skipped when VEYLIN_SKIP_SIDECAR=1.
    pub fn spawn(&self, app: &AppHandle) {
        if std::env::var("VEYLIN_SKIP_SIDECAR").as_deref() == Ok("1") {
            return;
        }

        let data_dir = app_data_dir(app);
        let port = std::env::var("PORT").unwrap_or_else(|_| "8787".into());

        if let Ok(sidecar) = app.shell().sidecar("veylin-server") {
            match sidecar
                .env("VEYLIN_DATA_DIR", &data_dir)
                .env("VEYLIN_DESKTOP_AUTH", "1")
                .env("PORT", &port)
                .spawn()
            {
                Ok((_rx, child)) => {
                    *self.0.lock().unwrap() = Some(SidecarChild::Shell(child));
                    return;
                }
                Err(err) => eprintln!("[sidecar] failed to spawn packaged sidecar: {err}"),
            }
        }

        if let Ok(bin) = std::env::var("VEYLIN_SERVER_BIN") {
            if !bin.trim().is_empty() {
                if let Ok(child) = Command::new(bin)
                    .env("VEYLIN_DATA_DIR", &data_dir)
                    .env("VEYLIN_DESKTOP_AUTH", "1")
                    .env("PORT", &port)
                    .spawn()
                {
                    *self.0.lock().unwrap() = Some(SidecarChild::Process(child));
                    return;
                }
            }
        }

        // Dev fallback: npm workspace server from repo root.
        let root = std::env::current_dir()
            .ok()
            .and_then(|p| p.ancestors().nth(3).map(|a| a.to_path_buf()));
        let Some(root) = root else {
            eprintln!("[sidecar] no dev repo root found; set VEYLIN_SERVER_BIN or run via tauri dev");
            return;
        };

        match Command::new("npm")
            .args(["run", "-w", "@veylin/server", "start"])
            .current_dir(root)
            .env("VEYLIN_DATA_DIR", data_dir)
            .env("VEYLIN_DESKTOP_AUTH", "1")
            .env("PORT", port)
            .spawn()
        {
            Ok(child) => {
                *self.0.lock().unwrap() = Some(SidecarChild::Process(child));
            }
            Err(err) => eprintln!("[sidecar] failed to spawn dev server: {err}"),
        }
    }

    pub fn kill(&self) {
        let child = self.0.lock().unwrap().take();
        if let Some(child) = child {
            match child {
                SidecarChild::Shell(c) => {
                    let _ = c.kill();
                }
                SidecarChild::Process(mut c) => {
                    let _ = c.kill();
                }
            }
        }
    }
}

fn app_data_dir(app: &AppHandle) -> String {
    if let Ok(dir) = std::env::var("VEYLIN_DATA_DIR") {
        if !dir.trim().is_empty() {
            return dir;
        }
    }
    if let Ok(dir) = app.path().app_data_dir() {
        return dir.to_string_lossy().into_owned();
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        return PathBuf::from(home)
            .join(".veylin")
            .to_string_lossy()
            .into_owned();
    }
    "./data".to_string()
}
