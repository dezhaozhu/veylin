use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl};

const MAIN_LABEL: &str = "main";
const WEB_VIEW_PREFIX: &str = "web-view-";

pub struct ActiveWebTab(pub Mutex<Option<String>>);

fn set_active_tab(state: &ActiveWebTab, tab_id: &str) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(tab_id.to_string());
    }
}

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

fn web_view_label(tab_id: &str) -> Result<String, String> {
    let trimmed = tab_id.trim();
    if trimmed.is_empty() {
        return Err("tabId is required".to_string());
    }
    let safe: String = trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    Ok(format!("{WEB_VIEW_PREFIX}{safe}"))
}

fn is_panel_web_view_label(label: &str) -> bool {
    label.starts_with(WEB_VIEW_PREFIX)
}

fn hide_all_panel_web_views(app: &AppHandle) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if is_panel_web_view_label(&label) {
            let _ = webview.hide();
        }
    }
    Ok(())
}

fn apply_bounds(webview: &tauri::Webview, bounds: WebViewBounds) -> Result<(), String> {
    let bounds = bounds.sanitized();
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())?;
    Ok(())
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

fn navigate_webview(webview: &tauri::Webview, parsed: &url::Url) -> Result<(), String> {
    let escaped = parsed
        .as_str()
        .replace('\\', "\\\\")
        .replace('\'', "\\'");
    webview
        .eval(&format!("window.location.href = '{escaped}';"))
        .map_err(|e| e.to_string())
}

fn create_panel_webview(
    app: &AppHandle,
    label: &str,
    parsed: url::Url,
    bounds: WebViewBounds,
) -> Result<(), String> {
    let main = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;

    main.add_child(
        WebviewBuilder::new(label, WebviewUrl::External(parsed)),
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(bounds.width, bounds.height),
    )
    .map_err(|e| e.to_string())?
    .set_focus()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Open or navigate a per-tab web view. Each right-panel web tab gets its own webview.
#[tauri::command]
pub async fn open_web_view(
    app: AppHandle,
    active: State<'_, ActiveWebTab>,
    tab_id: String,
    url: String,
    bounds: Option<WebViewBounds>,
) -> Result<(), String> {
    let label = web_view_label(&tab_id)?;
    let parsed = parse_external_url(&url)?;
    let bounds = bounds
        .map(WebViewBounds::sanitized)
        .unwrap_or(fallback_bounds(&app)?);

    hide_all_panel_web_views(&app)?;

    if let Some(webview) = app.get_webview(&label) {
        navigate_webview(&webview, &parsed)?;
        apply_bounds(&webview, bounds)?;
        webview.show().map_err(|e| e.to_string())?;
        webview.set_focus().map_err(|e| e.to_string())?;
        set_active_tab(&active, &tab_id);
        return Ok(());
    }

    create_panel_webview(&app, &label, parsed, bounds)?;
    set_active_tab(&active, &tab_id);
    Ok(())
}

/// Show an existing tab webview without navigating (used when switching tabs).
/// Returns true when the webview existed and was shown.
#[tauri::command]
pub async fn show_web_view(
    app: AppHandle,
    active: State<'_, ActiveWebTab>,
    tab_id: String,
    bounds: Option<WebViewBounds>,
) -> Result<bool, String> {
    let label = web_view_label(&tab_id)?;
    let bounds = bounds
        .map(WebViewBounds::sanitized)
        .unwrap_or(fallback_bounds(&app)?);

    hide_all_panel_web_views(&app)?;

    let Some(webview) = app.get_webview(&label) else {
        return Ok(false);
    };

    apply_bounds(&webview, bounds)?;
    webview.show().map_err(|e| e.to_string())?;
    webview.set_focus().map_err(|e| e.to_string())?;
    set_active_tab(&active, &tab_id);
    Ok(true)
}

#[tauri::command]
pub async fn resize_web_view(
    app: AppHandle,
    tab_id: String,
    bounds: WebViewBounds,
) -> Result<(), String> {
    let label = web_view_label(&tab_id)?;
    if let Some(webview) = app.get_webview(&label) {
        apply_bounds(&webview, bounds)?;
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_web_view(app: AppHandle, tab_id: Option<String>) -> Result<(), String> {
    if let Some(tab_id) = tab_id {
        let label = web_view_label(&tab_id)?;
        if let Some(webview) = app.get_webview(&label) {
            webview.hide().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    hide_all_panel_web_views(&app)
}

#[tauri::command]
pub async fn close_web_view(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = web_view_label(&tab_id)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
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
pub async fn read_web_view(
    app: AppHandle,
    active: State<'_, ActiveWebTab>,
    tab_id: Option<String>,
    mode: Option<String>,
) -> Result<PageContent, String> {
    let resolved_tab = tab_id.or_else(|| active.0.lock().ok().and_then(|g| g.clone()));

    let webview = match resolved_tab {
        Some(tab_id) => {
            let label = web_view_label(&tab_id)?;
            app.get_webview(&label)
        }
        None => None,
    }
    .ok_or_else(|| {
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
