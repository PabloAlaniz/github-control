# Profiling del Daily Snapshot por capa

Guía para debugear en qué capa del sync se pierden más segundos en cada script.

## Uso

Cada variante acepta `--profile` para imprimir un desglose de tiempos acumulados por capa al final:

```bash
# Rust (con cache recomendado para ver ls_remote vs fetch)
cargo run --release --manifest-path scripts/daily-snapshot-clone-rust/Cargo.toml -- --cache-dir ~/.cache/github-control-snapshot --profile

# Go
go run ./scripts/daily-snapshot-clone/ --profile

# Node (-c 5 para comparable)
node scripts/daily-snapshot-clone.js -c 5 --profile
```

Con `--limit N` podés probar con menos repos para iterar más rápido:

```bash
cargo run --release --manifest-path scripts/daily-snapshot-clone-rust/Cargo.toml -- --limit 20 --profile
go run ./scripts/daily-snapshot-clone/ --limit 20 --profile
node scripts/daily-snapshot-clone.js --limit 20 -c 5 --profile
```

## Capas medidas

| Capa | Rust | Go | Node | Descripción |
|------|------|-----|-----|-------------|
| ls_remote | ✓ | - | - | Check SHA remoto sin fetch (solo con cache) |
| clone | ✓ | ✓ | ✓ | git clone |
| fetch | ✓ | - | - | git fetch + reset (solo cuando hay cache) |
| tokei/count_loc | ✓ | ✓ | ✓ | Conteo de LOC (Rust: tokei, Go/Node: walkdir) |
| du | ✓ | ✓ | ✓ | Tamaño en disco |
| db_insert | ✓ | ✓ | ✓ | INSERT en PostgreSQL |

Los tiempos son **suma** de todos los repos (no wall-clock). Con paralelismo, el wall-clock es menor. Sirve para ver qué fase consume más tiempo agregado y dónde conviene optimizar.

## Interpretación

- **Rust con cache (día típico)**: Si `ls_remote` suma ~10–15s y `db_insert` ~2s, el resto es overhead/paralelismo. Optimizar: más workers, batch INSERT.
- **Rust/Go sin cache**: `clone` dominará. Opciones: cache incremental, distribución de clones.
- **Node**: `clone` y `count_loc` (más lento que tokei) suelen dominar. Subir `-c` ayuda hasta saturar red.

## Benchmark completo (93 repos)

Ver [sync-benchmark-results.md](sync-benchmark-results.md) para resultados de ejecución real.

## Ejemplo de salida

```
Done in 34.48s | Analyzed: 0 | Cached: 93 | Errors: 0
  --- Profiling (sum across all repos) ---
  ls_remote:  12.34s (93 hits)
  clone:       0.00s (0 repos)
  fetch:       0.00s (0 repos)
  tokei:       0.00s (0 repos)
  du:          0.00s
  db_insert:   2.10s
============================================================
```
