export type RunStateErrorCode =
  | "not-in-aegis"
  | "no-active-run"
  | "run-not-found"
  | "caller-unknown"
  | "caller-forbidden"
  | "stop-requested"
  | "cap-reached"
  | "env-blocked"
  | "not-claimed"
  | "invalid-input"
  | "run-not-active"
  | "no-work-report";

/** A refusal by a run-state rule. The CLI maps it to exit code 2. */
export class RunStateError extends Error {
  readonly code: RunStateErrorCode;

  constructor(code: RunStateErrorCode, message: string) {
    super(message);
    this.name = "RunStateError";
    this.code = code;
  }
}
