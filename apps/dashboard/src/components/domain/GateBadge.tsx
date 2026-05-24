import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock } from "lucide-react";

interface GateBadgeProps {
  passed: boolean | null;
  label?: string;
}

export function GateBadge({ passed, label }: GateBadgeProps) {
  if (passed === null) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" />
        {label ?? "Pending"}
      </Badge>
    );
  }
  return passed ? (
    <Badge variant="success" className="gap-1">
      <CheckCircle className="h-3 w-3" />
      {label ?? "Pass"}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      {label ?? "Fail"}
    </Badge>
  );
}
