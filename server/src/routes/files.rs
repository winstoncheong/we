use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

use super::{trigger_after_swap, FileQuery};
use crate::files;
use crate::state::App;

pub async fn get(State(app): State<Arc<App>>, Query(query): Query<FileQuery>) -> Response {
    match files::read_text(&app.root, &query.path) {
        Ok(text) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            text,
        )
            .into_response(),
        Err(err) => (StatusCode::UNPROCESSABLE_ENTITY, err.to_string()).into_response(),
    }
}

pub async fn put(
    State(app): State<Arc<App>>,
    Query(query): Query<FileQuery>,
    body: Bytes,
) -> Response {
    let Ok(text) = std::str::from_utf8(&body) else {
        return (StatusCode::BAD_REQUEST, "not utf-8").into_response();
    };
    match files::write_text(&app.root, &query.path, text) {
        Ok(()) => {
            app.session
                .write()
                .unwrap()
                .set_dirty(&query.path, false);
            let mut response = StatusCode::NO_CONTENT.into_response();
            trigger_after_swap(
                &mut response,
                "we:saved",
                serde_json::json!({ "path": query.path }),
            );
            response
        }
        Err(err) => (StatusCode::UNPROCESSABLE_ENTITY, err.to_string()).into_response(),
    }
}
