use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

const WEB_VIEW_LABEL: &str = "web-view";
const MAIN_LABEL: &str = "main";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContent {
    pub url: String,
    pub title: String,
    pub content: String,
}

fn dock_geometry(app: &AppHandle) -> Result<(f64, f64, f64, f64), String> {
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;

    // outer_position/outer_size are physical pixels; convert to logical so the
    // values match LogicalPosition/LogicalSize on HiDPI (scale != 1) displays.
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let pos = main
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let size = main
        .outer_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);

    let dock_width = (size.width * 0.45).max(480.0);
    let dock_height = size.height;
    let dock_x = pos.x + size.width - dock_width;
    let dock_y = pos.y;

    Ok((dock_x, dock_y, dock_width, dock_height))
}

fn parse_external_url(url: &str) -> Result<url::Url, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is required".to_string());
    }
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    with_scheme
        .parse()
        .map_err(|_| format!("invalid URL: {trimmed}"))
}

#[tauri::command]
pub async fn open_web_view(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = parse_external_url(&url)?;

    if let Some(webview) = app.get_webview_window(WEB_VIEW_LABEL) {
        let escaped = parsed
            .as_str()
            .replace('\\', "\\\\")
            .replace('\'', "\\'");
        webview
            .eval(&format!("window.location.href = '{escaped}';"))
            .map_err(|e| e.to_string())?;
        let (x, y, w, h) = dock_geometry(&app)?;
        let _ = webview.set_position(LogicalPosition::new(x, y));
        let _ = webview.set_size(LogicalSize::new(w, h));
        webview.show().map_err(|e| e.to_string())?;
        webview.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let (dock_x, dock_y, dock_width, dock_height) = dock_geometry(&app)?;

    WebviewWindowBuilder::new(&app, WEB_VIEW_LABEL, WebviewUrl::External(parsed))
        .title("Web")
        .position(dock_x, dock_y)
        .inner_size(dock_width, dock_height)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn read_script(mode: &str) -> &'static str {
    if mode == "html" {
        r#"JSON.stringify({ url: location.href, title: document.title, content: document.documentElement ? document.documentElement.outerHTML : '' })"#
    } else {
        r#"JSON.stringify({ url: location.href, title: document.title, content: document.body ? document.body.innerText : '' })"#
    }
}

fn parse_page_content(raw: &str) -> Result<PageContent, String> {
    if let Ok(page) = serde_json::from_str::<PageContent>(raw) {
        return Ok(page);
    }
    if let Ok(inner) = serde_json::from_str::<String>(raw) {
        return serde_json::from_str(&inner).map_err(|e| format!("parse inner JSON failed: {e}"));
    }
    Err(format!("unexpected read_web_view payload: {raw}"))
}

#[tauri::command]
pub async fn read_web_view(app: AppHandle, mode: Option<String>) -> Result<PageContent, String> {
    let webview = app.get_webview_window(WEB_VIEW_LABEL).ok_or_else(|| {
        "No page open: enter an address in the Web panel on the right and click Open first".to_string()
    })?;

    let mode = mode.unwrap_or_else(|| "text".to_string());
    let script = read_script(mode.as_str());

    let (tx, rx) = mpsc::channel::<String>();
    webview
        .eval_with_callback(script, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    let raw = rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "Timed out reading the page; make sure it has finished loading".to_string())?;

    parse_page_content(&raw)
}
