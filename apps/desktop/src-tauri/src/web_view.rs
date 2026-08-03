use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl,
};

const MAIN_LABEL: &str = "main";
const WEB_VIEW_PREFIX: &str = "web-view-";
const WEB_VIEW_NAVIGATED_EVENT: &str = "web-view-navigated";

/// Force target=_blank / window.open to navigate in the same panel webview.
const SAME_TAB_NAV_SCRIPT: &str = r#"
(function () {
  if (window.__veylinSameTabNav) return;
  window.__veylinSameTabNav = true;
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var anchor = target.closest('a[href]');
    if (!anchor) return;
    var href = anchor.href;
    if (!href || href.indexOf('javascript:') === 0) return;
    var targetAttr = (anchor.getAttribute('target') || '').toLowerCase();
    if (targetAttr !== '_blank' && targetAttr !== '_new') return;
    event.preventDefault();
    event.stopPropagation();
    window.location.assign(href);
  }, true);
  var originalOpen = window.open;
  window.open = function (url) {
    if (typeof url === 'string' && url && url.indexOf('javascript:') !== 0) {
      window.location.assign(url);
      return null;
    }
    if (typeof originalOpen === 'function') {
      return originalOpen.apply(window, arguments);
    }
    return null;
  };
})();
"#;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebViewNavigatedPayload {
    tab_id: String,
    url: String,
    title: String,
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

    // Keep clear of the right-panel tab strip (~32px) and address chrome (~36px).
    let top_chrome = 68.0;
    let dock_width = (size.width * 0.45).max(480.0);
    Ok(WebViewBounds {
        x: size.width - dock_width,
        y: top_chrome,
        width: dock_width,
        height: (size.height - top_chrome).max(1.0),
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
    webview.navigate(parsed.clone()).map_err(|e| e.to_string())
}

fn install_same_tab_navigation(webview: &tauri::Webview) {
    let _ = webview.eval(SAME_TAB_NAV_SCRIPT);
}

fn emit_navigated(app: &AppHandle, tab_id: &str, url: &str, title: &str) {
    let _ = app.emit(
        WEB_VIEW_NAVIGATED_EVENT,
        WebViewNavigatedPayload {
            tab_id: tab_id.to_string(),
            url: url.to_string(),
            title: title.to_string(),
        },
    );
}

fn create_panel_webview(
    app: &AppHandle,
    label: &str,
    tab_id: &str,
    parsed: url::Url,
    bounds: WebViewBounds,
) -> Result<(), String> {
    let main = app
        .get_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;

    let app_for_new_window = app.clone();
    let label_for_new_window = label.to_string();
    let tab_id_for_new_window = tab_id.to_string();

    let app_for_page_load = app.clone();
    let tab_id_for_page_load = tab_id.to_string();

    // Do not set_focus here: focusing the child webview blurs the main window and
    // can race with frontend hide/visibility guards, making the panel flash away.
    //
    // target=_blank / window.open → stay in this panel webview (no popup).
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed))
        .initialization_script(SAME_TAB_NAV_SCRIPT)
        .on_new_window(move |url, _features| {
            if let Some(webview) = app_for_new_window.get_webview(&label_for_new_window) {
                let _ = navigate_webview(&webview, &url);
                emit_navigated(
                    &app_for_new_window,
                    &tab_id_for_new_window,
                    url.as_str(),
                    "",
                );
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            install_same_tab_navigation(&webview);
            emit_navigated(
                &app_for_page_load,
                &tab_id_for_page_load,
                payload.url().as_str(),
                "",
            );
        });

    main
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
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
        install_same_tab_navigation(&webview);
        webview.show().map_err(|e| e.to_string())?;
        set_active_tab(&active, &tab_id);
        return Ok(());
    }

    create_panel_webview(&app, &label, &tab_id, parsed, bounds)?;
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
    install_same_tab_navigation(&webview);
    webview.show().map_err(|e| e.to_string())?;
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

fn panel_webview<'a>(app: &'a AppHandle, tab_id: &str) -> Result<tauri::Webview, String> {
    let label = web_view_label(tab_id)?;
    app.get_webview(&label)
        .ok_or_else(|| "No page open in this web tab".to_string())
}

#[tauri::command]
pub async fn web_view_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    let webview = panel_webview(&app, &tab_id)?;
    webview
        .eval("history.back()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn web_view_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    let webview = panel_webview(&app, &tab_id)?;
    webview
        .eval("history.forward()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn web_view_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    let webview = panel_webview(&app, &tab_id)?;
    webview
        .eval("location.reload()")
        .map_err(|e| e.to_string())
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
