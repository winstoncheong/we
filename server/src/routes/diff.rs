use std::sync::Arc;

use askama::Template;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

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

/// The base payload plus the fields the diff island needs to pick an empty
/// state and to print +/- counts before the patch is parsed.
#[derive(Serialize)]
struct DiffView {
    #[serde(flatten)]
    base: DiffResponse,
    is_repo: bool,
    kind: String,
    additions: usize,
    deletions: usize,
}

pub async fn api_diff(State(app): State<Arc<App>>, Query(query): Query<FileQuery>) -> Response {
    // Read failures are classified (binary / too large / deleted) rather than
    // swallowed: the client renders a specific empty state for each.
    let current = files::read_text(&app.root, &query.path);
    let payload = git::diff(&app.root, &query.path, current).await;
    Json(DiffView {
        base: DiffResponse {
            path: payload.path,
            status: payload.status,
            patch: payload.patch,
            original: payload.original,
            current: payload.current,
            message: payload.message,
        },
        is_repo: payload.is_repo,
        kind: payload.kind,
        additions: payload.additions,
        deletions: payload.deletions,
    })
    .into_response()
}

pub async fn page(State(app): State<Arc<App>>, Query(query): Query<FileQuery>) -> Response {
    if files::resolve(&app.root, &query.path).is_err() {
        return (StatusCode::NOT_FOUND, "no such file").into_response();
    }
    // `open` (not `activate`): a diff URL may be the first thing opened in a
    // fresh session, and the page needs the file in the tab strip + session.
    app.session.write().unwrap().open(&query.path);
    let mut view = views::build(&app);
    view.diff_mode = true;
    render(&DiffShell { view })
}
