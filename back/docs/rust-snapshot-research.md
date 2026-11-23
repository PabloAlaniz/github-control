# Rust para Daily Snapshot: investigación y mejores prácticas

Documento de investigación previo a la implementación de una variante Rust del daily snapshot.

*Investigación realizada en febrero 2026.*

---

## 1. Estado actual de benchmarks

| Implementación | Tiempo (93 repos) | Cuello de botella |
|----------------|-------------------|-------------------|
| Node -c 5 | 151 s | Red (clone), I/O (LOC) |
| Go paralelismo total | **52 s** | Red (clone), I/O (LOC) |

El cuello de botella principal es **git clone** (red). El conteo de LOC en repos grandes (ej. un repo de ~1.5M LOC y ~14k archivos) también aporta tiempo significativo.

---

## 2. Mejores prácticas Rust para este workload

### 2.1 Concurrencia: Tokio vs Rayon

**Tokio** (async runtime):
- **I/O-bound**: `async`/`await` con `join_all` — excelente para muchas conexiones/lecturas concurrentes.
- **CPU-bound**: usar `tokio::task::spawn_blocking` para no bloquear el executor; o librerías dedicadas como **Rayon**.
- Patrón recomendado para workloads mixtos (I/O + CPU): `spawn_blocking` para operaciones bloqueantes (clone, conteo LOC).

**Rayon** (paralelismo por datos):
- `into_par_iter().for_each()` para procesar colecciones en paralelo.
- Ideal para "map" sobre N items independientes (cada repo = clone + analizar + insertar).
- Más simple que Tokio para este caso: no necesitamos async puro, solo paralelismo.

**Recomendación**: **Rayon** para orquestar los 93 repos (como hace Go con goroutines). Cada tarea: `git clone` (process) → conteo LOC → `du` → insert DB.

---

### 2.2 Git: proceso vs librería

| Enfoque | Pros | Contras |
|---------|------|---------|
| `std::process::Command("git", "clone", ...)` | Simple, mismo que Go/Node. Probado. | Spawn de proceso. |
| **libgit2** (via `git2` crate) | Sin proceso, API Rust. | Síncrono, más complejo. Shallow clone requiere configuración. |
| **gitoxide** (gix) | Pure Rust, async-friendly. Shallow clone soportado. | API en evolución. Curva de aprendizaje. |

**Conclusión**: Para este proyecto, **`Command` con `git clone`** es la opción más pragmática. El cuello de botella es la red, no el spawn. Gitoxide podría explorarse en una segunda iteración si se busca eliminar la dependencia de `git` instalado.

---

### 2.3 Conteo de LOC: custom vs Tokei

| Enfoque | Pros | Contras |
|---------|------|---------|
| Custom (walkdir + read) | Control total, mismo criterio que Node/Go. | Más lento en repos con muchos archivos. |
| **Tokei** (lib o subprocess) | Muy rápido, usa Rayon internamente. 150+ lenguajes. | Criterios de LOC ligeramente distintos (por lenguaje). |

**Tokei como librería** (`tokei` crate):
```rust
use tokei::{Config, Languages};
let mut languages = Languages::new();
languages.get_statistics(&[path], excluded, &Config::default());
let total: u64 = languages.iter().map(|l| l.code).sum();
```

**Tokei como subprocess**:
```bash
tokei -o json .
```
- Más simple de integrar.
- Misma velocidad (binario optimizado).

**Recomendación**: Usar **tokei como librería** para evitar spawn y tener control. Si los criterios (extensiones, exclusiones) difieren del Node/Go, documentar la diferencia. Alternativamente, **tokei subprocess** si priorizamos simplicidad.

---

### 2.4 Base de datos

| Crate | Tipo | Notas |
|-------|------|-------|
| `sqlx` | Async (tokio) | Compile-time checked, connection pool. |
| `tokio-postgres` | Async | Bajo nivel, muy usado. |
| `postgres` / `rust-postgres` | Síncrono | Más simple para Rayon (cada tarea hace query bloqueante). |

**Recomendación**: Con **Rayon**, usar `rust-postgres` (síncrono) o `sqlx` en modo blocking. Cada worker hace su insert de forma bloqueante; no necesitamos async para la DB en este diseño.

---

## 3. Arquitectura propuesta

```
Repos (from DB)
     ↓
Rayon::par_bridge() o (0..repos.len()).into_par_iter()
     ↓
Para cada repo (en paralelo):
  1. git clone --depth 1 (Command)
  2. tokei::Languages::get_statistics() [o walkdir custom si queremos idéntico criterio]
  3. du -sk (Command)
  4. INSERT ... ON CONFLICT (postgres)
  5. rm -rf workdir
```

- **Paralelismo**: Rayon con número de threads por defecto (num_cpus) o configurable.
- **Sin Tokio**: el workload no requiere async I/O complejo; Rayon es suficiente y más simple.

---

## 4. Posibles mejoras frente a Go

| Aspecto | Go | Rust (propuesto) |
|---------|-----|------------------|
| Clone | `exec.Command` | `std::process::Command` (equivalente) |
| LOC | `filepath.WalkDir` + read | **Tokei lib** (más rápido en repos grandes) |
| Paralelismo | 93 goroutines | Rayon (thread pool, similar) |
| Binario | Estático, ~10MB | Estático, ~5–8MB (release) |
| Memoria | Mayor bajo carga | Típicamente menor |

**Ganancia esperada**: 
- **Principal**: Tokei para LOC — en repos con 10k+ archivos, tokei puede ser 5–10× más rápido que un walk manual.
- **Secundaria**: Menor overhead por thread (Rayon vs goroutines), posible mejora del 10–20 % en tiempo total.
- **Estimación**: 52 s (Go) → **35–45 s** (Rust + tokei).

---

## 5. Criterios de LOC: compatibilidad

El script Node/Go usa:
- `CODE_EXTENSIONS`: .js, .jsx, .ts, .tsx, .py, .go, etc.
- `EXCLUDED_DIRS`: node_modules, vendor, dist, .git, etc.

Tokei usa `languages.json` y agrupa por lenguaje. El **total** de "code" puede diferir ligeramente:
- Tokei excluye comentarios y blanks de "code".
- Nuestro custom cuenta todas las líneas (incl. comentarios) en archivos de código.

**Opción A**: Usar tokei y aceptar pequeñas diferencias. Para tendencias históricas es válido.
**Opción B**: Mantener walkdir + read (custom) para compatibilidad exacta con Node/Go. Más lento pero idéntico.

**Recomendación**: Opción A (tokei) — la ganancia de velocidad justifica una ligera diferencia. Documentar en la comparación.

---

## 6. Referencias

- [Tokio: Concurrency vs Parallelism](https://ianbull.com/posts/tokio-parallel)
- [Rayon ParallelIterator](https://docs.rs/rayon/latest/rayon/iter/trait.ParallelIterator.html)
- [Tokei crate](https://docs.rs/tokei/latest/tokei/)
- [Gitoxide shallow clone](https://github.com/GitoxideLabs/gitoxide)
- [Rust vs Go I/O benchmark](https://ritik-chopra28.medium.com/rust-async-vs-go-goroutines-my-side-by-side-benchmark-of-3-real-workloads-1f1d31b08718)
