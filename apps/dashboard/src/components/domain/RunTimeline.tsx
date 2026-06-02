import { formatRelativeTime } from "@/lib/utils";

interface TimelineEvent {
  event: string;
  ts: string;
  [key: string]: unknown;
}

interface RunTimelineProps {
  events: unknown[];
}

export function RunTimeline({ events }: RunTimelineProps) {
  const typed = events.filter(
    (e): e is TimelineEvent => typeof e === "object" && e !== null && "event" in e && "ts" in e
  );

  if (typed.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }

  return (
    <ol className="relative border-l border-border ml-3 space-y-4">
      {typed.map((evt, i) => (
        <li key={i} className="ml-6">
          <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-muted ring-4 ring-background text-xs">
            {i + 1}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-primary">{evt.event}</span>
            <time className="text-xs text-muted-foreground">{formatRelativeTime(evt.ts)}</time>
          </div>
          {"agent" in evt && (
            <p className="text-xs text-muted-foreground mt-0.5">{String(evt.agent)}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
