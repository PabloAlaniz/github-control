# Daily Snapshot: Comparación y opciones de mejora

Documentación de la investigación realizada sobre las variantes de daily snapshot, paralelismo y alternativas de implementación.

---

## Las dos variantes originales

| Aspecto | `daily-snapshot.js` (API) | `daily-snapshot-clone.js` (clone) |
|---------|---------------------------|-----------------------------------|
| **Método** | HTTP a backend → deep-analyze → GitHub REST API | `git clone` + análisis en disco |
| **Llamadas API** | 3 + N por repo (N = archivos, timeout 25s) | 0 |
| **Rate limit** | 5000 req/h → ~67 repos antes de fallar | No aplica |
| **Requiere** | Backend en localhost:13337 | `git` instalado |
| **Tiempo 93 repos** | ~14 min (+ ~26 fallan por limit) | **~2 min 50 s** |
| **repo_size_kb** | Tamaño en GitHub (comprimido) | `du -s` en disco (descomprimido) |
| **LOC/file_count** | Mismo criterio (CODE_EXTENSIONS, EXCLUDED_DIRS) | Idéntico |

### Diferencias en métricas

- **LOC y file_count**: Prácticamente iguales (misma lógica de extensiones y exclusión).
- **repo_size_kb**: 
  - API: valor de `repos.size` (KB almacenados en GitHub).
  - Clone: `du -sk` del directorio clonado (disco real). Suele ser mayor (2–5x en repos típicos).

Para tendencias históricas ambos sirven, pero no son directamente comparables si se cambia de método.

---

## Benchmarks realizados (93 repos)

| Implementación | Tiempo | Concurrencia | Notas |
|----------------|--------|--------------|-------|
| Node secuencial | ~2 min 50 s | 1 | Baseline |
| Node `-c 5` | 151.81 s | 5 | p-limit |
| Node `-c 10` | 150.81 s | 10 | Sin mejora vs -c 5 |
| Go (paralelismo total) | 52.30 s | 93 | ~3× vs Node |
| **Rust (Rayon + tokei)** | **51.79 s** | 10 workers | Ligeramente más rápido que Go |
| **Rust con cache** | **~34 s** | 10 workers | `--cache-dir`, ls-remote evita fetch cuando no hay cambios |

### Hallazgos

1. **Node -c 5 vs -c 10**: Casi idéntico (~1 s de diferencia). El cuello de botella es red o disco, no el número de workers. Más de ~5–10 workers en Node no aporta beneficio.

2. **Go con 93 goroutines**: 3× más rápido. Las goroutines son muy baratas; el paralelismo real aprovecha mejor la latencia de red y el I/O de disco.

3. **Cuellos de botella identificados** (por orden de impacto):
   - `git clone`: descarga por red
   - Conteo de LOC: lectura de archivos (Node lee cada archivo; Go usa `filepath.WalkDir`)
   - `du -s`: I/O disco
   - Escritura en DB: menor impacto

4. **Profiling por capa**: Las tres variantes aceptan `--profile` para ver el desglose exacto de tiempos. Ver [sync-profile-guide.md](sync-profile-guide.md). **Resultados reales** de los 4 scripts: [sync-benchmark-results.md](sync-benchmark-results.md).

---

## Implementaciones actuales

### 1. Node (`scripts/daily-snapshot-clone.js`)

- **Paralelismo**: p-limit con `-c` / `--concurrency` (default: 3).
- **LOC**: lectura de archivos con `fs.readFileSync` + `split('\n')`.
- **Uso**:
  ```bash
  node scripts/daily-snapshot-clone.js           # 3 en paralelo
  node scripts/daily-snapshot-clone.js -c 5     # 5 en paralelo
  node scripts/daily-snapshot-clone.js --limit 10  # probar con 10
  ```

### 2. Go (`scripts/daily-snapshot-clone/main.go`)

- **Paralelismo**: total (una goroutine por repo).
- **LOC**: `filepath.WalkDir` + `os.ReadFile` (mismo criterio que Node).
- **Uso**:
  ```bash
  go run ./scripts/daily-snapshot-clone/         # desde project root
  go build -o snapshot-go ./scripts/daily-snapshot-clone/ && ./snapshot-go
  ```
- **Requiere**: Go 1.22+, `config/snapshot.json` (DATABASE_URL, GITHUB_TOKEN).

### 3. Rust (`scripts/daily-snapshot-clone-rust/`)

- **Paralelismo**: Rayon (thread pool, paralelismo por datos).
- **LOC**: **tokei** (librería Rust, más rápido en repos con muchos archivos).
- **Uso**:
  ```bash
  cargo run --release --manifest-path scripts/daily-snapshot-clone-rust/Cargo.toml
  # O desde el directorio:
  cd scripts/daily-snapshot-clone-rust && cargo run --release
  ```
- **Requiere**: Rust (rustup/cargo), `config/snapshot.json`, `git`.

---

## Por qué Node/JS hoy

- El proyecto ya es JS/TS (frontend React, backend Hono).
- `pg`, `fs`, `child_process` son suficientes.
- Sin dependencias nuevas.
- Cron simple: `node scripts/daily-snapshot-clone.js`.

No es un requisito de diseño; es coherencia con el stack actual. **Go es una alternativa más rápida** cuando el tiempo importa (ej. cron diario con muchos repos).

---

## Opciones de mejora evaluadas

### 1. Paralelismo en Node (implementado)

- **Hecho**: p-limit con `-c` (default 3, probado 5 y 10).
- **Resultado**: -c 10 no mejora respecto a -c 5; el límite está en red/disco.
- **Recomendación**: Mantener `-c 5` como valor razonable.

### 2. Go con paralelismo total (implementado)

- **Hecho**: versión Go con 93 goroutines.
- **Resultado**: 52 s vs 151 s en Node; ~3× más rápido.
- **Recomendación**: Usar Go para el cron diario si se quiere minimizar tiempo.

### 3. Usar `tokei` para conteo de LOC (no implementado)

- **Idea**: reemplazar el conteo custom por `tokei -o json .` (binario Rust).
- **Pros**: ~3–10× más rápido en repos con muchos archivos (ej. un repo de ~14k archivos).
- **Contras**: requiere instalar tokei (`brew install tokei`).
- **Estimación**: reduciría el tiempo del repo más grande; impacto global modesto (~5–15 %).

### 4. Cache incremental (no implementado)

- **Idea**: mantener clones locales; `git fetch` + `git reset` en vez de clone completo; solo re-analizar si hay commits nuevos.
- **Pros**: en runs diarios la mayoría no cambia; potencial de reducir tiempo en 80 %+.
- **Contras**: requiere directorio persistente, más lógica y gestión de estado.

### 5. Python / Rust

- **Python**: similar a Node paralelo; no aporta ventaja significativa.
- **Rust**: muy rápido, pero esfuerzo alto; Go ya resuelve bien el caso.

---

## Recomendación actualizada

| Opción | Esfuerzo | Ganancia | Estado |
|--------|----------|----------|--------|
| Paralelismo en Node | Bajo | Moderada | ✅ Implementado |
| Go paralelismo total | Medio | ~3× | ✅ Implementado |
| tokei para LOC | Bajo | 5–15 % en repos grandes | Pendiente |
| Cache incremental | Medio | 80 %+ en runs diarios | Pendiente |
| Python/Rust | Alto | Marginal | No prioritario |

**Orden sugerido para cron diario**:
1. Usar **Go** (`go run ./scripts/daily-snapshot-clone/`) para mejor tiempo (~52 s).
2. Si Go no está disponible: **Node** con `-c 5` (~2.5 min).
3. Evaluar cache incremental si se escala a 200+ repos.

---

## Opciones de mejora (referencia teórica)

### Python + `asyncio` / `multiprocessing`

- Similar a Node paralelo. Solo tiene sentido si ya se usa Python en el proyecto.

### Rust

- Binario muy rápido, pero Go ya cumple el rol. Solo si se prioriza máxima performance y control fino.

---

## Checklist FODA (resumen)

| | API | Clone |
|---|-----|-------|
| **Fortalezas** | Sin git, corre en worker/cloud | 0 rate limit, más rápido |
| **Oportunidades** | Proactivo con rate limit | Paralelismo, tokei, cache incremental |
| **Debilidades** | Rate limit, depende del backend | Requiere git, más disco temporal |
| **Amenazas** | Límites de GitHub | Repos muy grandes (clone lento) |
