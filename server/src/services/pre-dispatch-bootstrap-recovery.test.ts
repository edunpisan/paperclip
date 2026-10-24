import { describe, expect, it } from "vitest";
import { isPreDispatchBootstrapRecovery, legacyExecutionNeedsReconciliation } from "./legacy-execution-recovery.js";

// EOS-08: pre-dispatch gateway failures must carry positive bootstrap
// evidence so they schedule a bounded retry instead of a permanent hold;
// post-dispatch failures carry no such evidence and stay fail-closed.
describe("isPreDispatchBootstrapRecovery (EOS-08)", () => {
  const base = { runtimeMode: "legacy", status: "timed_out", errorCode: "timeout" } as const;

  it("accepts bootstrap + transient_upstream as pre-dispatch evidence", () => {
    expect(isPreDispatchBootstrapRecovery({
      ...base,
      resultJson: {
        executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
        errorFamily: "transient_upstream",
      },
    })).toBe(true);
  });

  it("rejects post-dispatch failures without bootstrap evidence", () => {
    expect(isPreDispatchBootstrapRecovery({
      ...base,
      resultJson: { errorFamily: "transient_upstream" },
    })).toBe(false);
  });

  it("rejects bootstrap claims where provider work started", () => {
    expect(isPreDispatchBootstrapRecovery({
      ...base,
      resultJson: {
        executionRecovery: { kind: "bootstrap", providerWorkStarted: true },
        errorFamily: "transient_upstream",
      },
    })).toBe(false);
  });

  it("rejects bootstrap evidence with a non-transient family", () => {
    expect(isPreDispatchBootstrapRecovery({
      ...base,
      resultJson: {
        executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
        errorFamily: "configuration",
      },
    })).toBe(false);
  });

  it("does not hold pre-dispatch timed_out runs for reconciliation", () => {
    expect(legacyExecutionNeedsReconciliation({
      runtimeMode: "legacy",
      status: "timed_out",
      errorCode: "timeout",
      resultJson: {
        executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
        errorFamily: "transient_upstream",
      },
    })).toBe(false);
  });

  it("holds timed_out runs without bootstrap evidence for reconciliation", () => {
    expect(legacyExecutionNeedsReconciliation({
      runtimeMode: "legacy",
      status: "timed_out",
      errorCode: "timeout",
      resultJson: { errorFamily: "transient_upstream" },
    })).toBe(true);
  });
});
