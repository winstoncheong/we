use std::sync::Arc;

use askama::Template;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use super::{render, DiffResponse, FileQuery};
use crate::files;
use crate::git;
use crate::state::App;
use crate::views::{self, View};

#[derive(Template)]
#[template(path = "diff.html")]
struct DiffShell {
    view: View,
}

pub async fn api_diff(State(app): State<Arc<App>>, Query(query): Query<FileQuery>) -> Response {
    let current = files::read_text(&app.root, &query.path).unwrap_or_default();
    let payload = git::diff(&app.root, &query.path, &current).await;
    Json(DiffResponse {
        path: payload.path,
        status: payload.status,
        patch: payload.patch,
        original: payload.original,
        current: payload.current,
        message: payload.message,
    })
    .into_response()
}

pub async fn page(State(app): State<Arc<App>>, Query(query): Query<FileQuery>) -> Response {
    if files::resolve(&app.root, &query.path).is_err() {
        return (StatusCode::NOT_FOUND, "no such file").into_response();
    }
    app.session.write().unwrap().activate(&query.path);
    let mut view = views::build(&app);
    view.diff_mode = true;
    render(&DiffShell { view })
}
