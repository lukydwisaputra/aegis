import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// aegis root = apps/dashboard-api/src/../../../ = aegis/
const AEGIS_ROOT = resolve(__dirname, "../../..");
const RUNS_ROOT = resolve(AEGIS_ROOT, "runs");

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: "*" });

// Serve evidence files (screenshots, videos, logs, HAR) from any run directory.
// The wildcard captures everything after /api/evidence/:runId/
if (existsSync(RUNS_ROOT)) {
  await app.register(fastifyStatic, {
    root: RUNS_ROOT,
    prefix: "/api/evidence/",
    decorateReply: false,
  });
}

// ─── Health ─────────────────────────────────────────────────────────────────
app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

// ─── Runs ────────────────────────────────────────────────────────────────────
app.get("/api/runs", async (_req, reply) => {
  if (!existsSync(RUNS_ROOT)) return reply.send([]);
  const dirs = readdirSync(RUNS_ROOT).filter((d) =>
    statSync(resolve(RUNS_ROOT, d)).isDirectory()
  );
  const runs = dirs.map((runId) => {
    const closurePath = resolve(RUNS_ROOT, runId, "reports", "closure.json");
    const eventsPath = resolve(RUNS_ROOT, runId, "events.jsonl");
    const closure = existsSync(closurePath)
      ? JSON.parse(readFileSync(closurePath, "utf-8"))
      : null;
    return {
      runId,
      status: closure ? "complete" : existsSync(eventsPath) ? "in-progress" : "unknown",
      generatedAt: closure?.generatedAt ?? null,
      passRate: closure?.metrics?.passRate ?? null,
    };
  });
  return reply.send(runs.sort((a, b) => (b.runId > a.runId ? 1 : -1)));
});

app.get("/api/runs/:runId", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const runDir = resolve(RUNS_ROOT, runId);
  if (!existsSync(runDir)) return reply.code(404).send({ error: "Run not found" });

  const reports: Record<string, unknown> = {};
  const reportDir = resolve(runDir, "reports");
  if (existsSync(reportDir)) {
    for (const file of readdirSync(reportDir)) {
      if (file.endsWith(".json")) {
        const key = file.replace(".json", "");
        try {
          reports[key] = JSON.parse(readFileSync(resolve(reportDir, file), "utf-8"));
        } catch { /* skip malformed */ }
      }
    }
  }
  return reply.send({ runId, reports });
});

// ─── Events SSE stream ───────────────────────────────────────────────────────
app.get("/api/runs/:runId/events", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const eventsPath = resolve(RUNS_ROOT, runId, "events.jsonl");

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send all existing events
  if (existsSync(eventsPath)) {
    const lines = readFileSync(eventsPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      reply.raw.write(`data: ${line}\n\n`);
    }
  }

  // Watch for new events by polling file growth
  let lastSize = existsSync(eventsPath) ? statSync(eventsPath).size : 0;
  const interval = setInterval(() => {
    if (!existsSync(eventsPath)) return;
    const size = statSync(eventsPath).size;
    if (size <= lastSize) return;
    const fd = openSync(eventsPath, "r");
    const buf = Buffer.alloc(size - lastSize);
    readSync(fd, buf, 0, buf.length, lastSize);
    closeSync(fd);
    lastSize = size;
    const newLines = buf.toString("utf-8").split("\n").filter(Boolean);
    for (const line of newLines) {
      reply.raw.write(`data: ${line}\n\n`);
    }
  }, 500);

  req.raw.on("close", () => clearInterval(interval));
});

// ─── Defects CRUD ─────────────────────────────────────────────────────────────
app.get("/api/defects", async (req, reply) => {
  const { runId } = req.query as { runId?: string };
  const defects: unknown[] = [];

  const scanRun = (rid: string) => {
    const defectsDir = resolve(RUNS_ROOT, rid, "defects");
    if (!existsSync(defectsDir)) return;
    for (const file of readdirSync(defectsDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        defects.push(JSON.parse(readFileSync(resolve(defectsDir, file), "utf-8")));
      } catch { /* skip */ }
    }
  };

  if (runId) {
    scanRun(runId);
  } else {
    if (existsSync(RUNS_ROOT)) {
      for (const dir of readdirSync(RUNS_ROOT)) {
        if (statSync(resolve(RUNS_ROOT, dir)).isDirectory()) scanRun(dir);
      }
    }
  }
  return reply.send(defects);
});

// ─── Single defect (with full evidence) ──────────────────────────────────────
app.get("/api/defects/:defectId", async (req, reply) => {
  const { defectId } = req.params as { defectId: string };
  if (!existsSync(RUNS_ROOT)) return reply.code(404).send({ error: "No runs found" });

  for (const dir of readdirSync(RUNS_ROOT)) {
    if (!statSync(resolve(RUNS_ROOT, dir)).isDirectory()) continue;
    const filePath = resolve(RUNS_ROOT, dir, "defects", `${defectId}.json`);
    if (existsSync(filePath)) {
      try {
        const defect = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
        // Resolve evidence screenshot paths to API URLs the browser can fetch
        const evidence = defect["evidence"] as Record<string, string[]> | undefined;
        if (evidence?.["screenshots"]) {
          evidence["screenshots"] = evidence["screenshots"].map(
            (p) => `/api/evidence/${dir}/${p.replace(/^evidence\//, "evidence/")}`
          );
        }
        return reply.send({ ...defect, runId: dir });
      } catch {
        return reply.code(500).send({ error: "Malformed defect file" });
      }
    }
  }
  return reply.code(404).send({ error: "Defect not found" });
});

// ─── Test cases ───────────────────────────────────────────────────────────────
app.get("/api/cases", async (req, reply) => {
  const { runId } = req.query as { runId?: string };
  const cases: unknown[] = [];

  const scanRun = (rid: string) => {
    const casesDir = resolve(RUNS_ROOT, rid, "cases");
    if (!existsSync(casesDir)) return;
    for (const file of readdirSync(casesDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        cases.push(JSON.parse(readFileSync(resolve(casesDir, file), "utf-8")));
      } catch { /* skip */ }
    }
  };

  if (runId) scanRun(runId);
  else if (existsSync(RUNS_ROOT)) {
    for (const d of readdirSync(RUNS_ROOT)) {
      if (statSync(resolve(RUNS_ROOT, d)).isDirectory()) scanRun(d);
    }
  }
  return reply.send(cases);
});

// ─── Gate check ───────────────────────────────────────────────────────────────
app.get("/api/gates/:stage", async (req, reply) => {
  const { stage } = req.params as { stage: string };
  const { runId } = req.query as { runId?: string };
  if (!runId) return reply.code(400).send({ error: "runId query param required" });
  const gatePath = resolve(RUNS_ROOT, runId, "reports", `gate-${stage}.json`);
  if (!existsSync(gatePath)) return reply.code(404).send({ error: "Gate result not found" });
  return reply.send(JSON.parse(readFileSync(gatePath, "utf-8")));
});

// ─── Settings ────────────────────────────────────────────────────────────────
app.get("/api/settings", async (_req, reply) => {
  const configPath = resolve(AEGIS_ROOT, "aegis.config.json");
  if (!existsSync(configPath)) return reply.code(404).send({ error: "Config not found" });
  return reply.send(JSON.parse(readFileSync(configPath, "utf-8")));
});

// ─── Curator promotions ───────────────────────────────────────────────────────
app.get("/api/promotions", async (req, reply) => {
  const { runId } = req.query as { runId?: string };
  const promotions: unknown[] = [];

  const scanRun = (rid: string) => {
    const promoDir = resolve(RUNS_ROOT, rid, "pending-promotions");
    if (!existsSync(promoDir)) return;
    for (const file of readdirSync(promoDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        promotions.push({ runId: rid, ...JSON.parse(readFileSync(resolve(promoDir, file), "utf-8")) });
      } catch { /* skip */ }
    }
  };

  if (runId) scanRun(runId);
  else if (existsSync(RUNS_ROOT)) {
    for (const d of readdirSync(RUNS_ROOT)) {
      if (statSync(resolve(RUNS_ROOT, d)).isDirectory()) scanRun(d);
    }
  }
  return reply.send(promotions);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env["AEGIS_DASHBOARD_API_PORT"] ?? 3031);
const HOST = process.env["AEGIS_DASHBOARD_API_HOST"] ?? "127.0.0.1";

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`Dashboard API running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
