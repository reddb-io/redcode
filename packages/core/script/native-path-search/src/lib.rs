//! Experimental filename index. No filesystem watcher, content indexing or Git worker.
//! The host owns scanning/refresh and must serialize calls for each opaque handle.
use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32String};
use serde::Serialize;
use std::collections::BTreeSet;
#[cfg(feature = "typo-signature-cache-experiment")]
use std::collections::HashMap;
use std::ffi::{c_char, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, Receiver, TryRecvError};

pub const ABI_VERSION: u32 = 1;

struct Item {
    path: String,
    text: Utf32String,
    #[cfg(feature = "ranking-basename-experiment")]
    basename: Utf32String,
    #[cfg(feature = "typo-mask-experiment")]
    letters: u32,
    #[cfg(feature = "typo-path-filter-experiment")]
    path_letters: u32,
    #[cfg(feature = "typo-path-filter-experiment")]
    ascii_path: bool,
    #[cfg(feature = "typo-signature-cache-experiment")]
    signature: usize,
    directory: bool,
}

impl Item {
    fn new(path: String, directory: bool) -> Self {
        let text = Utf32String::from(path.as_str());
        #[cfg(feature = "ranking-basename-experiment")]
        let basename =
            Utf32String::from(path.trim_end_matches('/').rsplit('/').next().unwrap_or(""));
        #[cfg(feature = "typo-mask-experiment")]
        let letters = letter_mask(
            path.trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or("")
                .as_bytes(),
        );
        #[cfg(feature = "typo-path-filter-experiment")]
        let path_letters = letter_mask(path.as_bytes());
        #[cfg(feature = "typo-path-filter-experiment")]
        let ascii_path = path.is_ascii();
        Self {
            path,
            text,
            #[cfg(feature = "ranking-basename-experiment")]
            basename,
            #[cfg(feature = "typo-mask-experiment")]
            letters,
            #[cfg(feature = "typo-path-filter-experiment")]
            path_letters,
            #[cfg(feature = "typo-path-filter-experiment")]
            ascii_path,
            #[cfg(feature = "typo-signature-cache-experiment")]
            signature: 0,
            directory,
        }
    }
}

pub struct Index {
    items: Vec<Item>,
    matcher: Matcher,
    scored: Vec<(usize, u64)>,
    #[cfg(feature = "typo-signature-cache-experiment")]
    signatures: Vec<Vec<u8>>,
    #[cfg(feature = "neo-pool-experiment")]
    neo_pool: rayon::ThreadPool,
}

#[derive(Serialize)]
struct Entry<'a> {
    path: &'a str,
    #[serde(rename = "type")]
    kind: &'static str,
}

impl Index {
    pub fn new(files: Vec<String>) -> Self {
        let mut directories = BTreeSet::new();
        let mut items = Vec::with_capacity(files.len());
        for file in files {
            let file = file.replace('\\', "/");
            for (offset, _) in file.match_indices('/') {
                directories.insert(file[..=offset].to_owned());
            }
            items.push(Item::new(file, false));
        }
        items.extend(directories.into_iter().map(|p| Item::new(p, true)));
        #[cfg(feature = "typo-signature-cache-experiment")]
        let signatures = {
            let mut lookup = HashMap::new();
            let mut values = Vec::new();
            for item in &mut items {
                let name = item
                    .path
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("");
                let key = name_signature(name.as_bytes());
                item.signature = *lookup.entry(key.clone()).or_insert_with(|| {
                    values.push(key);
                    values.len() - 1
                });
            }
            values
        };
        Self {
            items,
            matcher: Matcher::new(Config::DEFAULT.match_paths()),
            scored: Vec::new(),
            #[cfg(feature = "typo-signature-cache-experiment")]
            signatures,
            #[cfg(feature = "neo-pool-experiment")]
            neo_pool: rayon::ThreadPoolBuilder::new()
                .num_threads(2)
                .thread_name(|index| format!("redcode-neo-{index}"))
                .build()
                .expect("could not create experimental search workers"),
        }
    }

    fn search(&mut self, query: &str, kind: u32, limit: usize) -> Vec<Entry<'_>> {
        self.scored.clear();
        if query.trim().is_empty()
            || query.contains('\0')
            || query.chars().all(|c| {
                c.is_whitespace() || matches!(c, '\u{200b}' | '\u{200c}' | '\u{200d}' | '\u{feff}')
            })
            || limit == 0
        {
            return Vec::new();
        }
        #[cfg(feature = "neo-frizbee-experiment")]
        if !query.is_empty() {
            return self.neo_search(query, kind, limit);
        }
        // Match whitespace-separated fuzzy terms without introducing fzf's special operators.
        let pattern = Pattern::new(
            query,
            CaseMatching::Ignore,
            Normalization::Smart,
            AtomKind::Fuzzy,
        );
        #[cfg(feature = "typo-single-pass-experiment")]
        let typo_enabled =
            (6..=64).contains(&query.len()) && query.bytes().all(|byte| byte.is_ascii_alphabetic());
        #[cfg(feature = "typo-single-pass-experiment")]
        let query_letters = letter_mask(query.as_bytes());
        #[cfg(feature = "typo-signature-cache-experiment")]
        let mut signature_cache = vec![None; self.signatures.len()];
        for (index, item) in self.items.iter().enumerate() {
            if (kind == 1 && item.directory) || (kind == 2 && !item.directory) {
                continue;
            }
            #[cfg(feature = "typo-path-filter-experiment")]
            if typo_enabled
                && item.ascii_path
                && query_letters & !item.path_letters != 0
                && (query_letters & !item.letters).count_ones() > 1
            {
                continue;
            }
            #[cfg(feature = "typo-score-shortcut-experiment")]
            if typo_enabled
                && query.len() <= 32
                && (query_letters & !item.letters).count_ones() <= 1
            {
                let approximate = *signature_cache[item.signature].get_or_insert_with(|| {
                    approximate_name_match(query.as_bytes(), &self.signatures[item.signature])
                });
                if approximate {
                    // nucleo-matcher 0.3.1, Config::DEFAULT.match_paths(), a single
                    // ASCII fuzzy atom: at most 25 per character plus 9 for its
                    // first character. Full score plus basename score is <= 11 *
                    // (25 * 32 + 9) < 10,000, the approximation floor below.
                    self.scored.push((index, 10_000));
                    continue;
                }
            }
            let score = pattern
                .score(item.text.slice(..), &mut self.matcher)
                .map(|score| {
                    let score = u64::from(score) * 10;
                    #[cfg(feature = "ranking-basename-experiment")]
                    let score = score
                        + u64::from(
                            pattern
                                .score(item.basename.slice(..), &mut self.matcher)
                                .unwrap_or(0),
                        );
                    score
                });
            #[cfg(feature = "typo-single-pass-experiment")]
            let score = if typo_enabled && (query_letters & !item.letters).count_ones() <= 1 {
                #[cfg(not(feature = "typo-signature-cache-experiment"))]
                let name = item
                    .path
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("");
                #[cfg(not(feature = "typo-signature-cache-experiment"))]
                let approximate = approximate_name_match(query.as_bytes(), name.as_bytes());
                #[cfg(feature = "typo-signature-cache-experiment")]
                let approximate = *signature_cache[item.signature].get_or_insert_with(|| {
                    approximate_name_match(query.as_bytes(), &self.signatures[item.signature])
                });
                if approximate {
                    Some(score.unwrap_or(0).max(10_000))
                } else {
                    score
                }
            } else {
                score
            };
            if let Some(score) = score {
                self.scored.push((index, score));
            }
        }
        #[cfg(all(
            feature = "typo-experiment",
            not(feature = "typo-single-pass-experiment")
        ))]
        if (cfg!(feature = "typo-always-experiment") || self.scored.len() < limit)
            && (6..=64).contains(&query.len())
            && query.bytes().all(|byte| byte.is_ascii_alphabetic())
        {
            #[cfg(feature = "typo-mask-experiment")]
            let query_letters = letter_mask(query.as_bytes());
            let mut matched = vec![None; self.items.len()];
            for (position, (index, _)) in self.scored.iter().enumerate() {
                matched[*index] = Some(position);
            }
            for (index, item) in self.items.iter().enumerate() {
                if (kind == 1 && item.directory) || (kind == 2 && !item.directory) {
                    continue;
                }
                if matched[index].is_some() && !cfg!(feature = "typo-always-experiment") {
                    continue;
                }
                #[cfg(feature = "typo-mask-experiment")]
                if (query_letters & !item.letters).count_ones() > 1 {
                    continue;
                }
                let name = item
                    .path
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("");
                if approximate_name_match(query.as_bytes(), name.as_bytes()) {
                    if let Some(position) = matched[index] {
                        self.scored[position].1 = self.scored[position].1.max(10_000);
                    } else {
                        self.scored.push((
                            index,
                            if cfg!(feature = "typo-always-experiment") {
                                10_000
                            } else {
                                1
                            },
                        ));
                    }
                }
            }
        }
        let items = &self.items;
        let compare = |a: &(usize, u64), b: &(usize, u64)| {
            b.1.cmp(&a.1)
                .then_with(|| items[a.0].path.len().cmp(&items[b.0].path.len()))
                .then_with(|| items[a.0].path.cmp(&items[b.0].path))
        };
        if limit < self.scored.len() {
            self.scored.select_nth_unstable_by(limit, compare);
            self.scored.truncate(limit);
        }
        self.scored.sort_unstable_by(compare);
        self.scored
            .iter()
            .map(|(index, _)| {
                let item = &self.items[*index];
                Entry {
                    path: &item.path,
                    kind: if item.directory { "directory" } else { "file" },
                }
            })
            .collect()
    }

    #[cfg(feature = "neo-frizbee-experiment")]
    fn neo_search(&self, query: &str, kind: u32, limit: usize) -> Vec<Entry<'_>> {
        use neo_frizbee::{Config, Scoring};
        use std::collections::HashMap;
        let parts: Vec<_> = query.split_whitespace().collect();
        if parts.is_empty() {
            return Vec::new();
        }
        let uppercase = parts
            .iter()
            .any(|part| part.chars().any(char::is_uppercase));
        let max_typos = ((parts[0].len() / 4) as u16).clamp(2, 6);
        let paths: Vec<_> = self.items.iter().map(|item| item.path.as_str()).collect();
        let mut accumulated: Vec<(usize, u32, u16)> = Vec::new();
        for (part_index, part) in parts.iter().enumerate() {
            let options = Config {
                max_typos: Some(if part_index == 0 {
                    max_typos
                } else {
                    max_typos.min(part.len() as u16)
                }),
                sort: false,
                scoring: Scoring {
                    capitalization_bonus: if uppercase { 8 } else { 0 },
                    matching_case_bonus: if uppercase { 4 } else { 0 },
                    ..Default::default()
                },
                ..Default::default()
            };
            #[cfg(not(any(feature = "neo-parallel-experiment", feature = "neo-pool-experiment")))]
            let matches = neo_frizbee::match_list(part, &paths, &options);
            #[cfg(all(
                feature = "neo-parallel-experiment",
                not(feature = "neo-pool-experiment")
            ))]
            let matches = neo_frizbee::match_list_parallel(part, &paths, &options, 2);
            #[cfg(feature = "neo-pool-experiment")]
            let matches = {
                use rayon::prelude::*;
                self.neo_pool.install(|| {
                    paths
                        .par_chunks(2048)
                        .enumerate()
                        .flat_map_iter(|(chunk, paths)| {
                            neo_frizbee::match_list(part, paths, &options)
                                .into_iter()
                                .map(move |mut item| {
                                    item.index += (chunk * 2048) as u32;
                                    item
                                })
                        })
                        .collect::<Vec<_>>()
                })
            };
            if part_index == 0 {
                accumulated.extend(
                    matches
                        .into_iter()
                        .map(|item| (item.index as usize, u32::from(item.score), item.end_col)),
                );
            } else {
                let next: HashMap<_, _> = matches
                    .into_iter()
                    .map(|item| (item.index as usize, u32::from(item.score)))
                    .collect();
                accumulated.retain_mut(|(index, score, _)| match next.get(index) {
                    Some(value) => {
                        *score += value;
                        true
                    }
                    None => false,
                });
            }
        }
        let mut ranked: Vec<_> = accumulated
            .into_iter()
            .filter_map(|(index, score, end_col)| {
                let item = &self.items[index];
                if (kind == 1 && item.directory) || (kind == 2 && !item.directory) {
                    return None;
                }
                let base = score / parts.len() as u32;
                let filename = item
                    .path
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("");
                let filename_offset = item
                    .path
                    .len()
                    .saturating_sub(filename.len() + usize::from(item.directory));
                let match_start =
                    usize::from(end_col).saturating_sub(parts[0].len().saturating_sub(1));
                let bonus = if !query.contains('/') && match_start >= filename_offset {
                    (base / 6).min(30)
                } else {
                    0
                };
                let score = if !query.contains('/') && query.eq_ignore_ascii_case(filename) {
                    u32::MAX
                } else {
                    base + bonus
                };
                Some((item, score))
            })
            .collect();
        let compare = |(a, left): &(&Item, u32), (b, right): &(&Item, u32)| {
            right
                .cmp(left)
                .then_with(|| a.path.len().cmp(&b.path.len()))
                .then_with(|| a.path.cmp(&b.path))
        };
        if limit < ranked.len() {
            ranked.select_nth_unstable_by(limit, compare);
            ranked.truncate(limit);
        }
        ranked.sort_unstable_by(compare);
        ranked
            .into_iter()
            .take(limit)
            .map(|(item, _)| Entry {
                path: &item.path,
                kind: if item.directory { "directory" } else { "file" },
            })
            .collect()
    }

    pub fn search_owned(&mut self, query: &str, kind: u32, limit: usize) -> Vec<OwnedEntry> {
        self.search(query, kind, limit)
            .into_iter()
            .map(|entry| OwnedEntry {
                path: entry.path.to_owned(),
                directory: entry.kind == "directory",
            })
            .collect()
    }
}

#[cfg(feature = "typo-signature-cache-experiment")]
fn name_signature(name: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(name.len());
    let mut nonletters = 0;
    for byte in name {
        let lower = byte.to_ascii_lowercase();
        if lower.is_ascii_lowercase() {
            result.push(lower);
            nonletters = 0;
        } else {
            nonletters += 1;
            if nonletters <= 2 {
                result.push(b'#');
            }
        }
    }
    result
}

#[cfg(feature = "typo-mask-experiment")]
fn letter_mask(text: &[u8]) -> u32 {
    text.iter().fold(0, |mask, byte| {
        let lower = byte.to_ascii_lowercase();
        if lower.is_ascii_lowercase() {
            mask | (1 << (lower - b'a'))
        } else {
            mask
        }
    })
}

#[cfg(feature = "typo-experiment")]
fn approximate_name_match(query: &[u8], name: &[u8]) -> bool {
    fn one_edit(query: &[u8], candidate: &[u8]) -> bool {
        let equal = |a: u8, b: u8| a.eq_ignore_ascii_case(&b);
        let first = query
            .iter()
            .zip(candidate)
            .position(|(a, b)| !equal(*a, *b));
        let Some(at) = first else {
            return query.len().abs_diff(candidate.len()) <= 1;
        };
        if query.len() == candidate.len() {
            if query[at + 1..]
                .iter()
                .zip(&candidate[at + 1..])
                .all(|(a, b)| equal(*a, *b))
            {
                return true;
            }
            return at + 1 < query.len()
                && equal(query[at], candidate[at + 1])
                && equal(query[at + 1], candidate[at])
                && query[at + 2..]
                    .iter()
                    .zip(&candidate[at + 2..])
                    .all(|(a, b)| equal(*a, *b));
        }
        if query.len() == candidate.len() + 1 {
            return query[at + 1..]
                .iter()
                .zip(&candidate[at..])
                .all(|(a, b)| equal(*a, *b));
        }
        if candidate.len() == query.len() + 1 {
            return query[at..]
                .iter()
                .zip(&candidate[at + 1..])
                .all(|(a, b)| equal(*a, *b));
        }
        false
    }
    let min = query.len().saturating_sub(1);
    let max = query.len() + 1;
    (min..=max).any(|length| {
        length <= name.len() && name.windows(length).any(|part| one_edit(query, part))
    })
}

pub struct OwnedEntry {
    pub path: String,
    pub directory: bool,
}

pub struct Handle {
    index: Option<Index>,
    receiver: Option<Receiver<Option<Index>>>,
    failed: bool,
}

impl Handle {
    fn ready(index: Index) -> Self {
        Self {
            index: Some(index),
            receiver: None,
            failed: false,
        }
    }

    fn building(receiver: Receiver<Option<Index>>) -> Self {
        Self {
            index: None,
            receiver: Some(receiver),
            failed: false,
        }
    }

    fn poll(&mut self, wait: bool) -> i32 {
        if self.index.is_some() {
            return 1;
        }
        if self.failed {
            return -1;
        }
        let Some(receiver) = self.receiver.take() else {
            self.failed = true;
            return -1;
        };
        let received = if wait {
            receiver.recv().map_err(|_| TryRecvError::Disconnected)
        } else {
            receiver.try_recv()
        };
        match received {
            Ok(Some(index)) => {
                self.index = Some(index);
                1
            }
            Ok(None) | Err(TryRecvError::Disconnected) => {
                self.failed = true;
                -1
            }
            Err(TryRecvError::Empty) => {
                self.receiver = Some(receiver);
                0
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn redcode_search_abi_version() -> u32 {
    ABI_VERSION
}

/// Caller supplies a valid UTF-8 JSON byte slice for the duration of this call.
/// The returned handle must be freed exactly once with redcode_search_drop.
///
/// # Safety
///
/// `bytes` must point to `len` readable bytes for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn redcode_search_new(bytes: *const u8, len: usize) -> *mut Handle {
    if bytes.is_null() {
        return std::ptr::null_mut();
    }
    catch_unwind(|| {
        let files =
            serde_json::from_slice::<Vec<String>>(std::slice::from_raw_parts(bytes, len)).ok()?;
        Some(Box::into_raw(Box::new(Handle::ready(Index::new(files)))))
    })
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}

/// Copies the input and builds the index on a Rust thread. Poll with
/// redcode_search_ready before publishing the handle to searches.
///
/// # Safety
///
/// `bytes` must point to `len` readable bytes for the duration of this call. The
/// returned handle must be freed exactly once with `redcode_search_drop`.
#[no_mangle]
pub unsafe extern "C" fn redcode_search_new_async(bytes: *const u8, len: usize) -> *mut Handle {
    if bytes.is_null() {
        return std::ptr::null_mut();
    }
    let input = std::slice::from_raw_parts(bytes, len).to_vec();
    let (sender, receiver) = mpsc::sync_channel(1);
    if std::thread::Builder::new()
        .name("redcode-path-index".into())
        .spawn(move || {
            let index = catch_unwind(|| {
                serde_json::from_slice::<Vec<String>>(&input)
                    .ok()
                    .map(Index::new)
            })
            .ok()
            .flatten();
            let _ = sender.send(index);
        })
        .is_err()
    {
        return std::ptr::null_mut();
    }
    Box::into_raw(Box::new(Handle::building(receiver)))
}

/// Returns 1 when ready, 0 while building and -1 after a build failure.
///
/// # Safety
///
/// `index` must be a live handle returned by this library. Calls that borrow or
/// free the same handle must not overlap.
#[no_mangle]
pub unsafe extern "C" fn redcode_search_ready(index: *mut Handle) -> i32 {
    if index.is_null() {
        return -1;
    }
    (*index).poll(false)
}

/// Caller supplies a live exclusively borrowed handle and a valid UTF-8 byte slice.
/// Returned JSON is owned by this library and freed with redcode_search_free_string.
///
/// # Safety
///
/// `index` must be a live, exclusively borrowed handle returned by this library,
/// and `bytes` must point to `len` readable bytes for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn redcode_search_find(
    index: *mut Handle,
    bytes: *const u8,
    len: usize,
    kind: u32,
    limit: usize,
) -> *mut c_char {
    if index.is_null() || bytes.is_null() {
        return std::ptr::null_mut();
    }
    catch_unwind(AssertUnwindSafe(|| {
        let query = std::str::from_utf8(std::slice::from_raw_parts(bytes, len)).ok()?;
        if (*index).poll(true) != 1 {
            return None;
        }
        let json = serde_json::to_vec(&(*index).index.as_mut()?.search(query, kind, limit)).ok()?;
        Some(CString::new(json).ok()?.into_raw())
    }))
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}

/// Releases a handle created by either constructor.
///
/// # Safety
///
/// `index` must be null or a live handle returned by this library. A non-null
/// handle must be passed exactly once and have no overlapping calls.
#[no_mangle]
pub unsafe extern "C" fn redcode_search_drop(index: *mut Handle) {
    if !index.is_null() {
        drop(Box::from_raw(index));
    }
}

/// Releases a result returned by `redcode_search_find`.
///
/// # Safety
///
/// `text` must be null or a live string returned by `redcode_search_find`. A
/// non-null pointer must be passed exactly once.
#[no_mangle]
pub unsafe extern "C" fn redcode_search_free_string(text: *mut c_char) {
    if !text.is_null() {
        drop(CString::from_raw(text));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        redcode_search_abi_version, redcode_search_drop, redcode_search_find,
        redcode_search_free_string, redcode_search_new, redcode_search_new_async,
        redcode_search_ready, Index, ABI_VERSION,
    };
    use serde::Deserialize;
    use std::time::{Duration, Instant};

    #[derive(Deserialize)]
    struct Contract {
        files: Vec<String>,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        id: String,
        query: String,
        #[serde(rename = "type")]
        kind: String,
        limit: usize,
        exact_count: Option<usize>,
        first: Option<String>,
        #[serde(default)]
        required: Vec<String>,
    }

    #[test]
    fn satisfies_shared_filename_search_contract() {
        let contract: Contract = serde_json::from_str(include_str!(
            "../../../test/fixture/filesystem-search-contract.json"
        ))
        .unwrap();
        let mut index = Index::new(contract.files);
        for case in contract.cases {
            let kind = match case.kind.as_str() {
                "mixed" => 0,
                "file" => 1,
                "directory" => 2,
                other => panic!("unknown type {other}"),
            };
            let results = index.search(&case.query, kind, case.limit);
            let paths: Vec<&str> = results.iter().map(|entry| entry.path).collect();
            assert!(paths.len() <= case.limit, "{} exceeded limit", case.id);
            assert_eq!(
                paths
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len(),
                paths.len(),
                "{} returned duplicates",
                case.id
            );
            assert!(
                results.iter().all(|entry| match kind {
                    1 => entry.kind == "file",
                    2 => entry.kind == "directory",
                    _ => true,
                }),
                "{} returned the wrong type",
                case.id
            );
            if let Some(count) = case.exact_count {
                assert_eq!(paths.len(), count, "{} returned the wrong count", case.id);
            }
            if let Some(first) = case.first {
                assert_eq!(
                    paths.first().copied(),
                    Some(first.as_str()),
                    "{} first",
                    case.id
                );
            }
            for required in case.required {
                assert!(
                    paths.contains(&required.as_str()),
                    "{} missed {required}",
                    case.id
                );
            }
        }
    }

    #[test]
    fn exposes_the_packaging_abi_version() {
        assert_eq!(redcode_search_abi_version(), ABI_VERSION);
        assert_eq!(ABI_VERSION, 1);
    }

    #[cfg(feature = "neo-frizbee-experiment")]
    #[test]
    fn exact_basename_outranks_approximate_matches() {
        let mut files: Vec<String> = (0..100)
            .map(|index| format!("src/filesystem/file-{index}.ts"))
            .collect();
        files.push("deep/nested/filesystem.ts".into());
        let mut index = Index::new(files);
        let results = index.search("filesystem.ts", 1, 10);
        assert_eq!(
            results.first().map(|item| item.path),
            Some("deep/nested/filesystem.ts")
        );
    }

    #[cfg(feature = "typo-experiment")]
    #[test]
    fn typo_search_recovers_single_edits_without_duplicates() {
        let mut index = Index::new(vec!["src/renderer.ts".into(), "src/unrelated.ts".into()]);
        for query in ["rendzerer", "rendzrer", "rendrerer", "rendeer"] {
            let results = index.search(query, 1, 50);
            let paths: Vec<_> = results.iter().map(|entry| entry.path).collect();
            assert_eq!(
                paths
                    .iter()
                    .filter(|path| **path == "src/renderer.ts")
                    .count(),
                1,
                "{query}"
            );
        }
    }

    #[cfg(feature = "typo-mask-experiment")]
    #[test]
    fn letter_filter_keeps_all_single_edit_matches() {
        use super::{approximate_name_match, letter_mask};
        for name in [
            "Renderer.ts",
            "session-component.tsx",
            "aabccd.txt",
            "ação-renderer.rs",
            "session-component-000123.tsx",
            "alphabet...123--editor77.ts",
        ] {
            let bytes = name.as_bytes();
            for start in 0..bytes.len() {
                for end in start + 1..=bytes.len() {
                    let part = &bytes[start..end];
                    if !part.iter().all(u8::is_ascii_alphabetic) {
                        continue;
                    }
                    let mut variants = vec![part.to_vec()];
                    for at in 0..part.len() {
                        let mut substituted = part.to_vec();
                        substituted[at] = b'z';
                        variants.push(substituted);
                        let mut deleted = part.to_vec();
                        deleted.remove(at);
                        variants.push(deleted);
                        let mut inserted = part.to_vec();
                        inserted.insert(at, b'q');
                        variants.push(inserted);
                        if at + 1 < part.len() {
                            let mut transposed = part.to_vec();
                            transposed.swap(at, at + 1);
                            variants.push(transposed);
                        }
                    }
                    for query in variants {
                        if query.len() < 6 {
                            continue;
                        }
                        #[cfg(feature = "typo-signature-cache-experiment")]
                        assert_eq!(
                            approximate_name_match(&query, bytes),
                            approximate_name_match(&query, &super::name_signature(bytes))
                        );
                        if approximate_name_match(&query, bytes) {
                            assert!((letter_mask(&query) & !letter_mask(bytes)).count_ones() <= 1);
                        }
                    }
                }
            }
        }
    }

    #[cfg(feature = "typo-path-filter-experiment")]
    #[test]
    fn path_filter_keeps_directory_and_normalized_unicode_matches() {
        let mut index = Index::new(vec![
            "src/provider/index.ts".into(),
            "src/educação/index.ts".into(),
        ]);
        for (query, expected) in [
            ("provider", "src/provider/index.ts"),
            ("educacao", "src/educação/index.ts"),
        ] {
            let paths: Vec<_> = index
                .search(query, 1, 50)
                .iter()
                .map(|item| item.path.to_owned())
                .collect();
            assert!(paths.iter().any(|path| path == expected), "{query}");
        }
    }

    #[cfg(feature = "typo-score-shortcut-experiment")]
    #[test]
    fn shortcut_score_bound_covers_short_ascii_queries() {
        use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
        use nucleo_matcher::{Config, Matcher, Utf32String};
        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        for name in [
            "abcdefghijklmnopqrstuvwxyzabcdef",
            "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF",
            "ab-cd_ef/ghij/klmnop/qrstuv/wxyzabcdef",
            "ábcdefghijklmnopqrstuvwxyzabcdef",
        ] {
            let text = Utf32String::from(name);
            for length in 6..=32 {
                let query = &"abcdefghijklmnopqrstuvwxyzabcdef"[..length];
                let pattern = Pattern::new(
                    query,
                    CaseMatching::Ignore,
                    Normalization::Smart,
                    AtomKind::Fuzzy,
                );
                if let Some(score) = pattern.score(text.slice(..), &mut matcher) {
                    assert!(u64::from(score) * 11 < 10_000, "{query} {name} {score}");
                }
            }
        }
    }

    #[test]
    fn unicode_paths_and_directory_filter_survive_ffi() {
        let input = serde_json::to_vec(&vec![
            "src/日本語/検索.ts",
            "src/espaço/ação.ts",
            "src/emoji/rocket-🚀.ts",
        ])
        .unwrap();
        unsafe {
            let index = redcode_search_new(input.as_ptr(), input.len());
            assert!(!index.is_null());
            for (query, kind, expected) in [
                ("検索", 1, "src/日本語/検索.ts"),
                ("ação", 1, "src/espaço/ação.ts"),
                ("rocket-🚀", 1, "src/emoji/rocket-🚀.ts"),
                ("日本語", 2, "src/日本語/"),
            ] {
                let result = redcode_search_find(index, query.as_ptr(), query.len(), kind, 1);
                assert!(!result.is_null());
                let decoded: Vec<serde_json::Value> =
                    serde_json::from_slice(std::ffi::CStr::from_ptr(result).to_bytes()).unwrap();
                assert_eq!(decoded[0]["path"], expected);
                assert_eq!(decoded.len(), 1);
                redcode_search_free_string(result);
            }
            redcode_search_drop(index);
        }
    }

    #[test]
    fn rejects_bad_input_and_preserves_empty_query_behavior() {
        unsafe {
            assert!(redcode_search_new(b"oops".as_ptr(), 4).is_null());
        }
        let mut index = Index::new(vec!["src/file.ts".into()]);
        assert!(index.search("", 0, 50).is_empty());
        assert!(index.search("file", 1, 0).is_empty());
        assert!(index.search("file", 2, 50).is_empty());
        assert!(index.search("zzzz", 0, 50).is_empty());
    }

    #[test]
    fn async_handle_publishes_success_and_reports_failure() {
        let input = serde_json::to_vec(&vec![
            "src/session/search.ts",
            "src/filesystem/index.ts",
            "src/日本語/検索.ts",
        ])
        .unwrap();
        unsafe {
            let index = redcode_search_new_async(input.as_ptr(), input.len());
            assert!(!index.is_null());
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match redcode_search_ready(index) {
                    1 => break,
                    0 if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(1)),
                    status => panic!("async index did not become ready: {status}"),
                }
            }
            let query = "session";
            let result = redcode_search_find(index, query.as_ptr(), query.len(), 1, 50);
            assert!(!result.is_null());
            let decoded: Vec<serde_json::Value> =
                serde_json::from_slice(std::ffi::CStr::from_ptr(result).to_bytes()).unwrap();
            assert_eq!(decoded[0]["path"], "src/session/search.ts");
            redcode_search_free_string(result);
            redcode_search_drop(index);

            let invalid = redcode_search_new_async(b"oops".as_ptr(), 4);
            assert!(!invalid.is_null());
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match redcode_search_ready(invalid) {
                    -1 => break,
                    0 if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(1)),
                    status => panic!("invalid async index returned unexpected status: {status}"),
                }
            }
            redcode_search_drop(invalid);
        }
    }
}
