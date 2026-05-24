import { useParams, Link } from "react-router-dom";
import { useRun } from "@/hooks/useRuns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunTimeline } from "@/components/domain/RunTimeline";
import { useEvents } from "@/hooks/useEvents";

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { run, loading, error } = useRun(runId ?? "");
  const events = useEvents(runId);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!run) return null;

  const closure = run.reports?.["closure"] as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4" data-testid={`runs-detail-${runId}-page-container`}>
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Runs</Link>
        <h1 className="text-xl font-semibold font-mono">{runId}</h1>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="events">Events ({events.length})</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          {closure && (
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(closure).map(([k, v]) => (
                <div key={k} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1")}</p>
                  <p className="text-lg font-semibold">{String(v)}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="events" className="pt-4">
          <RunTimeline events={events} />
        </TabsContent>

        <TabsContent value="reports" className="pt-4">
          <pre className="text-xs bg-muted rounded-md p-4 overflow-auto max-h-96">
            {JSON.stringify(run.reports, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}
