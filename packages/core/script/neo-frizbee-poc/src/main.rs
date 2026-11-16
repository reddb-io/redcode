//! Offline candidate-coverage probe, not wired into the RedCode runtime.
use neo_frizbee::{match_list, Config, Scoring};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::process::Command;
use std::time::Instant;

#[derive(Deserialize)]
struct Report {
    baseline: String,
    corpus: Corpus,
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
    rust: Vec<String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 {
        return Err("usage: redcode-neo-frizbee-probe REPO FFF_REPORT OUTPUT".into());
    }
    let input = std::fs::read(&args[2])?;
    let report: Report = serde_json::from_slice(&input)?;
    if report.baseline != "fff" || report.common_paths.is_empty() {
        return Err("FFF diagnostic report with common paths required".into());
    }
    let listing = Command::new("rg")
        .arg("--files")
        .current_dir(&args[1])
        .output()?;
    if !listing.status.success() {
        return Err("ripgrep listing failed".into());
    }
    let stdout = String::from_utf8(listing.stdout)?;
    let mut files: Vec<String> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.replace('\\', "/"))
        .collect();
    files.sort_unstable_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let hash = format!("{:x}", Sha256::digest(files.join("\n").as_bytes()));
    if hash != report.corpus.sha256 {
        return Err("corpus hash differs from report".into());
    }
    let inventory: HashSet<&str> = files.iter().map(String::as_str).collect();
    let queries: Vec<_> = report
        .common_paths
        .iter()
        .map(|answer| {
            let started = Instant::now();
            let config = Config {
                max_typos: Some(((answer.query.len() / 4) as u16).clamp(2, 6)),
                sort: false,
                scoring: Scoring {
                    capitalization_bonus: 0,
                    matching_case_bonus: 0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let matches = match_list(&answer.query, &files, &config);
            let candidates: HashSet<&str> = matches
                .iter()
                .map(|item| files[item.index as usize].as_str())
                .collect();
            let comparable: Vec<&str> = answer
                .legacy
                .iter()
                .map(String::as_str)
                .filter(|path| inventory.contains(path))
                .collect();
            let observed = comparable
                .iter()
                .filter(|path| candidates.contains(**path))
                .count();
            json!({
                "query": answer.query,
                "maxTypos": config.max_typos,
                "fffTop50InInventory": comparable.len(),
                "neoCandidateCount": candidates.len(),
                "fffTop50InNeoCandidates": observed,
                "priorRustTop50Count": answer.rust.len(),
                "elapsedMs": started.elapsed().as_secs_f64() * 1000.0,
            })
        })
        .collect();
    let result = json!({
        "corpusSha256": hash,
        "reportSha256": format!("{:x}", Sha256::digest(&input)),
        "fileCount": files.len(),
        "dependency": "neo_frizbee 0.11.0",
        "note": "Candidate coverage only; FFF ranking, lifecycle, CPU and production contract are not implemented.",
        "queries": queries,
    });
    std::fs::write(&args[3], serde_json::to_vec_pretty(&result)?)?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
