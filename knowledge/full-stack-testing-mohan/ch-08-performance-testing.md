---
book: full-stack-testing-mohan
chapter: 8
title: "Performance Testing"
pages: "362-427"
topics:
  - performance-testing
  - load-testing
  - stress-testing
  - spike-testing
  - soak-testing
  - volume-testing
  - scalability-testing
  - percentiles
  - p95
  - p99
  - core-web-vitals
  - lcp
  - inp
  - cls
  - lighthouse
  - bottleneck-analysis
  - profiling
  - full-stack-testing
  - observability
  - shift-left
applies_to_agents:
  - qa-performance-specialist
  - qa-frontend-specialist
  - qa-strategy-advisor
  - qa-tooling-advisor
  - qa-devops-specialist
---

# Chapter 8 — Performance Testing

> _Performance is not an afterthought. Slow applications lose customers, damage brand reputation, and cost businesses millions. This chapter establishes a full-stack performance testing strategy that spans backend load simulation, frontend rendering metrics, and shift-left integration into CI pipelines. It walks through defining KPIs from business data, selecting and designing the right test types, scripting tests with JMeter/Gatling/ab, measuring Core Web Vitals with Lighthouse and WebPageTest, and building a production-like test environment. The unifying principle is that performance testing must start early, run continuously, and cover both server and browser behavior._

---

## Core Concepts

### Why Performance Matters

- Page load time directly correlates with bounce rate: a 1–3 second delay increases bounce probability by 32%; 1–10 seconds increases it by 123%.
- Google's SEO algorithms demote slower websites, compounding the business impact.
- Real-world cost examples illustrate the stakes: a 2018 Prime Day outage cost Amazon an estimated $72–99 million; conversely, a 0.3 s reduction in page load time brought Trainline an extra £8 million per year in revenue.
- Every 100 ms shaved from a home page load translated to ~$380,000 in annual revenue uplift for Mobify.
- From a human-perception standpoint: under 0.1 s feels instantaneous; 0.2–1 s feels slightly delayed but controlled; beyond 3 s the majority of users will abandon the page.

### What Performance Means

Performance is the ability of an application to serve large numbers of concurrent users without degradation beyond what end users consider acceptable. It is not simply "the server responds fast" — it includes the full round-trip experience the user perceives in their browser.

### Factors Affecting Application Performance

Each of the following can introduce or magnify bottlenecks:

1. **Architecture design** — Poorly compartmented service responsibilities force the UI to make numerous downstream calls; missing caching layers compound latency.
2. **Tech stack choice** — Language runtime characteristics (e.g., JVM cold-start vs. Go startup time) affect latency, especially in serverless contexts like AWS Lambda.
3. **Code complexity** — Inefficient algorithms, long synchronous operations, redundant validations, and failure to validate inputs early (e.g., allowing an empty-string search to hit the database) all inflate response times.
4. **Database design** — Inappropriate database type, poor data modelling (e.g., purchase order split across many tables requiring expensive joins), and missing indexes degrade read performance.
5. **Network latency** — Internal service-to-service communication and external user-facing connectivity both matter. End users on 2G/3G/4G networks cannot be controlled, but design choices (payload size, number of HTTP round trips) can mitigate the impact.
6. **Geolocation** — Hosting far from the user's region adds network hops and latency. CDNs and cloud region selection directly address this; a common mistake is choosing infrastructure closer to the development team rather than the target user base.
7. **Infrastructure** — CPU count, memory, OS tuning, and load balancer configuration cap the maximum throughput before the system saturates.
8. **Third-party integrations** — External dependencies (vendor product systems, warehouse management, payment gateways) can introduce unpredictable latency that aggregates into the application's perceived response time.

---

## Key Performance Indicators (KPIs)

Three primary KPIs are tracked in performance testing:

| KPI | Description | Typical Target |
|---|---|---|
| **Response time** | End-to-end time from user request to fully loaded response visible to the user; includes API time AND browser rendering time | Under 3 s for web apps |
| **Concurrency / Throughput** | Concurrency = simultaneous users the system supports within acceptable limits; Throughput = requests processed per unit time (preferred system-side metric) | Application-specific; derived from traffic projections |
| **Availability** | Sustained ability to respond within acceptable limits over an extended continuous period (hours/days), not just a burst window | 24/7 minus planned maintenance; memory leaks and background jobs can erode this over time |

> Throughput is the more precise system-side metric; think of lanes on a bridge — 30–40 cars crossing per second is throughput, not the number of cars waiting at the on-ramp.

---

## Types of Performance Tests

### Load / Volume Tests

Simulate the expected peak concurrent user count and validate that response time stays within the agreed threshold. For example: confirm that the `/books` endpoint responds within 3 seconds for 166 simultaneous users. Run multiple iterations to average results and establish a benchmark.

### Stress Tests

Incrementally increase load beyond the expected peak — in small steps — to find the precise breaking point at which the system begins returning errors. The breaking-point number is used for infrastructure capacity planning, especially when scaling to new regions or preparing for sales events (e.g., Black Friday). The system should degrade gracefully, not catastrophically.

### Soak Tests

Hold the application under constant, expected-level load for an extended period (hours or days) to detect slow degradation caused by memory leaks, resource exhaustion from background batch jobs, connection pool depletion, or other time-dependent issues. A system may pass a 5-minute load test but fail a 12-hour soak test.

### Spike Tests

A rapid, sudden surge of load — not a gradual ramp-up — to determine how the system behaves when an unexpected burst of traffic arrives (e.g., a viral social-media mention, a flash sale announcement). The chapter does not detail this type as a named category but its characteristics emerge from the load pattern descriptions.

### Volume Tests

Synonym for load tests in this book's terminology; validates that the system handles the expected data and concurrent-user volume within response-time thresholds.

### Scalability Tests

Implicit in the stress and step-ramp-up exercises: measuring how response time and throughput change as load increases, to determine whether scaling (horizontal or vertical) is linear, sub-linear, or hits a hard ceiling. Used to plan cloud infrastructure provisioning ahead of capacity events.

---

## Load Pattern Design

Four parameters shape every load pattern:

- **Ramp-up time** — The duration over which virtual users are brought online. A realistic ramp-up (e.g., 100 users over 1 minute) avoids the thundering-herd anti-pattern where everyone connects simultaneously.
- **Think time** — The pause between individual user actions within a session. Real users take seconds or minutes between a search and a purchase; omitting think time makes the load unrealistically dense.
- **Pacing** — The interval between complete transactions (not individual actions). Controls the aggregate transaction rate over a period; e.g., spreading 1,000 transactions evenly across a peak hour.
- **Concurrent users** — The number of parallel virtual users active at any moment.

### Three Common Patterns

| Pattern | Shape | Use Case |
|---|---|---|
| **Steady ramp-up** | Gradual linear increase, sustained plateau, then ramp-down | Simulates Black Friday-style events where users arrive and stay |
| **Step ramp-up** | Load added in discrete batches (e.g., +100 users every 2 minutes) | Benchmarking at each step; capacity planning |
| **Peak-rest** | Repeated cycles of spike to peak then drop to zero | Social networks, news sites with periodic traffic bursts |

---

## Performance Testing Steps (Six-Step Process)

### Step 1: Define Target KPIs

Start qualitatively, then derive numbers from data:
- If an existing application exists, mine production traffic logs.
- If building new, use competitor benchmarks or regional internet usage statistics.
- Beware business-stated numbers that are aspirational rather than data-backed.

**Sample KPI derivation for a library application:**
- 100,000 expected users in year 1, accessing twice per month = 200,000 monthly sessions.
- Divided across 30 days and 12 active hours per day, with a 10-minute average session = ~166 concurrent users at peak.
- 5 requests per session × 1,000 peak hourly users = 5,000 requests per hour throughput requirement.
- Resulting KPIs: respond within 3 s for 166 concurrent users; sustain 5,000 requests/hour.

### Step 2: Define Test Cases

Cover the critical user journeys. For the library application, this included:
- Benchmarking all four endpoints (addBook, deleteBooks, viewBookById, books) with a single user.
- Volume testing customer-facing endpoints at 166–200 concurrent users.
- Stress testing with ramp-up steps of 100 users.
- Throughput validation: 45 users running a 5-request flow for 1 hour with 30 s think time between actions.
- Soak test: 12 continuous hours at expected load.

Unlike functional tests, a complete performance test suite may only need a handful of well-designed scenarios.

### Step 3: Prepare the Performance Testing Environment

The environment must mirror production as closely as possible:
- Same machine configuration (CPU count, memory, OS version).
- Same geolocation in the cloud as the production region.
- Same network bandwidth between tiers.
- Same application configurations (rate limiting, connection pool sizes).
- Background batch jobs and email systems in place.
- Load balancers configured identically.
- Third-party services mocked if unavailable.

Set up the performance environment alongside the QA environment at the project's start — retrofitting it later is expensive and error-prone. Provision a separate test-runner machine and, for global applications, test runners in multiple geolocations.

### Step 4: Prepare Test Data

Data quality directly affects the accuracy of performance numbers:
- Estimate the production database size and script data population (and cleanup) scripts.
- Use realistic values (not "Shirt1", "Shirt2") that reflect actual content complexity.
- Include erroneous and edge-case values (blank fields, misspellings) representing real user inputs.
- Match demographic distribution (age, country) of real users.
- For volume tests with concurrent users, generate sufficient unique records (unique credentials, credit card numbers, etc.) to avoid collisions.

### Step 5: Integrate APM Tools

Connect application performance monitoring tools (New Relic, Dynatrace, Datadog) before running tests. APM tools expose server-side behaviour during test runs — memory consumption, slow database queries, thread contention — enabling fast bottleneck diagnosis when test runs reveal degradation.

### Step 6: Script and Run Tests

Select the appropriate tool, script the test cases, run against the prepared environment, collect reports, then tune and re-run. The loop of run → diagnose → fix → tune is the full performance cycle; discovering an issue is only halfway done.

---

## Techniques / Templates

### Realistic Load Design

- Do not set ramp-up time to zero unless specifically testing thundering-herd scenarios.
- Set think time to at least 30 s between user actions for e-commerce flows; longer for research-heavy sessions.
- Configure pacing to spread transactions across the full measurement window rather than front-loading them.

### Benchmarking

Run a single user in a loop (e.g., 10 iterations) before any concurrent testing to establish the best-case baseline. If single-user response time is already unacceptable, there is no point scaling up the load.

### Percentile-Based Assertions

Do not rely on averages alone; they hide the long tail:
- **p50 (median)** — 50% of requests complete within this time.
- **p90** — 90% of requests complete within this time; a common SLO threshold.
- **p95** — 95% of requests complete within this time; reveals near-worst-case behaviour.
- **p99** — 99% of requests complete within this time; catches outliers that average metrics mask entirely.
- **p100 (max)** — The single slowest request; useful for identifying extreme outliers.

In the Apache Benchmark example from the chapter, with 200 concurrent users hitting the `/books` endpoint: p50 = 3,370 ms, p90 = 3,863 ms, p95 = 3,889 ms, p99 = 4,022 ms, p100 = 4,027 ms. The near-flat p90–p100 spread indicates the system hit a saturation ceiling.

### Data-Driven Performance Testing (JMeter)

Use JMeter's CSV Data Set Config element to feed unique test data per virtual user, avoiding data collisions in volume tests. Reference variables in HTTP request bodies as `${variable_name}`. This enables the generation of pre-test data (e.g., adding 50 books before a read-heavy volume test) within the same JMeter test plan.

### Integrating Performance Tests into CI

Run performance tests as a dedicated CI job in isolation:
- JMeter: `jmeter -n -t <test.jmx> -l <log_file> -e -o <output_folder>`
- Lighthouse CLI: `lighthouse https://example.com/ --only-categories=performance`
- Set threshold assertions (e.g., fail the build if Lighthouse performance score falls below 90) using the LightWallet feature.
- Use the cypress-audit library to run Lighthouse audits inside Cypress functional test runs for combined coverage.

---

## Tools

### Backend Performance Testing Tools

| Tool | Language / Interface | Key Strengths |
|---|---|---|
| **JMeter** | Java, GUI + CLI | Rich plugin ecosystem; CSV data-driven testing; BlazeMeter cloud integration; CI-friendly `.jmx` format; step and concurrency thread groups via plugins |
| **Gatling** | Scala DSL | Code-first; user flow recording; elegant simulation classes; CI-friendly |
| **Apache Benchmark (ab)** | CLI | Zero setup on macOS; instant percentile output; useful for quick spot-checks |
| **BlazeMeter** | Cloud, commercial | Managed infrastructure for JMeter tests; analytics dashboard |
| **NeoLoad** | Commercial | Enterprise load testing with GUI configuration |
| **k6** | JavaScript DSL | Modern, developer-friendly; CI integration; scriptable in JS |

### Frontend Performance Testing Tools

| Tool | Type | Key Strengths |
|---|---|---|
| **Lighthouse** | Browser-embedded + CLI | Free; measures Core Web Vitals; CI-ready; LightWallet for budget enforcement; integrates with Cypress via cypress-audit |
| **WebPageTest** | Online tool + API | Real browsers and devices; configurable geolocation; waterfall view; first vs. repeat view comparison; free public tier |
| **PageSpeed Insights** | Online tool + API | Combines Lighthouse lab data with real-user monitoring (RUM / field data) from Chrome User Experience Report (CrUX) |
| **Chrome DevTools Performance Profiler** | Browser-embedded | Frame-rate analysis; memory profiling; scripting timeline; network/CPU throttling; developer-facing debugging |

### APM / Observability Tools

| Tool | Purpose |
|---|---|
| **New Relic** | Application performance monitoring during test runs and production |
| **Dynatrace** | Deep observability; AI-assisted root cause analysis |
| **Datadog** | Metrics, traces, and logs aggregation; alerting |

---

## Frontend Performance: A Separate but Equal Concern

### The 80–90% Problem

Backend performance tools measure server response time. They do not render HTML, execute JavaScript, apply CSS, or download images. Browser rendering accounts for an estimated 80–90% of total page load time as perceived by the user. A server that responds in 200 ms can still produce a page that takes 3+ seconds to become interactive.

For example, the CNN home page requires ~90 browser tasks before the page appears. Server-side optimisation alone cannot address this.

### RAIL Model

Google's RAIL model frames frontend performance around four areas of user perception:

| Dimension | Goal | Rationale |
|---|---|---|
| **Response** | Input latency under 100 ms | Users perceive any longer gap as lag after clicking a button or control |
| **Animation** | Each frame within 16 ms | Achieves 60 FPS; slower frame rates produce visible jank |
| **Idle** | Non-critical work bundled into ~50 ms blocks | Ensures the browser can respond to user interaction within the 100 ms window |
| **Load** | First render within 1 s | Users feel in control of navigation only when the page begins appearing within 1 second |

### Core Web Vitals (Google's Official Subset)

Google designates three metrics as **Core Web Vitals**, which are incorporated into its SEO ranking signals:

| Metric | Abbreviation | What It Measures | Good Threshold |
|---|---|---|---|
| **Largest Contentful Paint** | LCP | Time for the largest visible content element (hero image, large text block) to render | Under 2.5 s |
| **Interaction to Next Paint** | INP | Latency of page responsiveness to all user interactions throughout the session (replaces First Input Delay) | Under 200 ms |
| **Cumulative Layout Shift** | CLS | Visual instability — how much page content unexpectedly moves as the page loads | Under 0.1 |

> Note: The chapter uses the earlier Core Web Vitals definition that includes First Input Delay (FID) rather than INP. INP replaced FID as an official Core Web Vital in March 2024 (after this book's publication). Both measure interaction responsiveness; INP is broader.

### Additional Frontend Performance Metrics

| Metric | Description |
|---|---|
| **First Contentful Paint (FCP)** | Time until the browser renders any DOM content (image, text, SVG) — indicates the user sees something happening |
| **Time to Interactive (TTI)** | When the page is fully interactive and responds reliably to user input |
| **First Input Delay (FID)** | Delay between the user's first interaction and the browser's response, measured during the loading phase |
| **Max Potential First Input Delay** | Worst-case FID — duration of the longest browser task between FCP and TTI |

### Factors Affecting Frontend Performance

- **JavaScript bundle size and minification** — Unminified scripts or large bundles delay rendering.
- **Number of HTTP requests per page** — Each request adds network round-trip latency; reducing requests (bundling, sprites, lazy loading) improves performance.
- **CDN usage and proximity** — Static assets served from a geographically close CDN node reduce latency for first-time loads.
- **DNS resolution time** — 20–120 ms per unique hostname; browsers and ISPs cache resolved addresses, making repeat visits faster.
- **Network bandwidth and type** — Mobile (3G/4G) bandwidth varies widely across regions; design for the worst common case for your target audience.
- **Browser caching** — Intentional cache headers for static assets dramatically reduce repeat-visit load times.
- **Data transfer volume** — Unnecessarily large payloads (uncompressed images, over-fetching API responses) inflate load times.

---

## Examples

### JMeter: Benchmarking a Single Endpoint

Thread Group: 1 thread, ramp-up 0 s, loop count 10. HTTP Request sampler pointing to `/books`. Aggregate Report listener shows average, median, throughput, min, max. In the chapter's example, the single-user benchmark for `/books` averaged 379 ms — the best-case response time with no concurrent load.

### JMeter: Volume Test with 166 Concurrent Users

Three equivalent approaches:
1. Simple Thread Group: 166 threads, ramp-up 0 s, loop count 5.
2. Concurrency Thread Group (plugin): target concurrency 166, ramp-up 30 s, hold 2 minutes.
3. Ultimate Thread Group (plugin): 166 threads, 10 s startup, hold 60 s, 10 s shutdown.

Result (simple thread group, 166 users, loop 5): average = 801 ms, p90 = 1,499 ms. Ninety percent of 166 concurrent users received a response within ~1.5 s.

### Apache Benchmark: Quick Load Test

```
ab -n 200 -c 200 https://library.herokuapp.com/books
```

Output highlights: requests per second = 38.33; p50 = 3,370 ms; p90 = 3,863 ms; p95 = 3,889 ms; p99 = 4,022 ms; max = 4,027 ms. The narrow p90–p100 spread signals saturation — the system is at or near its ceiling.

### Gatling: Scala DSL Load Script

```scala
class BasicSimulation extends Simulation {
  val httpProtocol = http.baseUrl("https://library.herokuapp.com/")
  val scn = scenario("BasicSimulation")
    .exec(http("request_1").get("/books"))
    .pause(5) // 5-second think time
  setUp(scn.inject(atOnceUsers(166))).protocols(httpProtocol)
}
```

The `pause(5)` call inserts 5 seconds of think time between virtual user requests, producing more realistic load.

### Lighthouse: Frontend Performance Audit

Run from CLI:
```
npm install -g lighthouse
lighthouse https://www.example.com/ --only-categories=performance
```

Optional throttling and device parameters simulate specific user conditions. In the chapter's example (Amazon, Samsung Galaxy S5 emulation, Slow 3G): Time to Interactive = 3.8 s, demonstrating that even a highly optimised site faces significant rendering time under constrained conditions.

### WebPageTest: Geolocation-Aware Frontend Test

Configure: URL, geolocation (e.g., Milan), browser, device (Samsung Galaxy S5), network (4G), number of runs (3), first view and repeat view. Results from the chapter showed Amazon's first-view LCP at 2.105 s and document complete at 3.134 s — within acceptable limits. Waterfall view exposes DNS, connection, HTML download, image download, and script execution times as individual timeline bands.

---

## Pitfalls / Anti-Patterns

### Testing in a Non-Production-Like Environment

Running performance tests against a dev or QA environment with smaller machines, different geolocations, or absent load balancers produces numbers that do not reflect production behaviour. Stakeholders may make capacity decisions based on inaccurate data.

### No Baseline

Without a single-user benchmark, there is no reference point. If the `/books` endpoint takes 1 s for a single user, expecting 166 concurrent users to stay under 3 s is plausible. If it already takes 2.5 s for a single user, the load test will predictably fail — but no one will understand why without the baseline.

### Relying on Averages Alone and Ignoring p95/p99

Average response time hides the long tail. A system with an average of 800 ms can have a p99 of 4 s, meaning 1 in 100 users waits four times longer than the average suggests. For high-traffic sites, 1% of users represents a large absolute number. Always report p90, p95, and p99 alongside the mean.

### Missing Think Time and Ramp-Up

Setting ramp-up to zero and think time to zero produces an unrealistically bursty load pattern. The system is subjected to a thundering herd that never occurs in production, yielding pessimistic results. Conversely, it can mask real-world issues that only emerge under sustained (rather than instantaneous) load.

### Treating Backend Metrics as the Full Performance Story

A 200 ms backend response time can still result in a 4+ second user-visible page load. Frontend rendering accounts for 80–90% of perceived load time. Backend and frontend performance must both be measured and optimised.

### Load Testing Public APIs

High-volume load tests against shared or public APIs constitute denial-of-service behaviour. Always test against a controlled environment, a WireMock stub, or a designated testing endpoint provided by the tool vendor.

### Leaving Performance Testing to the End

Late-stage performance discovery is expensive. Issues in architecture (e.g., chatty service interfaces, missing caching layers) cannot be corrected cheaply once the system is built. Shift-left means integrating performance assertions into CI from early development, not just before release.

### Poorly Prepared Test Data

Synthetic data with unrealistic values (short strings, uniform entries) does not stress the database query planner, indexing, or serialisation the way real data does. Performance numbers based on poor test data are not representative.

### Accepting Performance Numbers Without Stakeholder Alignment

Business stakeholders often state aspirational concurrency targets. Always derive KPIs from actual data (traffic logs, competitor benchmarks, internet usage statistics) and get explicit sign-off on the target numbers before designing and running tests.

---

## Bottleneck Analysis

### Bottleneck Layers

When performance degradation is identified, root-cause analysis must span the full stack:

| Layer | Common Causes | Detection Signals |
|---|---|---|
| **Database** | Missing indexes, expensive joins, ORM N+1 queries, connection pool exhaustion, large dataset scans | Slow query logs, APM database traces, long DB response time in waterfall |
| **Network** | High latency between services, cross-region calls, oversized payloads, too many round trips | Network waterfall timing, high Time to First Byte (TTFB), DNS resolution time |
| **CPU** | Computationally intensive code, inefficient algorithms, unparallelised work | APM CPU graphs, high CPU saturation at load, slow TTI in browser profiler |
| **Memory** | Memory leaks (application or JVM), heap exhaustion, excessive garbage collection pauses | APM memory graphs showing upward trend over soak test duration; OOM errors |
| **Frontend rendering** | Blocking JavaScript, unminified bundles, render-blocking CSS, too many HTTP requests, large images | Lighthouse audit, Chrome DevTools Performance tab, waterfall view, CLS/LCP scores |

### Observability During Tests

APM tools (New Relic, Dynatrace, Datadog) must be active during test runs to provide:
- Real-time CPU and memory graphs per instance.
- Database query execution plans and slow query identification.
- Distributed traces linking a slow user request to the specific service and code path.
- Thread pool and connection pool utilisation.

Without APM, debugging a failing performance test is largely guesswork.

---

## Performance Testing Strategy (Shift-Left)

A shift-left strategy means performance is not a gate at the end of a release — it is woven into the development lifecycle:

1. **Architecture phase** — Validate that the proposed architecture can theoretically support the target KPIs before a line of code is written. Consider caching strategy, service decomposition, and database design for performance early.
2. **Development phase** — Developers run Lighthouse and Chrome DevTools locally on individual pages and components. Micro-benchmarks for algorithmic hot paths are written alongside unit tests.
3. **CI pipeline** — Lightweight performance assertions run on every pull request or daily build: Lighthouse score thresholds, single-user API response time checks. More expensive load tests run on a scheduled cadence (e.g., nightly or weekly) against a stable performance environment.
4. **Pre-release** — Full suite of load, stress, and soak tests run against a production-like environment. Results are reviewed against the agreed KPIs before release approval.
5. **Post-release / production monitoring** — RUM data collected via PageSpeed Insights / Chrome User Experience Report (CrUX), APM tools in production, and alerting on SLO breaches ensure performance is continuously observed.

The guiding principle: the earlier a performance problem is found, the cheaper it is to fix. Discovering a caching architecture deficiency during load testing a week before launch is orders of magnitude more expensive than catching it during an architecture review.

---

## Cross-Refs

- `[[foreword]]` — Context on the full-stack testing philosophy underpinning the shift-left principle applied throughout this chapter.
- `[[ch-01-introduction-to-full-stack-testing]]` — Introduction to the testing quadrants and CFR (cross-functional requirement) placement of performance testing.
- `[[ch-02-manual-exploratory-testing]]` — Exploratory sessions can surface perceived-performance issues before formal testing.
- `[[ch-03-automated-functional-testing]]` — Backend API structures referenced in performance test scenarios (REST endpoints, WireMock stubs); retail integration patterns mentioned in third-party performance considerations.
- `[[ch-04-continuous-testing]]` — CI pipeline integration strategy that performance tests slot into; shift-left principle applied to the overall pipeline.
- `[[ch-05-data-testing]]` — Database types, data quality, and database design factors that directly affect backend performance; test data preparation patterns.
- `[[ch-06-visual-testing]]` — Browser rendering model (HTML/CSS/JS execution sequence) foundational to understanding why frontend rendering accounts for 80–90% of page load time; global mobile usage data informing frontend test-case demographics.
- `[[ch-07-security-testing]]` — Security testing shares the same shift-left CI integration model; Lighthouse also audits security alongside performance.
- `[[ch-09-accessibility-testing]]` — Lighthouse audits accessibility and performance simultaneously; overlapping tooling and CI integration patterns.
- `[[ch-10-cross-functional-requirements-testing]]` — Performance is a cross-functional requirement (CFR); this chapter provides the detailed implementation of performance CFR testing.
- `[[ch-11-mobile-testing]]` — Mobile network bandwidth constraints and device CPU/memory limitations directly affect frontend performance test-case design (RAIL model, Core Web Vitals under throttled conditions).
- `[[ch-12-moving-beyond-first-principles]]` — Evolving performance practices and tooling as applications mature.
- `[[ch-13-introduction-to-testing-in-emerging-technologies]]` — Performance characteristics of emerging architectures (serverless, microservices) referenced in cold-start latency examples.
