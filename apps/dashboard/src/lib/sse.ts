export interface SseOptions {
  onEvent: (raw: string, parsed: unknown) => void;
  onError?: (err: Event) => void;
}

export function subscribeToEvents(runId: string, opts: SseOptions): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);

  es.onmessage = (e) => {
    try {
      const parsed: unknown = JSON.parse(e.data as string);
      opts.onEvent(e.data as string, parsed);
    } catch {
      opts.onEvent(e.data as string, null);
    }
  };

  if (opts.onError) es.onerror = opts.onError;

  return () => es.close();
}
