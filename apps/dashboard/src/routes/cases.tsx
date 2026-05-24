import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";

interface CaseSummary {
  id: string;
  title: string;
  testLevel?: string;
  automationStatus?: string;
  priority?: { code: string; name: string };
}

export default function CasesPage() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.cases
      .list()
      .then((c) => setCases(c as CaseSummary[]))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading test cases…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-4" data-testid="cases-list-page-container">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Test Cases</h1>
        <span className="text-sm text-muted-foreground">{cases.length} total</span>
      </div>
      {cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No test cases found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-left">
                <th className="pb-2 pr-4 font-medium">ID</th>
                <th className="pb-2 pr-4 font-medium">Title</th>
                <th className="pb-2 pr-4 font-medium">Level</th>
                <th className="pb-2 pr-4 font-medium">Automation</th>
                <th className="pb-2 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cases.map((tc) => (
                <tr key={tc.id} data-testid={`cases-row-${tc.id}-container`}>
                  <td className="py-2 pr-4 font-mono text-xs">{tc.id}</td>
                  <td className="py-2 pr-4">{tc.title}</td>
                  <td className="py-2 pr-4">
                    <Badge variant="outline">{tc.testLevel ?? "—"}</Badge>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={tc.automationStatus === "Automated" ? "success" : "secondary"}>
                      {tc.automationStatus ?? "—"}
                    </Badge>
                  </td>
                  <td className="py-2">{tc.priority?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
