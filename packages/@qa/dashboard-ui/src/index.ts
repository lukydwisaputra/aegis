import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Tailwind class merging utility (used by all components)
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Severity badge color mapping
export const SEVERITY_COLORS: Record<string, string> = {
  Sev1: "bg-red-600 text-white",
  Sev2: "bg-orange-500 text-white",
  Sev3: "bg-yellow-500 text-black",
  Sev4: "bg-blue-400 text-white",
  Sev5: "bg-gray-400 text-white",
};

// Priority badge color mapping
export const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-700 text-white",
  P1: "bg-orange-600 text-white",
  P2: "bg-yellow-600 text-black",
  P3: "bg-gray-500 text-white",
  P4: "bg-gray-300 text-black",
};

// Gate status color mapping
export const GATE_COLORS = {
  PASS: "bg-green-500 text-white",
  FAIL: "bg-red-500 text-white",
  PENDING: "bg-yellow-400 text-black",
  SKIPPED: "bg-gray-400 text-white",
} as const;

// Verdict color mapping (SPV reviews)
export const VERDICT_COLORS = {
  passed: "bg-green-100 text-green-800 border-green-200",
  "passed-with-notes": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "requested-changes": "bg-red-100 text-red-800 border-red-200",
} as const;

// Format a duration in ms to a human-readable string
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// Format a token count to a human-readable string
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// Format a USD cost
export function formatCost(usd: number): string {
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}

// Re-export contracts types used by dashboard components
export type { AegisEvent } from "@qa/contracts";
