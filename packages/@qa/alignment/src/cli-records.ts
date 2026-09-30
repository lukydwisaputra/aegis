/** Event types each CLI command records (mirrors @qa/run-state behaviour). */
export const CLI_RECORDS: Readonly<Record<string, readonly string[]>> = {
  "run.create": ["run.created"],
  "run.stop": ["run.stop.requested"],
  "run.resume": ["run.resumed", "integrity.acknowledged"],
  "task.claim": ["task.claimed", "env.specialist-blocked"],
  "task.release": ["task.released"],
  "work-report.submit": ["artifact.created"],
  "review.submit": ["review.passed", "review.passed-with-notes", "review.requested-changes", "task.escalated", "run.blocked"],
  "integrity.verify": ["integrity.violation", "run.blocked"],
};

export function commandRecords(cmd: string, event: string): boolean {
  return (CLI_RECORDS[cmd] ?? []).includes(event);
}
