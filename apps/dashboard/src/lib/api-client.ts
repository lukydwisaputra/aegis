const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3031") + "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface RunSummary {
  runId: string;
  status: "in-progress" | "completed" | "aborted" | "unknown";
  generatedAt: string;
  passRate: number | null;
}

export interface RunDetail {
  runId: string;
  reports: Record<string, unknown>;
  events: unknown[];
}

export interface DefectSummary {
  id: string;
  title: string;
  severity: { code: string; name: string };
  priority: { code: string; name: string };
  status: { code: string };
  runId: string;
}

export interface DefectEvidence {
  screenshots: string[];
  videos: string[];
  logs: string[];
  har: string[];
  stackTrace?: string;
}

export interface DefectDetail extends DefectSummary {
  description?: string;
  stepsToReproduce?: string[];
  expectedResult?: string;
  actualResult?: string;
  environment?: string;
  tcId?: string;
  evidence: DefectEvidence;
  createdAt?: string;
  updatedAt?: string;
}

export interface GateResult {
  stage: string;
  passed: boolean;
  evaluatedAt: string;
  metrics: Array<{ name: string; actual: unknown; threshold: unknown; passed: boolean }>;
  summary: string;
}

export const api = {
  runs: {
    list: () => get<RunSummary[]>("/runs"),
    get: (runId: string) => get<RunDetail>(`/runs/${runId}`),
  },
  defects: {
    list: (runId?: string) =>
      get<DefectSummary[]>(`/defects${runId ? `?runId=${runId}` : ""}`),
    get: (defectId: string) => get<DefectDetail>(`/defects/${defectId}`),
  },
  cases: {
    list: (runId?: string) =>
      get<unknown[]>(`/cases${runId ? `?runId=${runId}` : ""}`),
  },
  gates: {
    get: (stage: string, runId?: string) =>
      get<GateResult>(`/gates/${stage}${runId ? `?runId=${runId}` : ""}`),
  },
  promotions: {
    list: () => get<unknown[]>("/promotions"),
  },
  settings: {
    get: () => get<Record<string, unknown>>("/settings"),
  },
};
