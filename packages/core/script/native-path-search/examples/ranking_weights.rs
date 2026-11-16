//! Offline ranking experiment. Never used by the production index.
use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32String};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::process::Command;

#[derive(Deserialize)]
struct Report {
    corpus: Corpus,
    intents: Corpus,
    #[serde(rename = "commonPaths")]
    common_paths: Vec<Answer>,
}
#[derive(Deserialize)]
struct Corpus {
    sha256: String,
}
#[derive(Deserialize)]
struct Answer {
    query: String,
    legacy: Vec<String>,
}

fn overlap(reference: &[String], candidate: &[&str], limit: usize) -> f64 {
    let left: HashSet<&str> = reference.iter().take(limit).map(String::as_str).collect();
    let right: HashSet<&str> = candidate.iter().take(limit).copied().collect();
    let denominator = left.len().min(right.len());
    if denominator == 0 {
        return if left.len() == right.len() { 1.0 } else { 0.0 };
    }
    left.intersection(&right).count() as f64 / denominator as f64
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[(values.len() - 1) / 2]
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        return Err("usage: ranking_weights REPO FFF_REPORT RIPGREP_REPORT".into());
    }
    let fff: Report = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let ripgrep: Report = serde_json::from_slice(&std::fs::read(&args[3])?)?;
    if fff.corpus.sha256 != ripgrep.corpus.sha256 || fff.intents.sha256 != ripgrep.intents.sha256 {
        return Err("reports have different corpora or intents".into());
    }
    if fff.common_paths.len() != ripgrep.common_paths.len() || fff.common_paths.is_empty() {
        return Err("missing common-query paths".into());
    }
    let listing = Command::new("rg")
        .args(["--files"])
        .current_dir(&args[1])
        .output()?;
    if !listing.status.success() {
        return Err("ripgrep listing failed".into());
    }
    let files: Vec<_> = String::from_utf8(listing.stdout)?
        .lines()
        .map(|line| {
            let path = line.replace('\\', "/");
            let basename = Utf32String::from(path.rsplit('/').next().unwrap_or(""));
            let full = Utf32String::from(path.as_str());
            (path, full, basename)
        })
        .collect();
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let mut experiments = Vec::new();
    for weight in [0_u32, 10, 25, 50, 100, 200] {
        let mut fff10 = Vec::new();
        let mut fff50 = Vec::new();
        let mut rg10 = Vec::new();
        let mut rg50 = Vec::new();
        for (f, r) in fff.common_paths.iter().zip(&ripgrep.common_paths) {
            if f.query != r.query {
                return Err("common queries differ".into());
            }
            let pattern = Pattern::new(
                &f.query,
                CaseMatching::Ignore,
                Normalization::Smart,
                AtomKind::Fuzzy,
            );
            let mut matches: Vec<_> = files
                .iter()
                .filter_map(|(path, full, basename)| {
                    let score = pattern.score(full.slice(..), &mut matcher)?;
                    let name_score = pattern.score(basename.slice(..), &mut matcher).unwrap_or(0);
                    Some((
                        path.as_str(),
                        score as u64 * 100 + name_score as u64 * weight as u64,
                    ))
                })
                .collect();
            matches.sort_unstable_by(|a, b| {
                b.1.cmp(&a.1)
                    .then_with(|| a.0.len().cmp(&b.0.len()))
                    .then_with(|| a.0.cmp(b.0))
            });
            let ranked: Vec<_> = matches.iter().take(50).map(|m| m.0).collect();
            fff10.push(overlap(&f.legacy, &ranked, 10));
            fff50.push(overlap(&f.legacy, &ranked, 50));
            rg10.push(overlap(&r.legacy, &ranked, 10));
            rg50.push(overlap(&r.legacy, &ranked, 50));
        }
        experiments.push(json!({"basenameWeightPercent": weight, "fffTop10": median(&mut fff10), "fffTop50": median(&mut fff50), "ripgrepTop10": median(&mut rg10), "ripgrepTop50": median(&mut rg50)}));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"corpusSha256": fff.corpus.sha256, "intentsSha256": fff.intents.sha256, "listedFiles": files.len(), "experiments": experiments})
        )?
    );
    Ok(())
}
