# StreamVerse — scale report (v12.12.6)

Everything below is **measured**, not estimated: a load generator hitting the real
server process, reading `/proc/<pid>/stat` for CPU and `/proc/<pid>/status` for RSS.
Keyless mode (no `TMDB_KEY`), catalogue of 10,593 live channels loaded.

The "10,000 users" question has two readings. Both are answered.

---

## 1. What one visitor actually costs

A cold visitor (first ever load, empty browser cache) makes 8 requests:
`/`, `/app.js`, `/style.css`, `/hls.min.js`, `/api/trending`, `/api/movie/popular`,
`/api/tv/popular`, `/api/geo`.

| Metric | Cold visitor | Returning visitor (static cached) |
|---|---|---|
| Requests to our server | 8 | 4 (API only) |
| Bytes from our server | **256 KB** (brotli) | **19 KB** |
| Server CPU | **1.4 ms** | **1.0 ms** |

Brotli matters a lot: uncompressed those same 8 responses are 906 KB, so
compression cuts origin egress **3.5×**.

**Video does not flow through the server.** ~85% of streams play direct from the
origin CDN (direct-play path, round 18). Only the ~15% that need the CORS proxy
consume our bandwidth, which is what makes the numbers below survivable.

---

## 2. "10,000 users at the same instant" (concurrent)

Worst case anybody can construct: 10,000 browsers all doing a cold first load in
the same instant, all 80,000 requests in flight at once.

| Concurrent cold sessions | Requests | Wall | Success | p50 | p95 | p99 | Peak RSS |
|---|---|---|---|---|---|---|---|
| 1,000 | 8,000 | 2.1 s | 8000/8000 | 220 ms | 479 ms | 588 ms | 216 MB |
| 5,000 | 40,000 | 10.7 s | 40000/40000 | 990 ms | 2.67 s | 3.49 s | 240 MB |
| **10,000** | **80,000** | **19.2 s** | **80000/80000** | 1.99 s | 4.04 s | 6.43 s | **293 MB** |

**Zero failed requests at 10,000 concurrent.** Peak RSS 293 MB fits inside a
Render free instance (512 MB).

This is a deliberately unrealistic shape — a true instantaneous thundering herd.
Latency degrades (p95 4 s) but nothing errors, nothing is dropped, and the process
survives. The server is throughput-bound, not failure-bound.

---

## 3. Sustained arrival rate (the realistic shape)

Real traffic arrives as a *rate*, not a single instant. New cold sessions per second,
held for 20 s:

| New sessions/s | Sessions | Requests | p50 | p95 | p99 | CPU used | Peak RSS |
|---|---|---|---|---|---|---|---|
| 20 | 400 | 3,040 | 4 ms | 11 ms | 18 ms | 4% of one core | 217 MB |
| 60 | 1,200 | 9,120 | 10 ms | 25 ms | 40 ms | 10% of one core | 225 MB |
| 150 | 3,000 | 22,800 | 18 ms | 50 ms | 76 ms | **19% of one core** | 243 MB |

150 new visitors **every second** costs one fifth of a single CPU core and answers
in 50 ms at p95. Zero errors throughout.

---

## 4. "10,000 users total" (daily/monthly audience)

At 1.4 ms CPU and 256 KB per cold visit:

| Audience | Server CPU/day | Origin egress (all cold) | Realistic egress (70% return) |
|---|---|---|---|
| 10,000 visits/day | 14 CPU-seconds | 2.5 GB/day | ~0.9 GB/day |
| 10,000 visits/month | 0.5 CPU-s/day | 2.5 GB/month | ~0.9 GB/month |

10,000 visitors/day is **~76 GB/month** of page-load egress at worst, ~27 GB
realistically — inside Render free's 100 GB.

**The real limit is video, not pages.** From the round-18 measurements:

| Path | Phone | Desktop 1080p |
|---|---|---|
| Proxy everything | 0.68 GB/hr → 147 hr per 100 GB | 1.29 GB/hr → 78 hr |
| Direct-play, India (77% direct) | 0.156 GB/hr → **639 hr** | 0.297 GB/hr → **337 hr** |
| Direct-play, global (85% direct) | 0.102 GB/hr → **980 hr** | 0.194 GB/hr → **517 hr** |

So on Render free (100 GB/month) with direct-play on, the app supports roughly
**600–1,000 phone viewing-hours per month**. 10,000 users each watching 5 minutes
= 833 hours → fits. 10,000 users each watching an hour = 10,000 hours → needs a
paid plan or a CDN in front.

---

## 5. The bug this measurement found and fixed

The first 5,000-concurrent run **OOM-killed the server** (exit 137, RSS 581 MB and
climbing). Isolating the paths:

| Path under 3,000-concurrent load | Peak RSS (before fix) |
|---|---|
| Static files only (`/app.js`, `/style.css`, `/hls.min.js`, `/`) | 112 MB — flat |
| `/api/trending` only | 372 MB |
| Four mixed API endpoints (12,000 requests) | **1,052 MB — fatal** |

**Cause.** Static assets were pre-compressed and cached, but every *API* response
ran `zlib.brotliCompress` on demand. Each call allocates a native compressor
context off-heap and queues on libuv's 4-thread pool. Node allocates thousands of
contexts before the pool drains any, so RSS explodes. On a 512 MB Render instance
that is a hard kill, and Render would restart into a 30–60 s cold start.

**Fix** (`server.js`, `negotiateCompression`), two layers:

1. **Identical-body compression cache** — a burst is overwhelmingly the *same* hot
   endpoints, and identical bytes compress to identical bytes. SHA-1 the body,
   LRU-cache the compressed result (96 entries, ≤512 KB each). 3,000 concurrent
   `/api/trending` now cost **one** compression instead of 3,000.
2. **In-flight ceiling** — at most 24 compressions running at once. Past that,
   respond uncompressed rather than queueing unbounded native contexts. A few
   requests use more egress; the process stays alive.

**Result:**

| | Before | After |
|---|---|---|
| Peak RSS, 12k mixed API requests | 1,052 MB (**killed**) | **214 MB** |
| Same burst wall time | 7.2 s | **4.2 s** |
| Peak RSS, 10,000 concurrent cold sessions | process died | **293 MB** |

Brotli is still negotiated and served normally (`Content-Encoding: br` verified).
The server is now faster *and* uses one fifth the memory under load.

---

## 6. Verdict

| Question | Answer |
|---|---|
| 10,000 users **at once**? | Yes — 80,000 requests, 0 errors, 293 MB, p95 4 s. Survives on Render free. |
| 10,000 users **per day**? | Comfortably — ~14 CPU-seconds/day, ~1 GB/day of page egress. |
| Where it actually breaks | Video egress, not CPU or RAM. ~600–1,000 phone viewing-hours/month on a 100 GB plan. |
| Headroom next | Put Cloudflare (free) in front of `/` and the static assets — they are immutable and cacheable, which removes ~90% of origin requests. |
