use napi::bindgen_prelude::{AsyncTask, Buffer, Task};
use napi::{Env, Error, Result, Status};
use napi_derive::napi;
use redcode_path_search_poc::Index;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

type SharedIndex = Arc<Mutex<Index>>;

static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static INDEXES: OnceLock<Mutex<HashMap<u32, SharedIndex>>> = OnceLock::new();

fn indexes() -> &'static Mutex<HashMap<u32, SharedIndex>> {
    INDEXES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_error() -> Error {
    Error::new(Status::GenericFailure, "filename index lock poisoned")
}

pub struct CreateTask {
    data: Buffer,
}

impl Task for CreateTask {
    type Output = u32;
    type JsValue = u32;

    fn compute(&mut self) -> Result<Self::Output> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let files = serde_json::from_slice::<Vec<String>>(&self.data)
            .map_err(|error| Error::new(Status::InvalidArg, error.to_string()))?;
        let index = Arc::new(Mutex::new(Index::new(files)));
        indexes()
            .lock()
            .map_err(|_| lock_error())?
            .insert(id, index);
        Ok(id)
    }

    fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn create_index(data: Buffer) -> AsyncTask<CreateTask> {
    AsyncTask::new(CreateTask { data })
}

#[derive(serde::Serialize)]
struct SearchEntry {
    path: String,
    #[serde(rename = "type")]
    kind: &'static str,
}

pub struct SearchTask {
    index: SharedIndex,
    query: String,
    kind: u32,
    limit: usize,
}

fn search_json(index: &SharedIndex, query: &str, kind: u32, limit: usize) -> Result<String> {
    let entries = index
        .lock()
        .map_err(|_| lock_error())?
        .search_owned(query, kind, limit)
        .into_iter()
        .map(|entry| SearchEntry {
            path: entry.path,
            kind: if entry.directory { "directory" } else { "file" },
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&entries)
        .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))
}

impl Task for SearchTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        search_json(&self.index, &self.query, self.kind, self.limit)
    }

    fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

fn find_index(id: u32) -> Result<SharedIndex> {
    indexes()
        .lock()
        .map_err(|_| lock_error())?
        .get(&id)
        .cloned()
        .ok_or_else(|| Error::new(Status::InvalidArg, "filename index does not exist"))
}

#[napi]
pub fn search_index(
    id: u32,
    query: String,
    kind: u32,
    limit: u32,
) -> Result<AsyncTask<SearchTask>> {
    let index = find_index(id)?;
    Ok(AsyncTask::new(SearchTask {
        index,
        query,
        kind,
        limit: limit as usize,
    }))
}

#[napi]
pub fn search_index_sync(id: u32, query: String, kind: u32, limit: u32) -> Result<String> {
    search_json(&find_index(id)?, &query, kind, limit as usize)
}

#[napi]
pub fn drop_index(id: u32) -> Result<bool> {
    Ok(indexes()
        .lock()
        .map_err(|_| lock_error())?
        .remove(&id)
        .is_some())
}

#[napi]
pub fn index_count() -> Result<u32> {
    u32::try_from(indexes().lock().map_err(|_| lock_error())?.len())
        .map_err(|_| Error::new(Status::GenericFailure, "filename index count overflow"))
}
