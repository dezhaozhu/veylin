use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

enum SidecarChild {
    Shell(CommandChild),
    Process(Child),
}

#[derive(Clone, Serialize)]
pub struct SidecarStatus {
    pub spawn_ok: bool,
    pub error: Option<String>,
}

/// Handle to the spawned BFF server process.
pub struct Sidecar {
    child: Mutex<Option<SidecarChild>>,
    status: Arc<Mutex<SidecarStatus>>,
}

impl Sidecar {
    pub fn new() -> Self {
        Sidecar {
            child: Mutex::new(None),
            status: Arc::new(Mutex::new(SidecarStatus {
                spawn_ok: false,
                error: None,
            })),
        }
    }

    pub fn status(&self) -> SidecarStatus {
        self.status.lock().unwrap().clone()
    }

    fn set_status(&self, spawn_ok: bool, error: Option<String>) {
        *self.status.lock().unwrap() = SidecarStatus { spawn_ok, error };
    }

    /// Spawn the Node BFF server. Skipped when VEYLIN_SKIP_SIDECAR=1.
    pub fn spawn(&self, app: &AppHandle) {
        if std::env::var("VEYLIN_SKIP_SIDECAR").as_deref() == Ok("1") {
            self.set_status(true, None);
            return;
        }

        let data_dir = app_data_dir(app);
        let port = std::env::var("PORT").unwrap_or_else(|_| "8787".into());

        if let Ok(sidecar) = app.shell().sidecar("veylin-server") {
            let mut cmd = sidecar
                .env("VEYLIN_DATA_DIR", &data_dir)
                .env("VEYLIN_DESKTOP_AUTH", "1")
                .env("VEYLIN_REQUIRE_USER_MODEL_SETTINGS", "1")
                .env("PORT", &port);
            if let Some(path) = model_catalog_path(&data_dir) {
                cmd = cmd.env("VEYLIN_MODEL_CATALOG_PATH", path);
            }
            match cmd.spawn() {
                Ok((_rx, child)) => {
                    *self.child.lock().unwrap() = Some(SidecarChild::Shell(child));
                    self.set_status(true, None);
                    return;
                }
                Err(err) => {
                    let msg = format!("failed to spawn packaged sidecar: {err}");
                    eprintln!("[sidecar] {msg}");
                    self.set_status(false, Some(msg));
                }
            }
        }

        if let Ok(bin) = std::env::var("VEYLIN_SERVER_BIN") {
            if !bin.trim().is_empty() {
                match Command::new(&bin)
                    .env("VEYLIN_DATA_DIR", &data_dir)
                    .env("VEYLIN_DESKTOP_AUTH", "1")
                    .env("VEYLIN_REQUIRE_USER_MODEL_SETTINGS", "1")
                    .env("PORT", &port)
                    .spawn()
                {
                    Ok(child) => {
                        let pid = child.id();
                        *self.child.lock().unwrap() = Some(SidecarChild::Process(child));
                        self.set_status(true, None);
                        self.spawn_process_watchdog(pid);
                        return;
                    }
                    Err(err) => {
                        let msg = format!("failed to spawn VEYLIN_SERVER_BIN: {err}");
                        eprintln!("[sidecar] {msg}");
                        self.set_status(false, Some(msg));
                    }
                }
            }
        }

        #[cfg(debug_assertions)]
        {
            self.spawn_dev_fallback(&port);
            return;
        }

        #[cfg(not(debug_assertions))]
        {
            if !self.status().spawn_ok {
                let msg = "no sidecar binary available; reinstall the app or set VEYLIN_SERVER_BIN";
                eprintln!("[sidecar] {msg}");
                self.set_status(false, Some(msg.into()));
            }
        }
    }

    #[cfg(debug_assertions)]
    fn spawn_dev_fallback(&self, port: &str) {
        let mut root = std::env::current_dir().ok();
        for ancestor in root.as_ref().into_iter().flat_map(|p| p.ancestors()) {
            if ancestor.join("package.json").exists() && ancestor.join("apps").join("server").exists()
            {
                root = Some(ancestor.to_path_buf());
                break;
            }
        }
        let Some(root) = root else {
            let msg = "no dev repo root found; set VEYLIN_SERVER_BIN or run via tauri dev";
            eprintln!("[sidecar] {msg}");
            self.set_status(false, Some(msg.into()));
            return;
        };

        match Command::new("npm")
            .args(["run", "-w", "@veylin/server", "start"])
            .current_dir(&root)
            .env("VEYLIN_REPO_ROOT", root.to_string_lossy().as_ref())
            .env(
                "VEYLIN_DATA_DIR",
                root.join("data").to_string_lossy().as_ref(),
            )
            .env("VEYLIN_DESKTOP_AUTH", "1")
            .env("VEYLIN_REQUIRE_USER_MODEL_SETTINGS", "1")
            .env(
                "VEYLIN_MODEL_CATALOG_PATH",
                root.join("data/models.local.json").to_string_lossy().as_ref(),
            )
            .env("PORT", port)
            .spawn()
        {
            Ok(child) => {
                let pid = child.id();
                *self.child.lock().unwrap() = Some(SidecarChild::Process(child));
                self.set_status(true, None);
                self.spawn_process_watchdog(pid);
            }
            Err(err) => {
                let msg = format!("failed to spawn dev server: {err}");
                eprintln!("[sidecar] {msg}");
                self.set_status(false, Some(msg));
            }
        }
    }

    fn spawn_process_watchdog(&self, pid: u32) {
        let status = Arc::clone(&self.status);
        std::thread::spawn(move || {
            #[cfg(unix)]
            {
                use std::process::Command as StdCommand;
                loop {
                    std::thread::sleep(Duration::from_secs(2));
                    let exited = StdCommand::new("kill")
                        .args(["-0", &pid.to_string()])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status()
                        .map(|s| !s.success())
                        .unwrap_or(true);
                    if exited {
                        let mut guard = status.lock().unwrap();
                        if guard.spawn_ok {
                            guard.spawn_ok = false;
                            guard.error = Some("sidecar process exited unexpectedly".into());
                        }
                        break;
                    }
                }
            }
            #[cfg(not(unix))]
            {
                let _ = pid;
            }
        });
    }

    pub fn kill(&self) {
        let child = self.child.lock().unwrap().take();
        if let Some(child) = child {
            match child {
                SidecarChild::Shell(c) => {
                    let _ = c.kill();
                }
                SidecarChild::Process(mut c) => {
                    terminate_child_gracefully(&mut c);
                }
            }
        }
    }
}

#[tauri::command]
pub fn get_sidecar_status(sidecar: tauri::State<'_, Sidecar>) -> SidecarStatus {
    sidecar.status()
}

fn terminate_child_gracefully(child: &mut Child) {
    let pid = child.id();
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        for _ in 0..30 {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn model_catalog_path(data_dir: &str) -> Option<String> {
    if let Ok(path) = std::env::var("VEYLIN_MODEL_CATALOG_PATH") {
        if !path.trim().is_empty() {
            return Some(path);
        }
    }
    let in_data = PathBuf::from(data_dir).join("models.local.json");
    if in_data.exists() {
        return Some(in_data.to_string_lossy().into_owned());
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let path = PathBuf::from(home).join(".veylin").join("models.local.json");
        if path.exists() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
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
