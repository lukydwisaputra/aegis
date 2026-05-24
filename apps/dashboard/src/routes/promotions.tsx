import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Promotion {
  slug: string;
  type: string;
  description?: string;
  runId: string;
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.promotions
      .list()
      .then((p) => setPromotions(p as Promotion[]))
      .catch(() => setPromotions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4" data-testid="promotions-page-container">
      <h1 className="text-xl font-semibold">Curator Proposals</h1>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && promotions.length === 0 && (
        <p className="text-sm text-muted-foreground">No pending proposals.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {promotions.map((p) => (
          <Card key={p.slug} data-testid={`promotions-card-${p.slug}-container`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-mono">{p.slug}</CardTitle>
                <Badge variant="secondary">{p.type}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {p.description && (
                <p className="text-xs text-muted-foreground">{p.description}</p>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="default" disabled>Accept</Button>
                <Button size="sm" variant="outline" disabled>Reject</Button>
              </div>
              <p className="text-xs text-muted-foreground">Use /qa-promote to review interactively.</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
