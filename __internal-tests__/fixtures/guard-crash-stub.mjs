// Test stub for guard-hook.test.ts (m1): a path-guard build whose guard error cannot be printed, so the hook's own
// catch block throws and only the uncaughtException handler is left to decide.
export function loadGuardContext() {
  const e = new Error("hidden");
  Object.defineProperty(e, "message", {
    get() {
      throw new Error("boom");
    },
  });
  throw e;
}

export function decide() {
  return { allow: true, claims: [], warnings: [] };
}

export function appendLedger() {}
