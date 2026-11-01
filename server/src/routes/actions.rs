use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Form;

use super::{fragment_response, PathForm};
use crate::files;
use crate::state::App;

pub async fn open(State(app): State<Arc<App>>, Form(form): Form<PathForm>) -> Response {
    if files::resolve(&app.root, &form.path).is_err() {
        return (StatusCode::NOT_FOUND, "no such file").into_response();
    }
    app.session.write().unwrap().open(&form.path);
    fragment_response(
        &app,
        Some(("we:open", serde_json::json!({ "path": form.path }))),
    )
}

pub async fn activate(State(app): State<Arc<App>>, Form(form): Form<PathForm>) -> Response {
    app.session.write().unwrap().activate(&form.path);
    fragment_response(
        &app,
        Some(("we:open", serde_json::json!({ "path": form.path }))),
    )
}

pub async fn close(State(app): State<Arc<App>>, Form(form): Form<PathForm>) -> Response {
    let active = {
        let mut session = app.session.write().unwrap();
        session.close(&form.path);
        session.active.clone().unwrap_or_default()
    };
    fragment_response(&app, Some(("we:open", serde_json::json!({ "path": active }))))
}

pub async fn dirty(State(app): State<Arc<App>>, Form(form): Form<PathForm>) -> Response {
    app.session
        .write()
        .unwrap()
        .set_dirty(&form.path, form.dirty);
    fragment_response(&app, None)
}
