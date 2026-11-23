# Benchmark Daily Snapshot - Comparación 93 repos

Ejecutado el 2026-02-19. **Secuencial** (uno tras otro) para evitar competencia de ancho de banda. Resultados con `--profile`.

## Tiempo total (wall clock)

| Script | Tiempo | Modo |
|--------|--------|------|
| **Rust (cache)** | **34.58 s** | `--cache-dir` ~/.cache/github-control-snapshot |
| **Rust (clone)** | **53.95 s** | Clone efímero, sin cache |
| **Go** | 83.38 s | Paralelismo total (93 goroutines) |
| Node -c 5 | 152.93 s | 5 clones en paralelo |

## Desglose por capa (suma acumulada en segundos)

| Script | clone | ls_remote / fetch | tokei / count_loc | du | db_insert |
|--------|-------|-------------------|-------------------|-----|-----------|
| **Rust (cache)** | 0 | **65.2** (93 hits) | 0 | 0 | **31.6** |
| **Rust (clone)** | **272.3** (93) | 0 | 1.9 | 0.4 | **45.9** |
| **Go** | **671.5** (93) | - | 0.7 | 0.5 | **169.8** |
| **Node -c 5** | 147.3 (93) | - | 0.6 | 0.5 | **563.1** |

*Los valores son suma de todos los repos (no wall clock). Con paralelismo el wall clock es menor.*

## Hallazgos

1. **Rust con cache es el más rápido (35 s)** cuando no hay cambios en los repos. Cuello de botella: `ls_remote` (65 s suma) + `db_insert` (32 s suma, serializado por Mutex).

2. **Rust sin cache (54 s)** es ~2× más rápido que Go (83 s). Rayon con 10 workers parece más eficiente que 93 goroutines para este workload (menos contención).

3. **Go (83 s)** — clone domina (672 s suma). Paralelismo total puede saturar conexiones o tener overhead.

4. **Node (153 s)** es el más lento. `db_insert` suma 563 s — la conexión pg parece serializar los inserts con concurrencia limitada (-c 5).

5. **Oportunidades de optimización:**
   - Rust cache: batch INSERT (multi-row) para reducir los ~32 s de db_insert.
   - Rust cache: más workers para `ls_remote` (ej. RAYON_NUM_THREADS=24).
   - Todos: conexión en pool o múltiples conexiones para DB.

## Comandos usados

```bash
cargo run --release --manifest-path scripts/daily-snapshot-clone-rust/Cargo.toml -- --profile
cargo run --release --manifest-path scripts/daily-snapshot-clone-rust/Cargo.toml -- --cache-dir ~/.cache/github-control-snapshot --profile
go run ./scripts/daily-snapshot-clone/ --profile
node scripts/daily-snapshot-clone.js -c 5 --profile
```
