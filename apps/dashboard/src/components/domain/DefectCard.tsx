import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DefectSummary } from "@/lib/api-client";

const SEV_COLORS: Record<string, string> = {
  Sev1: "destructive",
  Sev2: "destructive",
  Sev3: "warning",
  Sev4: "secondary",
  Sev5: "outline",
};

const PRI_COLORS: Record<string, string> = {
  P0: "destructive",
  P1: "destructive",
  P2: "warning",
  P3: "secondary",
  P4: "outline",
};

interface DefectCardProps {
  defect: DefectSummary;
  onClick?: () => void;
}

export function DefectCard({ defect, onClick }: DefectCardProps) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
      data-testid={`defects-card-${defect.id}-container`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium line-clamp-2">{defect.title}</CardTitle>
          <Badge
            variant={(SEV_COLORS[defect.severity.code] ?? "outline") as "destructive" | "warning" | "secondary" | "outline"}
            className="shrink-0"
          >
            {defect.severity.name}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{defect.id}</span>
          <Badge
            variant={(PRI_COLORS[defect.priority.code] ?? "outline") as "destructive" | "warning" | "secondary" | "outline"}
          >
            {defect.priority.name}
          </Badge>
          <Badge variant="outline">{defect.status.code}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
