import { useEffect, useRef, useState } from "react";
import { subscribeToEvents } from "@/lib/sse";

export function useEvents(runId: string | undefined) {
  const [events, setEvents] = useState<unknown[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!runId) return;
    unsubRef.current?.();
    setEvents([]);

    unsubRef.current = subscribeToEvents(runId, {
      onEvent: (_raw, parsed) => {
        setEvents((prev) => [...prev, parsed]);
      },
    });

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [runId]);

  return events;
}
