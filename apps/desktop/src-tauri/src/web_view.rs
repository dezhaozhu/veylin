use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl};

const WEB_VIEW_LABEL: &str = "web-view";
const MAIN_LABEL: &str = "main";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContent {
    pub url: String,
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebViewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl WebViewBounds {
    fn sanitized(self) -> Self {
        Self {
            x: self.x.max(0.0),
            y: self.y.max(0.0),
            width: self.width.max(1.0),
            height: self.height.max(1.0),
        }
    }
}

fn fallback_bounds(app: &AppHandle) -> Result<WebViewBounds, String> {
    let main = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;

    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let size = main
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);

    let dock_width = (size.width * 0.45).max(480.0);
    Ok(WebViewBounds {
        x: size.width - dock_width,
        y: 0.0,
        width: dock_width,
        height: size.height,
    })
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
pub async fn open_web_view(
    app: AppHandle,
    url: String,
    bounds: Option<WebViewBounds>,
) -> Result<(), String> {
    let parsed = parse_external_url(&url)?;
    let bounds = bounds
        .map(WebViewBounds::sanitized)
        .unwrap_or(fallback_bounds(&app)?);

    if let Some(webview) = app.get_webview(WEB_VIEW_LABEL) {
        let escaped = parsed
            .as_str()
            .replace('\\', "\\\\")
            .replace('\'', "\\'");
        webview
            .eval(&format!("window.location.href = '{escaped}';"))
            .map_err(|e| e.to_string())?;
        let _ = webview.set_position(LogicalPosition::new(bounds.x, bounds.y));
        let _ = webview.set_size(LogicalSize::new(bounds.width, bounds.height));
        webview.show().map_err(|e| e.to_string())?;
        webview.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let main = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;

    main.add_child(
        WebviewBuilder::new(WEB_VIEW_LABEL, WebviewUrl::External(parsed)),
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height),
    )
    .map_err(|e| e.to_string())?
    .set_focus()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn resize_web_view(app: AppHandle, bounds: WebViewBounds) -> Result<(), String> {
    if let Some(webview) = app.get_webview(WEB_VIEW_LABEL) {
        let bounds = bounds.sanitized();
        webview
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_web_view(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(WEB_VIEW_LABEL) {
        webview.hide().map_err(|e| e.to_string())?;
    }
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
    let webview = app.get_webview(WEB_VIEW_LABEL).ok_or_else(|| {
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
