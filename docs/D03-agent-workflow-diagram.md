# Agent Workflow Diagram

> Visual reference for the complete Aegis agent execution pipeline.
> Rendered SVG: [D03-agent-workflow-diagram.svg](./D03-agent-workflow-diagram.svg)
> See [HANDBOOK/03](../HANDBOOK/03-architecture.md) for narrative architecture and [HANDBOOK/06](../HANDBOOK/06-agents.md) for the full agent roster.

## How to read this diagram

- Rounded rectangles `( )` = agents
- Sharp rectangles `[ ]` = file artifacts
- Diamonds `{ }` = human gates
- Subgraphs = tier / category groupings
- Arrows = data flow (labelled: writes / reads / dispatch / emits)

## Full workflow diagram

```mermaid
flowchart TD
    Start(["/qa-start"]) --> Orchestrator

    subgraph Tier0["Tier 0 — Orchestrator"]
        Orchestrator(["qa-orchestrator"])
    end

    subgraph CrossCutting["Cross-Cutting (continuous)"]
        MetricsCollector(["qa-metrics-collector<br/>tails events, writes reports/metrics/"])
        Curator(["qa-curator<br/>post Gate 3"])
    end

    subgraph Discovery["Discovery Phase (two-event barrier)"]
        Scanner(["qa-context-scanner"])
        WebExplorer(["qa-web-explorer"])
        TargetProfile["runs/{runId}/target-profile.json<br/>(+ sourceInventory)"]
        DiscoveryReport["discovery-report.json<br/>tests/pages/{url-path}/"]
    end

    subgraph Tier1["Tier 1 — Phase Agents"]
        RA(["qa-requirements-analyst"])
        Planner(["qa-test-planner"])
        Designer(["qa-test-designer"])
        EnvEng(["qa-environment-engineer"])
        Executor(["qa-test-executor"])
        DefectMgr(["qa-defect-manager"])
        ClosureRep(["qa-closure-reporter"])
        ExecRep(["qa-executive-reporter"])
    end

    subgraph Artifacts["Phase Artifacts"]
        AmbReport["requirements/ambiguity-report.json"]
        Plan["plan.json + risk-register.json"]
        Cases["cases/*.json + rtm.json"]
        PlaywrightCfg["playwright.config.ts<br/>(screenshot:always, video, trace)<br/>tests/fixtures/ + tests/factories/"]
        ExecSummary["execution-summary.json"]
        Defects["defects/*.json<br/>(scripted + EXP-type)"]
        MetricsFiles["reports/metrics/*.json"]
        ClosureFiles["reports/closure/closure.{md,json}"]
        ExecReports["reports/executive/*.pdf"]
    end

    subgraph Gates["Human Gates"]
        Gate1{{"Gate 1<br/>Plan Approval"}}
        Gate2{{"Gate 2<br/>Defect Triage"}}
        Gate3{{"Gate 3<br/>Closure Sign-off"}}
    end

    subgraph Explore["Exploratory (MCP — runs FIRST, blocks scripted)"]
        Exploratory(["qa-exploratory-specialist<br/>Playwright MCP mandatory"])
        Sandbox["sandbox/{date}-{slug}/<br/>notes + evidence (scratch)"]
        SessionNotes["reports/exploratory/<br/>{session}-notes.md"]
    end

    subgraph Scripted["Tier 2 — Scripted Specialists (≤4 parallel, Playwright CLI)"]
        UI(["qa-ui-specialist"])
        API(["qa-api-specialist"])
        Security(["qa-security-specialist"])
        Perf(["qa-performance-specialist"])
        DB(["qa-database-specialist"])
        Responsive(["qa-responsive-specialist"])
        Unit(["qa-unit-specialist"])
        A11y(["qa-accessibility-specialist"])
        Email(["qa-email-specialist"])
        Realtime(["qa-realtime-specialist"])
        FeatureFlag(["qa-feature-flag-specialist"])
    end

    subgraph Evidence["Evidence Store"]
        EvidenceTC["runs/{runId}/evidence/{TC-ID}/"]
        EvidenceDEF["runs/{runId}/evidence/{DEF-ID}/<br/>(promoted defect evidence)"]
    end

    subgraph SPVs["SPV Reviewers (one per worker)"]
        SPVnote["Each worker → work-report → SPV review.json<br/>→ dispatcher calls pipeCorrectiveInstruction()<br/>→ agent-memory/{agent}/lessons.json"]
    end

    subgraph Compliance["Compliance (parallel, if configured)"]
        Comp(["iso25010 / iso5055 / istqb<br/>cmmi / gdpr / pdpa"])
        CompReports["reports/compliance/*.{md,json}"]
    end

    %% Orchestrator start + metrics
    Orchestrator -->|dispatch at run start| MetricsCollector
    MetricsCollector -->|writes intermediate rollups| MetricsFiles

    %% Discovery (two-event barrier)
    Orchestrator -->|1. Discovery| Scanner
    Scanner -->|writes| TargetProfile
    Scanner -.->|DiscoveryStepComplete scan| Orchestrator
    TargetProfile -->|reads| WebExplorer
    WebExplorer -->|writes| DiscoveryReport
    WebExplorer -.->|DiscoveryStepComplete explore| Orchestrator

    %% Requirements
    Orchestrator -->|2. Requirements| RA
    TargetProfile -->|reads sourceInventory| RA
    DiscoveryReport -->|reads| RA
    RA -->|writes| AmbReport

    %% Planning + Gate 1
    AmbReport -->|reads| Planner
    Planner -->|writes| Plan
    Plan --> Gate1
    Gate1 -->|approved| Designer

    %% Design + Environment
    DiscoveryReport -->|reads| Designer
    TargetProfile -->|reads sourceInventory| Designer
    Designer -->|writes| Cases
    Cases -->|reads| EnvEng
    EnvEng -->|writes| PlaywrightCfg

    %% Execution: exploratory FIRST
    PlaywrightCfg -->|EnvReady| Executor
    Executor -->|1st, blocking| Exploratory
    Exploratory -->|scratch| Sandbox
    Sandbox -->|covered obs| SessionNotes
    Sandbox -->|uncovered defect| Defects
    Sandbox -->|uncovered defect evidence| EvidenceDEF
    Exploratory -.->|ExploratorySessionComplete| Executor

    %% Execution: scripted specialists
    Executor -->|2nd, after exploratory| UI
    Executor --> API
    Executor --> Security
    Executor --> Perf
    Executor --> DB
    Executor --> Responsive
    Executor --> Unit
    Executor --> A11y
    Executor --> Email
    Executor --> Realtime
    Executor --> FeatureFlag
    UI -->|writes| EvidenceTC
    API -->|writes| EvidenceTC
    Security -->|writes| EvidenceTC
    Perf -->|writes| EvidenceTC
    DB -->|writes| EvidenceTC
    Responsive -->|writes| EvidenceTC
    Unit -->|coverage| MetricsFiles
    A11y -->|writes| EvidenceTC
    Executor -->|aggregates| ExecSummary

    %% Defect triage + Gate 2 + compliance
    ExecSummary -->|reads| DefectMgr
    Defects -->|reads pre-existing EXP| DefectMgr
    EvidenceTC -->|reads| DefectMgr
    DefectMgr -->|writes/updates| Defects
    Defects --> Gate2
    Gate2 -->|approved| ClosureRep
    Gate2 -->|if configured| Comp
    Comp -->|writes| CompReports

    %% Closure + Gate 3
    MetricsFiles -->|reads| ClosureRep
    Defects -->|reads| ClosureRep
    CompReports -->|reads| ClosureRep
    ClosureRep -->|writes| ClosureFiles
    ClosureFiles --> Gate3

    %% Executive reporting + curator
    Gate3 -->|approved| ExecRep
    ClosureFiles -->|reads| ExecRep
    ExecRep -->|invokes _qa-report-* skills| ExecReports
    ExecReports --> Curator
    Curator -->|proposes| Promotions["pending-promotions/"]

    %% SPV loop (applies to every worker)
    RA -.-> SPVs
    Planner -.-> SPVs
    Designer -.-> SPVs
    EnvEng -.-> SPVs
    Executor -.-> SPVs
    DefectMgr -.-> SPVs
    ClosureRep -.-> SPVs
    ExecRep -.-> SPVs
    UI -.-> SPVs
    Exploratory -.-> SPVs
```

## Key flows explained

1. **Discovery** (two-event barrier): `qa-context-scanner` writes `target-profile.json` (incl. `sourceInventory`) and emits `DiscoveryStepComplete {scan}`; `qa-web-explorer` then writes `discovery-report.json` and emits `DiscoveryStepComplete {explore}`. The orchestrator advances only when **both** events are present (`Promise.all([scan, explore])`).
2. **Planning chain**: `qa-requirements-analyst` (source-grounded against `sourceInventory`) → `qa-test-planner` → **Gate 1** → `qa-test-designer` → `qa-environment-engineer` (writes `playwright.config.ts` with `screenshot:'always'` / `video` / `trace`).
3. **Execution order**: `qa-test-executor` runs `qa-exploratory-specialist` FIRST (Playwright MCP, blocking) → then scripted specialists (Playwright CLI, ≤4 parallel). Exploratory findings feed the scripted briefs.
4. **Sandbox flow**: exploratory scratch → `sandbox/{date}-{slug}/`. At session end: covered observations → `reports/exploratory/`; uncovered defects → `runs/{runId}/defects/` + `runs/{runId}/evidence/{DEF-ID}/`; then `completeSandbox()` deletes the sandbox.
5. **Closure**: `qa-defect-manager` (triages scripted + EXP-type defects) → **Gate 2** → compliance (parallel) + `qa-closure-reporter` (reads `reports/metrics/`, writes `reports/closure/closure.{md,json}`) → **Gate 3** → `qa-executive-reporter` (PDFs in `reports/executive/`).
6. **SPV loop**: every worker writes a work-report; its dispatcher (orchestrator for Tier-1, test-executor for Tier-2) dispatches the paired SPV, reads the verdict, and calls `pipeCorrectiveInstruction()` to append a lesson on any non-pass verdict. SPVs are read-only and cannot write lessons themselves.
7. **Metrics**: `qa-metrics-collector` is dispatched at run start, tails `events.jsonl`, and writes intermediate rollups to `reports/metrics/` on every phase completion — so closure-reporter can read them with no finalize-wait.
8. **Self-improvement**: `qa-curator` runs after Gate 3 and writes proposals to `pending-promotions/`.

## Regenerating the SVG

```bash
npx @mermaid-js/mermaid-cli mmdc \
  -i docs/D03-agent-workflow-diagram.md \
  -o docs/D03-agent-workflow-diagram.svg
# or:
pnpm diagram
```

## See also

- [HANDBOOK/03-architecture.md](../HANDBOOK/03-architecture.md)
- [HANDBOOK/04-stlc-walkthrough.md](../HANDBOOK/04-stlc-walkthrough.md)
- [HANDBOOK/06-agents.md](../HANDBOOK/06-agents.md)
- [docs/D13-spv-review-pattern.md](./D13-spv-review-pattern.md)
