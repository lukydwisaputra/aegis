import { useEffect, useState } from "react";
import { api, type DefectSummary } from "@/lib/api-client";
import { DefectCard } from "@/components/domain/DefectCard";

export default function DefectsPage() {
  const [defects, setDefects] = useState<DefectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.defects
      .list()
      .then(setDefects)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading defects…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-4" data-testid="defects-list-page-container">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Defects</h1>
        <span className="text-sm text-muted-foreground">{defects.length} total</span>
      </div>
      {defects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No defects found.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {defects.map((d) => (
            <DefectCard key={d.id} defect={d} />
          ))}
        </div>
      )}
    </div>
  );
}
