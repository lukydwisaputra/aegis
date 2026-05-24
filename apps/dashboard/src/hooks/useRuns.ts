import { useEffect, useState } from "react";
import { api, type RunSummary, type RunDetail } from "@/lib/api-client";

export function useRuns() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs
      .list()
      .then(setRuns)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return { runs, loading, error };
}

export function useRun(runId: string) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    api.runs
      .get(runId)
      .then(setRun)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [runId]);

  return { run, loading, error };
}
