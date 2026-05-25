import { useState } from "react";
import type { DefectEvidence } from "@/lib/api-client";

interface EvidenceGalleryProps {
  evidence: DefectEvidence;
  /** Base URL for the dashboard API (e.g. http://localhost:3031) */
  apiBase: string;
}

export function EvidenceGallery({ evidence, apiBase }: EvidenceGalleryProps) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  const screenshots = evidence.screenshots ?? [];
  const hasEvidence =
    screenshots.length > 0 ||
    (evidence.videos ?? []).length > 0 ||
    (evidence.logs ?? []).length > 0 ||
    (evidence.har ?? []).length > 0 ||
    evidence.stackTrace;

  if (!hasEvidence) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="evidence-gallery-empty">
        No evidence captured for this defect.
      </p>
    );
  }

  const toAbsolute = (path: string) =>
    path.startsWith("http") ? path : `${apiBase}${path}`;

  return (
    <div className="space-y-4" data-testid="evidence-gallery">
      {/* Screenshots */}
      {screenshots.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">
            Screenshots ({screenshots.length})
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {screenshots.map((src, i) => (
              <button
                key={i}
                type="button"
                className="group relative overflow-hidden rounded-md border border-border bg-muted aspect-video focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setLightbox(toAbsolute(src))}
                data-testid={`evidence-screenshot-thumb-${i}`}
                aria-label={`Screenshot ${i + 1}, click to enlarge`}
              >
                <img
                  src={toAbsolute(src)}
                  alt={`Screenshot ${i + 1}`}
                  className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
                  loading="lazy"
                />
                <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/30 text-white text-xs font-medium">
                  View
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Videos */}
      {(evidence.videos ?? []).length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">
            Videos ({evidence.videos.length})
          </h3>
          <div className="space-y-2">
            {evidence.videos.map((src, i) => (
              <video
                key={i}
                src={toAbsolute(src)}
                controls
                className="w-full max-w-xl rounded-md border border-border"
                data-testid={`evidence-video-${i}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Logs & HAR — download links only */}
      {((evidence.logs ?? []).length > 0 || (evidence.har ?? []).length > 0) && (
        <section>
          <h3 className="text-sm font-semibold mb-2">Files</h3>
          <ul className="space-y-1">
            {[...(evidence.logs ?? []), ...(evidence.har ?? [])].map((src, i) => {
              const name = src.split("/").pop() ?? src;
              return (
                <li key={i}>
                  <a
                    href={toAbsolute(src)}
                    download={name}
                    className="text-sm text-primary underline underline-offset-2 hover:no-underline"
                    data-testid={`evidence-file-link-${i}`}
                  >
                    {name}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Stack trace */}
      {evidence.stackTrace && (
        <section>
          <h3 className="text-sm font-semibold mb-2">Stack Trace</h3>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap break-all">
            {evidence.stackTrace}
          </pre>
        </section>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightbox(null)}
          data-testid="evidence-lightbox"
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white text-2xl leading-none"
            onClick={() => setLightbox(null)}
            aria-label="Close lightbox"
          >
            ✕
          </button>
          <img
            src={lightbox}
            alt="Screenshot enlarged"
            className="max-h-[90vh] max-w-[90vw] rounded-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
