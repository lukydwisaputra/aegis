import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type DefectDetail } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { EvidenceGallery } from "@/components/domain/EvidenceGallery";

const SEV_COLORS: Record<string, "destructive" | "warning" | "secondary" | "outline"> = {
  Sev1: "destructive",
  Sev2: "destructive",
  Sev3: "warning",
  Sev4: "secondary",
  Sev5: "outline",
};

const PRI_COLORS: Record<string, "destructive" | "warning" | "secondary" | "outline"> = {
  P0: "destructive",
  P1: "destructive",
  P2: "warning",
  P3: "secondary",
  P4: "outline",
};

// Resolve where the dashboard API lives at runtime.
// In dev the Vite proxy forwards /api to localhost:3031; in direct access we need the full origin.
const API_BASE =
  typeof window !== "undefined" && window.location.port === "3030"
    ? "http://localhost:3031"
    : "";

export default function DefectDetailPage() {
  const { defectId } = useParams<{ defectId: string }>();
  const [defect, setDefect] = useState<DefectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!defectId) return;
    api.defects
      .get(defectId)
      .then(setDefect)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [defectId]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!defect) return null;

  return (
    <div className="space-y-6 max-w-4xl" data-testid="defect-detail-page">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground">
        <Link to="/defects" className="hover:underline">
          Defects
        </Link>{" "}
        / <span className="font-mono">{defect.id}</span>
      </nav>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          <Badge variant={SEV_COLORS[defect.severity.code] ?? "outline"}>
            {defect.severity.name}
          </Badge>
          <Badge variant={PRI_COLORS[defect.priority.code] ?? "outline"}>
            {defect.priority.name}
          </Badge>
          <Badge variant="outline">{defect.status.code}</Badge>
        </div>
        <h1 className="text-xl font-semibold leading-tight">{defect.title}</h1>
        <p className="text-xs text-muted-foreground font-mono">{defect.id}</p>
      </div>

      {/* Meta */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {defect.tcId && (
          <>
            <dt className="text-muted-foreground">Test Case</dt>
            <dd className="font-mono col-span-2 sm:col-span-2">{defect.tcId}</dd>
          </>
        )}
        {defect.environment && (
          <>
            <dt className="text-muted-foreground">Environment</dt>
            <dd className="col-span-2 sm:col-span-2">{defect.environment}</dd>
          </>
        )}
        {defect.runId && (
          <>
            <dt className="text-muted-foreground">Run</dt>
            <dd className="font-mono col-span-2 sm:col-span-2">
              <Link to={`/runs/${defect.runId}`} className="text-primary hover:underline">
                {defect.runId}
              </Link>
            </dd>
          </>
        )}
        {defect.createdAt && (
          <>
            <dt className="text-muted-foreground">Reported</dt>
            <dd className="col-span-2 sm:col-span-2">
              {new Date(defect.createdAt).toLocaleString()}
            </dd>
          </>
        )}
      </dl>

      {/* Description */}
      {defect.description && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{defect.description}</p>
        </section>
      )}

      {/* Steps to reproduce */}
      {(defect.stepsToReproduce ?? []).length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Steps to Reproduce</h2>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            {defect.stepsToReproduce!.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {/* Expected / actual */}
      {(defect.expectedResult || defect.actualResult) && (
        <section className="grid gap-4 sm:grid-cols-2">
          {defect.expectedResult && (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Expected</h2>
              <p className="text-sm leading-relaxed">{defect.expectedResult}</p>
            </div>
          )}
          {defect.actualResult && (
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Actual</h2>
              <p className="text-sm leading-relaxed">{defect.actualResult}</p>
            </div>
          )}
        </section>
      )}

      {/* Evidence */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Evidence</h2>
        <EvidenceGallery
          evidence={defect.evidence ?? { screenshots: [], videos: [], logs: [], har: [] }}
          apiBase={API_BASE}
        />
      </section>
    </div>
  );
}
