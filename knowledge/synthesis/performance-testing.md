---
topic: performance-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [8]
    role: primary
ingestedAt: "2026-05-24"
---

# Performance Testing (Synthesis)

> Performance testing validates that an application can serve large numbers of concurrent users without degrading beyond acceptable limits. It spans two distinct problem spaces: backend load simulation (server response time, throughput, error rate under concurrent traffic) and frontend rendering performance (what the user's browser actually experiences after the server responds). Averages mislead because they obscure the long tail — a system with an 800 ms mean response time can still deliver a 4 s experience to 1 in 100 users. The split matters because browser rendering accounts for an estimated 80–90% of perceived page load time; optimising only the server side leaves the dominant cost untouched. (full-stack-testing-mohan ch-08)

---

## Test types

### Load testing

Validates that the system handles the expected peak concurrent user count while keeping response time within the agreed threshold. Run multiple iterations to establish a stable benchmark. KPIs are derived from real traffic data — monthly active users, session frequency, session duration, and active-hour distribution — rather than stakeholder declarations. Example derivation: 100,000 users × 2 sessions/month ÷ 30 days ÷ 12 active hours gives approximately 166 concurrent peak users. Typical tools: JMeter, Gatling, k6, Apache Benchmark. (full-stack-testing-mohan ch-08)

### Stress testing

Incrementally increases load beyond the expected peak — in small discrete steps — to find the precise breaking point at which error rates climb. The result drives infrastructure capacity planning for sale events, new-region rollouts, and horizontal scaling decisions. The system should degrade gracefully rather than crash; discovering the failure mode under a controlled test is preferable to discovering it under real traffic. Typical tools: JMeter (step thread group plugin), Gatling. (full-stack-testing-mohan ch-08)

### Spike testing

A sudden, non-gradual surge of load rather than a stepped ramp-up, used to determine how the system reacts to an unexpected burst — for example, a viral social post or a flash-sale announcement. The key variable is the absence of ramp-up time. (full-stack-testing-mohan ch-08)

### Soak testing

Holds the application under constant expected-level load for an extended duration — hours or days — to surface slow-degradation defects: memory leaks, connection pool exhaustion, thread accumulation, or background-job resource consumption. A system can pass a 5-minute load test and fail a 12-hour soak test. Typical tools: JMeter, Gatling, k6. (full-stack-testing-mohan ch-08)

### Volume testing

Validates that the system handles the expected data and concurrent-user volume within response-time thresholds. Used interchangeably with load testing in many contexts; emphasis is on the quantity of data processed alongside the concurrent user count. (full-stack-testing-mohan ch-08)

### Scalability testing

Measures how response time and throughput change as load increases incrementally, to determine whether performance scales linearly, sub-linearly, or hits a hard ceiling before the target load is reached. Informs cloud infrastructure provisioning and horizontal-scaling strategy. Implicit in step-ramp stress testing. (full-stack-testing-mohan ch-08)

---

## Backend KPIs

### Throughput (RPS)

Requests processed per unit time — the system-side measure of capacity. More precise than concurrent-user count because it is directly observable from server metrics. Derived from traffic data: peak hourly sessions × requests per session gives a throughput requirement. Example: 1,000 peak hourly users × 5 requests per session = 5,000 requests/hour. Never accept a stakeholder-stated number without tracing it back to actual usage data or validated competitor benchmarks. (full-stack-testing-mohan ch-08)

### Response time percentiles (p50, p95, p99)

End-to-end time from user request to fully loaded response. Percentiles — not averages — are the correct reporting unit:
- p50 (median): half of requests complete within this time; the "typical" experience.
- p90: nine in ten requests complete within this time; a common SLO threshold.
- p95: reveals near-worst-case behaviour affecting 1 in 20 users.
- p99: catches the long tail that averages hide entirely; 1 in 100 users at high-traffic volumes is a large absolute number.

Report p90, p95, and p99 alongside the mean on every test run. A near-flat spread across p90–p100 signals saturation — the system has hit its ceiling. KPI targets should be set from production data or competitor benchmarks, not aspirational declaration. (full-stack-testing-mohan ch-08)

### Error rate

The proportion of requests returning errors (5xx, timeouts, connection refused) at a given load level. A rising error rate as load increases is the primary indicator of system saturation in stress tests. Baseline error rate should be 0% under expected load; any non-zero rate under normal conditions indicates an existing defect. (full-stack-testing-mohan ch-08)

### Concurrent users

The number of parallel virtual users active at any moment. A proxy metric for load; throughput is the more precise system-side measure. Derive the concurrent-user target from monthly active users, session frequency, average session length, and the number of active hours per day. Ramp-up time and think time must be configured to match realistic user arrival and behaviour patterns — setting both to zero produces an unrealistic thundering-herd scenario. (full-stack-testing-mohan ch-08)

---

## Frontend KPIs (Core Web Vitals)

Google designates three metrics as Core Web Vitals and incorporates them into SEO ranking signals. All three are measured at the p75 percentile across real users. (full-stack-testing-mohan ch-08)

### LCP (Largest Contentful Paint): target <= 2.5s at p75

Measures how long it takes for the largest visible content element — typically a hero image or a large text block — to render in the viewport. Represents the moment the page feels loaded to the user. Values above 4 s are rated "Poor." Primary causes of slow LCP: slow server response, render-blocking resources, slow resource load times, and client-side rendering delays. (full-stack-testing-mohan ch-08)

### INP (Interaction to Next Paint): target <= 200ms at p75

Measures the latency of page responsiveness to all user interactions throughout the session — clicks, taps, keyboard input. Replaced First Input Delay (FID) as an official Core Web Vital in March 2024; INP is broader because it captures all interactions rather than only the first. Values above 500 ms are rated "Poor." High INP usually indicates long-running JavaScript tasks blocking the main thread. (full-stack-testing-mohan ch-08)

### CLS (Cumulative Layout Shift): target <= 0.1 at p75

Measures visual instability — how much page content unexpectedly moves as the page loads. A score of 0 indicates no unexpected shifts; 0.25 or above is "Poor." Common causes: images or ads without reserved dimensions, dynamically injected content above existing content, web fonts causing invisible-to-visible text swap. High CLS degrades usability and causes mis-clicks. (full-stack-testing-mohan ch-08)

### FCP (First Contentful Paint)

Time until the browser renders any DOM content — text, image, SVG — for the first time. Indicates the user sees something happening rather than a blank screen. Not an official Core Web Vital but a useful diagnostic signal and a prerequisite reference point for other metrics. (full-stack-testing-mohan ch-08)

### TTFB (Time to First Byte)

Time from the request being sent to the first byte of the response being received. A high TTFB reflects slow server processing, network latency, or a cache miss. Appears as the earliest band in a waterfall view and sets a lower bound on all other frontend metrics. (full-stack-testing-mohan ch-08)

---

## Bottleneck analysis

Bottlenecks emerge across the full stack. When a performance test reveals degradation, root-cause analysis must examine each layer before tuning:

**Database** — Missing indexes, expensive multi-table joins, ORM N+1 query patterns, and connection pool exhaustion are the most common backend bottlenecks. Detection signals: slow query logs, high database response time in APM traces, saturation visible at relatively low concurrent-user counts.

**Network** — Cross-region service calls, oversized API payloads, too many HTTP round trips per page, and high DNS resolution latency (20–120 ms per unique hostname) accumulate into perceived slowness. Detection signals: high TTFB, long DNS and connection bands in waterfall views.

**CPU** — Computationally intensive algorithms, unparallelised processing, and hot code paths that are called on every request inflate both server response time and browser scripting time. Detection signals: APM CPU saturation graphs, long scripting tasks in Chrome DevTools Performance tab.

**Memory** — Memory leaks in application code or the JVM, heap exhaustion, and excessive garbage collection pauses degrade performance gradually rather than immediately. Soak tests are the primary mechanism for detecting memory issues; a steadily increasing memory graph over hours is the key signal. Detection signals: APM memory trend graphs, OOM errors, increasing p99 over the soak period.

**Frontend rendering** — Blocking JavaScript, unminified or oversized bundles, render-blocking CSS, too many HTTP requests per page, and uncompressed or improperly sized images inflate browser rendering time. Detection signals: Lighthouse audit scores, Chrome DevTools Performance and Network tabs, high LCP and INP, waterfall view showing long scripting and image-download bands.

APM tools (New Relic, Dynatrace, Datadog) must be active during test runs to correlate load test results with server-side behaviour. Without APM, diagnosing a failing performance test is largely guesswork. (full-stack-testing-mohan ch-08)

---

## Tools by category

### Backend load testing

- **k6** (JavaScript DSL) — Modern, developer-friendly; CI integration; scriptable in JS; suited for teams already working in JavaScript/TypeScript ecosystems.
- **JMeter** (Java, GUI + CLI) — Rich plugin ecosystem; CSV-data-driven testing; BlazeMeter cloud integration; CI-friendly `.jmx` format; step and concurrency thread groups via plugins. Reach for it when data-driven parameterisation or a visual test plan editor is needed.
- **Gatling** (Scala DSL) — Code-first; user flow recording; elegant simulation classes; CI-friendly. Well-suited to teams comfortable with JVM languages who want performance scripts reviewed alongside application code.
- **Apache Benchmark (ab)** (CLI) — Zero setup on macOS/Linux; instant percentile output. Reach for it for quick spot-checks and ad-hoc load validation during development. Not suitable for complex multi-step user flows.

### Frontend performance

- **Lighthouse** (browser-embedded + CLI) — Free; measures Core Web Vitals and additional performance metrics; CI-ready; LightWallet feature enforces score budgets to fail builds; integrates with Cypress via cypress-audit. First choice for automated frontend performance gates in CI.
- **WebPageTest** (online tool + API) — Real browsers and devices; configurable geolocation; waterfall view; first-view vs. repeat-view comparison; free public tier. Reach for it when geographic variation or device-specific rendering needs to be measured.
- **PageSpeed Insights** (online + API) — Combines Lighthouse lab data with real-user monitoring (RUM / field data) from the Chrome User Experience Report (CrUX). Useful for comparing lab test results against real-world p75 Core Web Vitals data.

(full-stack-testing-mohan ch-08)

---

## Named pitfalls

**Testing only in dev or a non-production-like environment** — Smaller machines, different geolocations, absent load balancers, and missing background batch jobs produce numbers that do not reflect production behaviour. Capacity decisions based on these numbers are unreliable. The performance environment should be provisioned at the start of the project, not retrofitted before release. (full-stack-testing-mohan ch-08)

**Relying on averages and ignoring p95/p99** — Average response time hides the long tail. A system with an 800 ms mean can have a p99 of 4 s; 1% of users at high traffic volumes is a significant absolute number. Always report p90, p95, and p99 alongside the mean. (full-stack-testing-mohan ch-08)

**No baseline for regression detection** — Without a single-user benchmark, there is no reference point for understanding why concurrent tests fail. If a single-user response time is already at 2.5 s, a 3 s target under 166 concurrent users is already lost. Run single-user benchmarks first; re-run them before every load test cycle to detect regressions introduced by code changes. (full-stack-testing-mohan ch-08)

**Ignoring frontend rendering — the 80-90% problem** — Backend performance tools measure server response time; they do not render HTML, execute JavaScript, apply CSS, or download images. Browser rendering accounts for approximately 80–90% of total page load time as perceived by the user. A 200 ms server response can still produce a 4+ second user-visible experience. Backend and frontend performance must both be measured and reported. (full-stack-testing-mohan ch-08)

**Missing think time and ramp-up** — Setting ramp-up and think time to zero produces an unrealistic thundering-herd load pattern. The system is hit by all virtual users simultaneously, yielding pessimistic results that do not reflect real user arrival patterns. Set ramp-up to at least 30 seconds for most scenarios; set think time to match realistic user behaviour (e.g., 30 s between actions for e-commerce flows). (full-stack-testing-mohan ch-08)

**Leaving performance testing to the end of the delivery cycle** — Architecture defects (chatty service interfaces, missing caching layers, poor database design) are far cheaper to address during design than after the system is built. Shift-left means lightweight performance assertions run in CI from early development, with full load and soak suites running against a stable environment before release. (full-stack-testing-mohan ch-08)

---

## Pointers

- Used by agent: qa-performance-specialist (primary)
- Used by agents: qa-cicd-evaluator, qa-test-planner, qa-orchestrator
