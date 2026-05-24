import { useGateCheck } from "@/hooks/useGateCheck";
import { GateBadge } from "@/components/domain/GateBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STAGES = ["testing", "staging", "production"];

function GateCard({ stage }: { stage: string }) {
  const { gate, loading, error } = useGateCheck(stage);

  return (
    <Card data-testid={`gates-card-${stage}-container`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm capitalize">{stage}</CardTitle>
          {!loading && !error && gate && <GateBadge passed={gate.passed} />}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="text-xs text-destructive">Not available</p>}
        {gate && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{gate.summary}</p>
            <div className="space-y-0.5 mt-2">
              {gate.metrics.map((m) => (
                <div key={m.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{m.name}</span>
                  <span className={m.passed ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                    {String(m.actual)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function GatesPage() {
  return (
    <div className="space-y-4" data-testid="gates-list-page-container">
      <h1 className="text-xl font-semibold">Quality Gates</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {STAGES.map((stage) => (
          <GateCard key={stage} stage={stage} />
        ))}
      </div>
    </div>
  );
}
