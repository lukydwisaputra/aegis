import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.settings.get().then(setSettings).catch(() => setSettings(null)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4" data-testid="settings-page-container">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">aegis.config.json</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!loading && !settings && <p className="text-xs text-muted-foreground">Not available.</p>}
          {settings && (
            <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-96">
              {JSON.stringify(settings, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
