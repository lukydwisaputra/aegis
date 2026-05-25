import { useEffect, useState } from "react";
import { api, type GateResult } from "@/lib/api-client";

export function useGateCheck(stage: string, runId?: string) {
  const [gate, setGate] = useState<GateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }
    api.gates
      .get(stage, runId)
      .then(setGate)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [stage, runId]);

  return { gate, loading, error };
}
