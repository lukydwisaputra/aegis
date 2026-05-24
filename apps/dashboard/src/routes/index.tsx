import { Link } from "react-router-dom";
import { useRuns } from "@/hooks/useRuns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GateBadge } from "@/components/domain/GateBadge";
import { formatRelativeTime } from "@/lib/utils";

export default function RunsPage() {
  const { runs, loading, error } = useRuns();

  if (loading) return <p className="text-sm text-muted-foreground">Loading runs…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (runs.length === 0)
    return <p className="text-sm text-muted-foreground">No runs found. Start a cycle to see results here.</p>;

  return (
    <div className="space-y-4" data-testid="runs-list-page-container">
      <h1 className="text-xl font-semibold">Runs</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {runs.map((run) => (
          <Link key={run.runId} to={`/runs/${run.runId}`}>
            <Card
              className="hover:shadow-md transition-shadow"
              data-testid={`runs-card-${run.runId}-container`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-mono">{run.runId}</CardTitle>
                  <GateBadge
                    passed={run.status === "completed" ? true : run.status === "aborted" ? false : null}
                    label={run.status}
                  />
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(run.generatedAt)}
                </span>
                {run.passRate !== null && (
                  <Badge variant={run.passRate >= 99 ? "success" : run.passRate >= 80 ? "warning" : "destructive"}>
                    {run.passRate.toFixed(1)}% pass
                  </Badge>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
