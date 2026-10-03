/** Event types each CLI command records (mirrors @qa/run-state behaviour). */
export const CLI_RECORDS: Readonly<Record<string, readonly string[]>> = {
  "run.create": ["run.created"],
  "run.stop": ["run.stop.requested"],
  "run.resume": ["run.resumed", "integrity.acknowledged"],
  "task.claim": ["task.claimed", "env.specialist-blocked"],
  "task.release": ["task.released", "run.blocked"],
  "task.cancel": ["task.cancelled"],
  "work-report.submit": ["artifact.created"],
  "review.submit": ["review.passed", "review.passed-with-notes", "review.requested-changes", "task.escalated", "run.blocked"],
  "integrity.verify": ["integrity.violation", "run.blocked"],
  "integrity.repair-tail": ["integrity.tail-repaired"],
  "phase.start": ["run.phase.started"],
  "phase.complete": ["run.phase.completed", "run.phase.not-applicable", "preflight.failed", "integrity.violation", "run.blocked"],
  "run.complete": ["run.completed", "integrity.violation", "run.blocked"],
  "gate.open": ["gate.opened", "integrity.violation", "run.blocked"],
  "gate.decide": ["gate.decided"],
  "gate.auto-decide": ["gate.auto-decided", "integrity.violation", "run.blocked"],
  "escalation.decide": ["escalation.decided"],
};

export function commandRecords(cmd: string, event: string): boolean {
  return (CLI_RECORDS[cmd] ?? []).includes(event);
}
