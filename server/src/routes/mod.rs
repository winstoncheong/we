pub mod actions;
pub mod diff;
pub mod files;
pub mod palette;

use std::convert::Infallible;
use std::sync::Arc;

use askama::Template;
use axum::extract::{Query, State};
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::middleware::Next;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};

use crate::state::App;
use crate::views::{self, View};

#[derive(Template)]
#[template(path = "shell.html")]
pub struct Shell {
    pub view: View,
}

#[derive(Template)]
#[template(path = "partials/tabs.html")]
pub struct Tabs {
    pub view: View,
}

#[derive(Template)]
#[template(path = "partials/status.html")]
pub struct Status {
    pub view: View,
}

#[derive(Template)]
#[template(path = "partials/tree.html")]
pub struct Tree {
    pub view: View,
}

#[derive(Deserialize)]
pub struct PathForm {
    pub path: String,
    #[serde(default)]
    pub dirty: bool,
}

#[derive(Deserialize)]
pub struct DirQuery {
    #[serde(default)]
    pub dir: String,
}

#[derive(Deserialize)]
pub struct FileQuery {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub file: String,
}

#[derive(Serialize)]
pub struct DiffResponse {
    pub path: String,
    pub status: String,
    pub patch: String,
    pub original: String,
    pub current: String,
    pub message: String,
}

pub fn render<T: Template>(template: &T) -> Response {
    match template.render() {
        Ok(body) => {
            let mut response = Html(body).into_response();
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, format!("template: {err}")).into_response(),
    }
}

/// htmx dispatches this after the swapped DOM is in place, so islands can
/// react without racing the fragment swap.
pub fn trigger_after_swap(response: &mut Response, name: &str, detail: serde_json::Value) {
    let payload = serde_json::json!({ name: detail }).to_string();
    if let Ok(value) = HeaderValue::from_str(&payload) {
        response
            .headers_mut()
            .insert("HX-Trigger-After-Swap", value);
    }
}

/// Tabs fragment plus an out-of-band status bar.
pub fn fragment_response(app: &App, event: Option<(&str, serde_json::Value)>) -> Response {
    let view = views::build(app);
    let tabs = Tabs { view: view.clone() }.render();
    let status = Status { view }.render();
    let (Ok(tabs), Ok(status)) = (tabs, status) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "template").into_response();
    };
    let body = format!("{tabs}<div id=\"status\" hx-swap-oob=\"innerHTML\">{status}</div>");
    let mut response = Html(body).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some((name, detail)) = event {
        trigger_after_swap(&mut response, name, detail);
    }
    response
}

async fn index(State(app): State<Arc<App>>, Query(query): Query<FileQuery>) -> Response {
    if !query.file.is_empty() && crate::files::resolve(&app.root, &query.file).is_ok() {
        app.session.write().unwrap().open(&query.file);
    }
    let mut view = views::build(&app);
    views::with_root_tree(&app, &mut view);
    render(&Shell { view })
}

async fn fragment_tabs(State(app): State<Arc<App>>) -> Response {
    render(&Tabs {
        view: views::build(&app),
    })
}

async fn fragment_status(State(app): State<Arc<App>>) -> Response {
    render(&Status {
        view: views::build(&app),
    })
}

async fn fragment_tree(State(app): State<Arc<App>>, Query(query): Query<DirQuery>) -> Response {
    let view = views::build(&app);
    match views::tree_for(&app, &query.dir, &view.active_path) {
        Ok(entries) => render(&Tree {
            view: View {
                entries,
                ..view
            },
        }),
        Err(err) => (StatusCode::NOT_FOUND, err.to_string()).into_response(),
    }
}

async fn events(
    State(app): State<Arc<App>>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    use tokio_stream::StreamExt;

    let stream = tokio_stream::wrappers::BroadcastStream::new(app.fs.subscribe()).map(|message| {
        // A lagged receiver still means "something changed", so never drop it.
        let kind = message.unwrap_or_else(|_| "change".to_string());
        Ok::<_, Infallible>(Event::default().event("fs").data(kind))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn health() -> &'static str {
    "ok"
}

async fn require_token(
    State(app): State<Arc<App>>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let mutating = matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    if mutating {
        let supplied = request
            .headers()
            .get("x-we-token")
            .and_then(|value| value.to_str().ok());
        if supplied != Some(app.token.as_str()) {
            return (StatusCode::FORBIDDEN, "bad token").into_response();
        }
    }
    next.run(request).await
}

pub fn router(app: Arc<App>, assets: &str) -> Router {
    let shared = app.clone();
    Router::new()
        .route("/", get(index))
        .route("/fragments/tabs", get(fragment_tabs))
        .route("/fragments/status", get(fragment_status))
        .route("/fragments/tree", get(fragment_tree))
        .route("/fragments/palette", get(palette::fragment))
        .route("/actions/open", post(actions::open))
        .route("/actions/activate", post(actions::activate))
        .route("/actions/close", post(actions::close))
        .route("/actions/dirty", post(actions::dirty))
        .route("/api/file", get(files::get).put(files::put))
        .route("/api/diff", get(diff::api_diff))
        .route("/diff", get(diff::page))
        .route("/events", get(events))
        .route("/health", get(health))
        .nest_service("/assets", tower_http::services::ServeDir::new(assets))
        .layer(axum::middleware::from_fn_with_state(shared, require_token))
        .with_state(app)
}
