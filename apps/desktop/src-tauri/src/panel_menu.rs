//! Floating panel "+" menu as a separate always-on-top window so it can paint
//! above the docked native webview without resizing or hiding the page.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const MENU_LABEL: &str = "panel-menu";
const SELECT_EVENT: &str = "panel-menu-select";
const CLOSED_EVENT: &str = "panel-menu-closed";
/// Ignore Focused(false) briefly after show — macOS often flickers focus when
/// an always-on-top child opens above a docked webview.
const FOCUS_GRACE: Duration = Duration::from_millis(250);
/// After an intentional destroy/replace, ignore teardown events briefly so
/// Focused(false) + CloseRequested do not emit `panel-menu-closed`.
const TEARDOWN_IGNORE: Duration = Duration::from_millis(400);

static MENU_SHOWN_AT: Mutex<Option<Instant>> = Mutex::new(None);
static IGNORE_WINDOW_EVENTS_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelMenuItem {
    pub kind: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PanelMenuSelectPayload {
    kind: String,
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn menu_html(items: &[PanelMenuItem]) -> String {
    let rows = items
        .iter()
        .map(|item| {
            let kind = escape_html(&item.kind);
            let label = escape_html(&item.label);
            let title = item
                .description
                .as_deref()
                .map(escape_html)
                .unwrap_or_default();
            format!(
                r#"<button type="button" class="row" data-kind="{kind}" title="{title}"><span class="label">{label}</span></button>"#
            )
        })
        .collect::<Vec<_>>()
        .join("");

    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
html,body{{margin:0;padding:0;background:#fff;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;overflow:hidden;user-select:none}}
.panel{{padding:4px}}
.row{{display:flex;width:100%;align-items:center;border:0;background:transparent;border-radius:8px;padding:8px 10px;text-align:left;cursor:pointer;color:inherit;font:inherit}}
.row:hover{{background:rgba(0,0,0,.06)}}
.label{{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
@media (prefers-color-scheme: dark){{html,body{{background:#1c1c1e;color:#f5f5f5}}.row:hover{{background:rgba(255,255,255,.08)}}}}
</style></head><body><div class="panel">{rows}</div><script>
document.querySelectorAll('.row').forEach((btn)=>{{btn.addEventListener('click',()=>{{window.__TAURI_INTERNALS__.invoke('panel_menu_choose',{{kind:btn.getAttribute('data-kind')||''}});}});}});
window.addEventListener('keydown',(e)=>{{if(e.key==='Escape')window.__TAURI_INTERNALS__.invoke('close_panel_menu');}});
</script></body></html>"#
    )
}

fn mark_intentional_teardown() {
    if let Ok(mut guard) = IGNORE_WINDOW_EVENTS_UNTIL.lock() {
        *guard = Some(Instant::now() + TEARDOWN_IGNORE);
    }
}

fn should_ignore_window_event() -> bool {
    IGNORE_WINDOW_EVENTS_UNTIL
        .lock()
        .ok()
        .and_then(|g| *g)
        .is_some_and(|until| Instant::now() < until)
}

fn close_existing(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MENU_LABEL) {
        mark_intentional_teardown();
        let _ = window.close();
    }
}

fn data_url_for_html(html: &str) -> Result<url::Url, String> {
    let encoded = html
        .as_bytes()
        .iter()
        .map(|b| match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                String::from(*b as char)
            }
            b' ' => "%20".to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect::<String>();
    format!("data:text/html;charset=utf-8,{encoded}")
        .parse()
        .map_err(|e| format!("invalid data url: {e}"))
}

#[tauri::command]
pub async fn show_panel_menu(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    items: Vec<PanelMenuItem>,
) -> Result<(), String> {
    close_existing(&app);

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let html = menu_html(&items);
    let data_url = data_url_for_html(&html)?;
    let width = width.max(160.0);
    let height = height.max(80.0);

    let mut builder = WebviewWindowBuilder::new(&app, MENU_LABEL, WebviewUrl::External(data_url))
        .title("Panel Menu")
        .inner_size(width, height)
        .position(x, y)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(true)
        .visible(false);

    builder = builder.parent(&main).map_err(|e| e.to_string())?;

    let window = builder.build().map_err(|e| e.to_string())?;
    if let Ok(mut guard) = MENU_SHOWN_AT.lock() {
        *guard = Some(Instant::now());
    }
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn close_panel_menu(app: AppHandle) -> Result<(), String> {
    let existed = app.get_webview_window(MENU_LABEL).is_some();
    close_existing(&app);
    if existed {
        let _ = app.emit(CLOSED_EVENT, ());
    }
    Ok(())
}

#[tauri::command]
pub async fn panel_menu_choose(app: AppHandle, kind: String) -> Result<(), String> {
    let _ = app.emit(
        SELECT_EVENT,
        PanelMenuSelectPayload {
            kind: kind.trim().to_string(),
        },
    );
    close_existing(&app);
    let _ = app.emit(CLOSED_EVENT, ());
    Ok(())
}

/// Close the floating menu when it loses focus (click outside).
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != MENU_LABEL {
        return;
    }
    if should_ignore_window_event() {
        return;
    }
    match event {
        WindowEvent::Focused(false) => {
            let within_grace = MENU_SHOWN_AT
                .lock()
                .ok()
                .and_then(|g| *g)
                .is_some_and(|at| at.elapsed() < FOCUS_GRACE);
            if within_grace {
                return;
            }
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = close_panel_menu(app).await;
            });
        }
        WindowEvent::CloseRequested { .. } => {
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = close_panel_menu(app).await;
            });
        }
        _ => {}
    }
}
