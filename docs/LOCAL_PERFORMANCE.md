# ForgeAI Local AI Performance & Resource Optimization

## 1. Overview & Reference Hardware

ForgeAI is designed to operate locally on developer machines without cloud dependencies. The architecture is engineered to run reliably on memory-constrained systems, including standard laptops with 16 GB unified RAM (such as Apple MacBook M1/M2/M3) as well as Windows and Linux systems.

### Hardware Reference Baseline:

- **Processor**: Apple M1 / Equivalent x86_64
- **Memory**: 16 GB Unified Memory / RAM
- **Storage**: Fast NVMe / PCIe SSD
- **Ollama Engine**: Local inferencing with Metal / CUDA GPU offloading

---

## 2. Measured Performance Benchmarks

All metrics below are measured and verified via `tests/benchmark.test.ts`:

| Benchmark Phase                     | Target Metric                                  | Measured Value                                         | Validation Status |
| :---------------------------------- | :--------------------------------------------- | :----------------------------------------------------- | :---------------- |
| **AST Parsing & Semantic Chunking** | Parsing & chunking 500-line TS files           | **1,357.8 docs/sec** (36.82 ms for 50 docs)            | PASSED            |
| **Vector Dot-Products (dim=768)**   | Cosine similarity scoring                      | **520,438 vector ops/sec** (9.61 ms for 5,000 vectors) | PASSED            |
| **Context Packing Latency**         | Assembling top-8 chunks under 3000 token limit | **0.106 ms**                                           | PASSED            |
| **Token Budget Compliance**         | Packed tokens vs token budget                  | **2,734 tokens packed** (Budget: 3,000)                | PASSED            |
| **Core Process Memory**             | Baseline testing & runtime RSS / Heap          | **RSS: 105.66 MB**, **Heap: 16.70 MB**                 | PASSED            |

---

## 3. Key Local AI Optimizations

### 3.1 Keep-Alive Sentinel Handling

- Ollama expects numeric `-1` to keep a model loaded in VRAM indefinitely.
- Passing string `"-1"` causes an Ollama HTTP 400 error (`"missing unit in duration"`).
- `normalizeOllamaKeepAlive` safely maps `'-1'` to `-1` and preserves valid duration strings (e.g. `'5m'`), preventing repeated model reload stalls.

### 3.2 Bounded Context & Output Limits

- **Context Length (`num_ctx`)**: Capped at `8192` (or provider configuration) to prevent VRAM allocation overflows.
- **Max Generation (`num_predict`)**: Capped at `2048` tokens to protect against unbounded generation loops.
- **Batch Processing (`num_batch`)**: Set to `512` to maximize Metal/CUDA prefill throughput.

### 3.3 Activity Controller & Timeout Protection

- Long-running network and model inferencing streams use `createActivityController` (`packages/ai/src/http.ts`).
- An activity heartbeat monitors stream progress. If no chunks arrive within 180 seconds, the stream aborts cleanly, preventing zombie processes and locked ports.
- On Windows, undici fetch connections are configured with explicit `headersTimeout: 60000` to prevent `Headers Timeout Error` on slow cold-start model loads.

### 3.4 Token Budgeting in RAG Assembly

- `packRetrievalResults` enforces a strict character and token budget ceiling before context is merged into the system prompt.
- Deduplication prevents duplicate file blocks from inflating prompt tokens.

---

## 4. Cancellation & Resource Recovery

- Every agent run and stream maintains an isolated `AbortController`.
- Calling `cancelAgent()` immediately aborts the active stream, releases open workspace handles, and resets permission requests.
- Checkpoints are created prior to workspace mutations, ensuring zero data loss if an agent run is cancelled or fails mid-operation.

---

## 5. Verification & Test Suite

- Benchmark suite: `tests/benchmark.test.ts` (4/4 tests passing).
- Full workspace test pass rate: **132/132 tests passing**.
- Clean TypeScript typecheck and ESLint checks.
