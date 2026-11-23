//! Daily Snapshot (Rust variant)
//!
//! git clone/fetch + tokei. Con --cache-dir: cache incremental, skip repos sin cambios (~20-30s).
//!
//! Usage:
//!   cargo run --release  # clone efímero (~52s)
//!   cargo run --release -- --cache-dir ~/.cache/github-snapshot  # cache incremental (~20-30s)
//!   cargo run --release -- --profile  # desglose de tiempo por capa (ls_remote, clone, fetch, tokei, du, db)
//!
//! Config: back/config/snapshot.json (DATABASE_URL, GITHUB_TOKEN)

use anyhow::{Context, Result};
use postgres::Client;
use postgres_native_tls::MakeTlsConnector;
use rayon::prelude::*;
use serde::Deserialize;
use std::fs;
use std::io::{stderr, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use walkdir::WalkDir;

/// Tiempos acumulados por capa (ms) para --profile
struct PhaseTiming {
    ls_remote_ms: AtomicU64,
    clone_ms: AtomicU64,
    fetch_ms: AtomicU64,
    tokei_ms: AtomicU64,
    du_ms: AtomicU64,
    db_insert_ms: AtomicU64,
    ls_remote_count: AtomicU64,
    clone_count: AtomicU64,
    fetch_count: AtomicU64,
    tokei_count: AtomicU64,
}
impl Default for PhaseTiming {
    fn default() -> Self {
        Self {
            ls_remote_ms: AtomicU64::new(0),
            clone_ms: AtomicU64::new(0),
            fetch_ms: AtomicU64::new(0),
            tokei_ms: AtomicU64::new(0),
            du_ms: AtomicU64::new(0),
            db_insert_ms: AtomicU64::new(0),
            ls_remote_count: AtomicU64::new(0),
            clone_count: AtomicU64::new(0),
            fetch_count: AtomicU64::new(0),
            tokei_count: AtomicU64::new(0),
        }
    }
}
use tokei::{Config, Languages};

const EXCLUDED: &[&str] = &[
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".git",
    ".github",
    "coverage",
    "__pycache__",
    ".next",
    ".cache",
    "public/assets",
];

#[derive(Deserialize)]
struct ConfigFile {
    DATABASE_URL: String,
    GITHUB_TOKEN: String,
}

#[derive(Debug)]
struct Repo {
    id: i32,
    full_name: String,
    stars: Option<i32>,
    forks: Option<i32>,
    watchers: Option<i32>,
    subscribers_count: Option<i32>,
    open_issues: Option<i32>,
    has_ci: Option<bool>,
    has_tests: Option<bool>,
    has_readme: Option<bool>,
    readme_lines: Option<i32>,
    has_gitignore: Option<bool>,
    has_roadmap: Option<bool>,
    docs_file_count: Option<i32>,
    docs_quality: Option<String>,
    language: Option<String>,
    is_private: Option<bool>,
    is_archived: Option<bool>,
    is_fork: Option<bool>,
    is_template: Option<bool>,
    default_branch: Option<String>,
    repo_size_kb: Option<i32>,
    file_count: Option<i32>,
    loc: Option<i32>,
}

#[derive(Debug, Clone)]
struct Analysis {
    loc: i64,
    file_count: i64,
    repo_size_kb: i64,
}

fn main() -> Result<()> {
    let start = Instant::now();
    let args: Vec<String> = std::env::args().collect();
    let limit = args
        .windows(2)
        .find(|w| w[0] == "--limit")
        .and_then(|w| w[1].parse::<usize>().ok())
        .unwrap_or(0);
    let cache_dir = args
        .windows(2)
        .find(|w| w[0] == "--cache-dir")
        .map(|w| PathBuf::from(&w[1]));
    let profile = args.iter().any(|a| a == "--profile");

    let cfg = load_config()?;
    let mut client = connect_db(&cfg.DATABASE_URL)?;

    let last_metrics = fetch_last_metrics(&mut client)?;
    let last_metrics = Arc::new(last_metrics);

    let repos = fetch_repos(&mut client)?;
    let repos: Vec<Repo> = if limit > 0 && limit < repos.len() {
        println!("Found {} repos (--limit {})", limit, limit);
        repos.into_iter().take(limit).collect()
    } else {
        println!("Found {} repositories", repos.len());
        repos
    };

    let mode = if cache_dir.is_some() { "cache incremental" } else { "clone efímero" };
    println!(
        "[{}] Daily snapshot (Rust) - {} | {} workers",
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ"),
        mode,
        rayon::current_num_threads()
    );

    let db = Arc::new(Mutex::new(client));
    let success = AtomicU64::new(0);
    let errors = AtomicU64::new(0);
    let done = AtomicU64::new(0);
    let skipped = AtomicU64::new(0);
    let phase_timing = if profile { Some(Arc::new(PhaseTiming::default())) } else { None };
    let phase_timing_ref = phase_timing.as_ref().map(Arc::clone);

    repos
        .par_iter()
        .enumerate()
        .for_each(|(i, repo)| {
            let result = process_repo(
                repo,
                &cfg.GITHUB_TOKEN,
                cache_dir.as_deref(),
                &last_metrics,
                phase_timing_ref.as_deref(),
            );
            let mut db_guard = db.lock().unwrap();
            let db_start = if profile { Some(Instant::now()) } else { None };

            match result {
                Ok(ProcessResult::Inserted(a)) => {
                    if insert_snapshot(&mut *db_guard, repo, &a).is_ok() {
                        success.fetch_add(1, Ordering::Relaxed);
                        println!(
                            "[{}/{}] {} ✓ LOC: {}, Files: {}, Size: {} KB",
                            i + 1, repos.len(), repo.full_name, a.loc, a.file_count, a.repo_size_kb
                        );
                    } else {
                        errors.fetch_add(1, Ordering::Relaxed);
                    }
                }
                Ok(ProcessResult::Reused(a)) => {
                    if insert_snapshot(&mut *db_guard, repo, &a).is_ok() {
                        skipped.fetch_add(1, Ordering::Relaxed);
                        println!(
                            "[{}/{}] {} ◎ cached LOC: {}, Files: {}, Size: {} KB",
                            i + 1, repos.len(), repo.full_name, a.loc, a.file_count, a.repo_size_kb
                        );
                    } else {
                        errors.fetch_add(1, Ordering::Relaxed);
                    }
                }
                Err(e) => {
                    errors.fetch_add(1, Ordering::Relaxed);
                    let _ = writeln!(stderr(), "[{}/{}] {} ✗ {}", i + 1, repos.len(), repo.full_name, e);
                }
            }

            if let (Some(pt), Some(t)) = (phase_timing_ref.as_deref(), db_start) {
                pt.db_insert_ms.fetch_add(t.elapsed().as_millis() as u64, Ordering::Relaxed);
            }
            drop(db_guard);
            let c = done.fetch_add(1, Ordering::Relaxed) + 1;
            if c % 10 == 0 {
                let elapsed = start.elapsed().as_secs_f64();
                let eta = ((elapsed / c as f64) * (repos.len() as f64 - c as f64)) as u64;
                println!(
                    "  📊 {} ok, {} cached, {} errors | ETA: ~{}s",
                    success.load(Ordering::Relaxed),
                    skipped.load(Ordering::Relaxed),
                    errors.load(Ordering::Relaxed),
                    eta
                );
            }
        });

    let duration = start.elapsed().as_secs_f64();
    println!("\n{}", "=".repeat(60));
    println!(
        "Done in {:.2}s | Analyzed: {} | Cached: {} | Errors: {}",
        duration,
        success.load(Ordering::Relaxed),
        skipped.load(Ordering::Relaxed),
        errors.load(Ordering::Relaxed)
    );
    if let Some(pt) = &phase_timing {
        let ls = pt.ls_remote_ms.load(Ordering::Relaxed) as f64 / 1000.0;
        let cl = pt.clone_ms.load(Ordering::Relaxed) as f64 / 1000.0;
        let fe = pt.fetch_ms.load(Ordering::Relaxed) as f64 / 1000.0;
        let tok = pt.tokei_ms.load(Ordering::Relaxed) as f64 / 1000.0;
        let du = pt.du_ms.load(Ordering::Relaxed) as f64 / 1000.0;
        let db = pt.db_insert_ms.load(Ordering::Relaxed) as f64 / 1000.0;
        println!("  --- Profiling (sum across all repos) ---");
        println!("  ls_remote: {:6.2}s ({} hits)", ls, pt.ls_remote_count.load(Ordering::Relaxed));
        println!("  clone:     {:6.2}s ({} repos)", cl, pt.clone_count.load(Ordering::Relaxed));
        println!("  fetch:     {:6.2}s ({} repos)", fe, pt.fetch_count.load(Ordering::Relaxed));
        println!("  tokei:     {:6.2}s ({} repos)", tok, pt.tokei_count.load(Ordering::Relaxed));
        println!("  du:        {:6.2}s", du);
        println!("  db_insert: {:6.2}s", db);
    }
    println!("{}", "=".repeat(60));

    Ok(())
}

enum ProcessResult {
    Inserted(Analysis),
    Reused(Analysis),
}

/// Obtiene el SHA del HEAD remoto sin hacer fetch (una sola petición HTTP).
fn ls_remote_head(url: &str, branch: &str) -> Option<String> {
    let ref_str = format!("refs/heads/{}", branch);
    let out = std::process::Command::new("git")
        .args(["ls-remote", "--quiet", url, &ref_str])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout);
    let line = line.lines().next()?;
    let sha = line.split_whitespace().next()?;
    Some(sha.trim().to_string())
}

fn process_repo(
    repo: &Repo,
    token: &str,
    cache_dir: Option<&Path>,
    last_metrics: &Arc<std::collections::HashMap<i32, Analysis>>,
    phase_timing: Option<&PhaseTiming>,
) -> Result<ProcessResult> {
    let parts: Vec<&str> = repo.full_name.splitn(2, '/').collect();
    let (owner, repo_name) = (parts[0], parts.get(1).ok_or_else(|| anyhow::anyhow!("Invalid full_name"))?);
    let clone_url = format!("https://{}@github.com/{}/{}.git", token, owner, repo_name);
    let branch = repo.default_branch.as_deref().unwrap_or("main");

    let work_dir: PathBuf = if let Some(cache) = cache_dir {
        cache.join(owner).join(repo_name)
    } else {
        std::env::temp_dir().join(format!("snapshot-{}-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(), repo_name))
    };

    let is_cache = cache_dir.is_some();

    // Optimización: si tenemos cache, usar ls-remote para ver si cambió el remote sin hacer fetch
    if is_cache && work_dir.exists() && work_dir.join(".git").exists() {
        let last_sha_path = work_dir.join(".last_sha");
        if let Ok(last) = fs::read_to_string(&last_sha_path) {
            let last = last.trim();
            if !last.is_empty() {
                let t0 = Instant::now();
                let remote_sha = ls_remote_head(&clone_url, branch);
                if let Some(pt) = phase_timing {
                    pt.ls_remote_ms.fetch_add(t0.elapsed().as_millis() as u64, Ordering::Relaxed);
                }
                if let Some(remote_sha) = remote_sha {
                    if remote_sha == last && last_metrics.get(&repo.id).is_some() {
                        if let Some(pt) = phase_timing {
                            pt.ls_remote_count.fetch_add(1, Ordering::Relaxed);
                        }
                        let a = last_metrics.get(&repo.id).unwrap().clone();
                        return Ok(ProcessResult::Reused(a));
                    }
                }
            }
        }
    }

    if !work_dir.exists() || !work_dir.join(".git").exists() {
        if let Some(parent) = work_dir.parent() {
            fs::create_dir_all(parent).context("create cache dir")?;
        }
        let t0 = Instant::now();
        let status = std::process::Command::new("git")
            .args(["clone", "--depth", "1", "--single-branch", "-b", branch, &clone_url, work_dir.to_str().unwrap()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .context("git clone failed")?;
        if let Some(pt) = phase_timing {
            pt.clone_ms.fetch_add(t0.elapsed().as_millis() as u64, Ordering::Relaxed);
            pt.clone_count.fetch_add(1, Ordering::Relaxed);
        }
        if !status.success() {
            anyhow::bail!("git clone failed");
        }
    } else {
        let t0 = Instant::now();
        let status = std::process::Command::new("git")
            .current_dir(&work_dir)
            .args(["fetch", "origin", branch, "--quiet"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .context("git fetch failed")?;
        if !status.success() {
            anyhow::bail!("git fetch failed");
        }
        let status = std::process::Command::new("git")
            .current_dir(&work_dir)
            .args(["reset", "--hard", &format!("origin/{}", branch)])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .context("git reset failed")?;
        if let Some(pt) = phase_timing {
            pt.fetch_ms.fetch_add(t0.elapsed().as_millis() as u64, Ordering::Relaxed);
            pt.fetch_count.fetch_add(1, Ordering::Relaxed);
        }
        if !status.success() {
            anyhow::bail!("git reset failed");
        }
    }

    let head_sha = std::process::Command::new("git")
        .current_dir(&work_dir)
        .args(["rev-parse", "HEAD"])
        .output()
        .context("git rev-parse failed")?;
    let head_sha = String::from_utf8_lossy(&head_sha.stdout).trim().to_string();
    if head_sha.is_empty() {
        anyhow::bail!("git rev-parse returned empty");
    }

    let last_sha_path = work_dir.join(".last_sha");
    if is_cache {
        if let Ok(last) = fs::read_to_string(&last_sha_path) {
            let last = last.trim();
            if last == head_sha {
                if let Some(a) = last_metrics.get(&repo.id) {
                    fs::write(&last_sha_path, &head_sha).ok();
                    return Ok(ProcessResult::Reused(a.clone()));
                }
            }
        }
    }

    if let Err(e) = write_file_manifest(&work_dir) {
        eprintln!("Warning: manifest write failed for {}: {}", repo.full_name, e);
    }

    let t0 = Instant::now();
    let (loc, file_count) = count_loc_tokei(&work_dir);
    if let Some(pt) = phase_timing {
        pt.tokei_ms.fetch_add(t0.elapsed().as_millis() as u64, Ordering::Relaxed);
        pt.tokei_count.fetch_add(1, Ordering::Relaxed);
    }
    let t1 = Instant::now();
    let repo_size_kb = get_dir_size_kb(&work_dir);
    if let Some(pt) = phase_timing {
        pt.du_ms.fetch_add(t1.elapsed().as_millis() as u64, Ordering::Relaxed);
    }
    let a = Analysis {
        loc: loc as i64,
        file_count: file_count as i64,
        repo_size_kb,
    };

    if is_cache {
        fs::write(&last_sha_path, &head_sha).ok();
    } else {
        let _ = std::fs::remove_dir_all(&work_dir);
    }

    Ok(ProcessResult::Inserted(a))
}


fn write_file_manifest(work_dir: &Path) -> Result<()> {
    let mut paths: Vec<String> = Vec::new();
    for entry in WalkDir::new(work_dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            name != ".git"
        })
    {
        if let Ok(entry) = entry {
            if entry.file_type().is_file() {
                if let Ok(rel) = entry.path().strip_prefix(work_dir) {
                    paths.push(rel.to_string_lossy().to_string());
                }
            }
        }
    }
    let manifest_path = work_dir.join(".file_manifest.json");
    let json = serde_json::to_string(&paths)?;
    fs::write(manifest_path, json)?;
    Ok(())
}

fn load_config() -> Result<ConfigFile> {
    let cfg_path = if Path::new("../../config/snapshot.json").exists() {
        "../../config/snapshot.json"
    } else if Path::new("config/snapshot.json").exists() {
        "config/snapshot.json"
    } else {
        "../config/snapshot.json"
    };
    let data = fs::read_to_string(cfg_path)
        .with_context(|| format!("Config not found: {}", cfg_path))?;
    let cfg: ConfigFile = serde_json::from_str(&data).context("Invalid config JSON")?;
    if cfg.DATABASE_URL.is_empty() || cfg.GITHUB_TOKEN.is_empty() {
        anyhow::bail!("config/snapshot.json needs DATABASE_URL and GITHUB_TOKEN");
    }
    Ok(cfg)
}

fn connect_db(database_url: &str) -> Result<Client> {
    let connector = native_tls::TlsConnector::new()?;
    let connector = MakeTlsConnector::new(connector);
    let client =
        Client::connect(database_url, connector).context("Failed to connect to database")?;
    Ok(client)
}

fn fetch_last_metrics(client: &mut Client) -> Result<std::collections::HashMap<i32, Analysis>> {
    let rows = client.query(
        r#"SELECT DISTINCT ON (repo_id) repo_id, repo_size_kb, file_count, loc
           FROM repo_metrics_history ORDER BY repo_id, snapshot_date DESC"#,
        &[],
    )?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let repo_id: i32 = row.get(0);
        let repo_size: Option<i32> = row.get(1);
        let file_count: Option<i32> = row.get(2);
        let loc: Option<i32> = row.get(3);
        map.insert(repo_id, Analysis {
            loc: loc.unwrap_or(0) as i64,
            file_count: file_count.unwrap_or(0) as i64,
            repo_size_kb: repo_size.unwrap_or(0) as i64,
        });
    }
    Ok(map)
}

fn fetch_repos(client: &mut Client) -> Result<Vec<Repo>> {
    let query = r#"
        SELECT id, full_name,
            stars, forks, watchers, subscribers_count, open_issues,
            has_ci, has_tests, has_readme, readme_lines, has_gitignore, has_roadmap, docs_file_count, docs_quality,
            language, is_private, is_archived, is_fork, is_template, default_branch,
            repo_size_kb, file_count, loc
        FROM repos WHERE is_archived = false ORDER BY full_name
    "#;

    let rows = client.query(query, &[]).context("Query repos failed")?;
    let mut repos = Vec::with_capacity(rows.len());
    for row in rows {
        let repo = Repo {
            id: row.get(0),
            full_name: row.get(1),
            stars: row.get(2),
            forks: row.get(3),
            watchers: row.get(4),
            subscribers_count: row.get(5),
            open_issues: row.get(6),
            has_ci: row.get(7),
            has_tests: row.get(8),
            has_readme: row.get(9),
            readme_lines: row.get(10),
            has_gitignore: row.get(11),
            has_roadmap: row.get(12),
            docs_file_count: row.get(13),
            docs_quality: row.get(14),
            language: row.get(15),
            is_private: row.get(16),
            is_archived: row.get(17),
            is_fork: row.get(18),
            is_template: row.get(19),
            default_branch: row.get(20),
            repo_size_kb: row.get(21),
            file_count: row.get(22),
            loc: row.get(23),
        };
        repos.push(repo);
    }
    Ok(repos)
}

fn count_loc_tokei(dir: &Path) -> (u64, u64) {
    let mut languages = Languages::new();
    let config = Config::default();
    languages.get_statistics(&[dir], EXCLUDED, &config);
    let total = languages.total();
    let loc = total.lines() as u64;
    let files = languages
        .iter()
        .map(|(_, lang)| lang.reports.len())
        .sum::<usize>() as u64;
    (loc, files)
}

fn get_dir_size_kb(path: &Path) -> i64 {
    let output = std::process::Command::new("du")
        .args(["-sk", path.to_str().unwrap_or("")])
        .output();
    match output {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            s.split_whitespace()
                .next()
                .and_then(|n| n.parse::<i64>().ok())
                .unwrap_or(0)
        }
        _ => 0,
    }
}

fn insert_snapshot(client: &mut Client, repo: &Repo, a: &Analysis) -> Result<u64> {
    let repo_size = if a.repo_size_kb > 0 {
        a.repo_size_kb
    } else {
        repo.repo_size_kb.unwrap_or(0) as i64
    };
    let file_count = if a.file_count > 0 {
        a.file_count
    } else {
        repo.file_count.unwrap_or(0) as i64
    };
    let loc = if a.loc > 0 {
        a.loc
    } else {
        repo.loc.unwrap_or(0) as i64
    };

    let sql = r#"
        INSERT INTO repo_metrics_history (
            repo_id, full_name, snapshot_date,
            repo_size_kb, file_count, loc,
            stars, forks, watchers, subscribers_count, open_issues,
            has_ci, has_tests, has_readme, readme_lines, has_gitignore, has_roadmap, docs_file_count, docs_quality,
            language, is_private, is_archived, is_fork, is_template, default_branch
        ) VALUES (
            $1, $2, CURRENT_DATE,
            $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24
        )
        ON CONFLICT (repo_id, snapshot_date)
        DO UPDATE SET
            repo_size_kb = EXCLUDED.repo_size_kb,
            file_count = EXCLUDED.file_count,
            loc = EXCLUDED.loc,
            stars = EXCLUDED.stars,
            forks = EXCLUDED.forks,
            watchers = EXCLUDED.watchers,
            subscribers_count = EXCLUDED.subscribers_count,
            open_issues = EXCLUDED.open_issues,
            has_ci = EXCLUDED.has_ci,
            has_tests = EXCLUDED.has_tests,
            has_readme = EXCLUDED.has_readme,
            readme_lines = EXCLUDED.readme_lines,
            has_gitignore = EXCLUDED.has_gitignore,
            has_roadmap = EXCLUDED.has_roadmap,
            docs_file_count = EXCLUDED.docs_file_count,
            docs_quality = EXCLUDED.docs_quality,
            language = EXCLUDED.language,
            is_private = EXCLUDED.is_private,
            is_archived = EXCLUDED.is_archived,
            is_fork = EXCLUDED.is_fork,
            is_template = EXCLUDED.is_template,
            default_branch = EXCLUDED.default_branch
    "#;

    client.execute(
        sql,
        &[
            &repo.id,
            &&*repo.full_name,
            &(repo_size as i32),
            &(file_count as i32),
            &(loc as i32),
            &repo.stars.unwrap_or(0),
            &repo.forks.unwrap_or(0),
            &repo.watchers.unwrap_or(0),
            &repo.subscribers_count.unwrap_or(0),
            &repo.open_issues.unwrap_or(0),
            &repo.has_ci,
            &repo.has_tests,
            &repo.has_readme,
            &repo.readme_lines,
            &repo.has_gitignore,
            &repo.has_roadmap,
            &repo.docs_file_count.unwrap_or(0),
            &repo.docs_quality.as_deref(),
            &repo.language.as_deref(),
            &repo.is_private,
            &repo.is_archived,
            &repo.is_fork,
            &repo.is_template,
            &repo.default_branch.as_deref(),
        ],
    )
    .map_err(|e| anyhow::anyhow!("Insert failed: {}", e))?;

    // Actualizar repos para que el frontend muestre loc/file_count/repo_size_kb
    client.execute(
        "UPDATE repos SET loc = $1, file_count = $2, repo_size_kb = $3 WHERE id = $4",
        &[&(loc as i32), &(file_count as i32), &(repo_size as i32), &repo.id],
    )
    .map_err(|e| anyhow::anyhow!("Update repos failed: {}", e))?;

    Ok(1)
}

