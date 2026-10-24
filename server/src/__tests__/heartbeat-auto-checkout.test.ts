import { describe, expect, it } from "vitest";
import {
  shouldAutoCheckoutIssueForWake,
  isWizardStandingChatLane,
} from "../services/heartbeat.ts";

describe("shouldAutoCheckoutIssueForWake", () => {
  it("auto-checks out an assigned todo issue for an actionable wake", () => {
    expect(shouldAutoCheckoutIssueForWake({
      contextSnapshot: { wakeReason: "issue_assigned" },
      issueStatus: "todo",
      issueAssigneeAgentId: "agent-1",
      isDependencyReady: true,
      agentId: "agent-1",
    })).toBe(true);
  });

  it("leaves an idle review issue in review without an actionable wake", () => {
    expect(shouldAutoCheckoutIssueForWake({
      contextSnapshot: {},
      issueStatus: "in_review",
      issueAssigneeAgentId: "agent-1",
      isDependencyReady: true,
      agentId: "agent-1",
    })).toBe(false);
  });

  it("does not auto-checkout pending execution-review state even if the row status is todo", () => {
    const reviewerAgentId = "11111111-1111-4111-8111-111111111111";
    const coderAgentId = "22222222-2222-4222-8222-222222222222";
    expect(shouldAutoCheckoutIssueForWake({
      contextSnapshot: { wakeReason: "issue_recovery_action_restored" },
      issueStatus: "todo",
      issueAssigneeAgentId: reviewerAgentId,
      issueExecutionState: {
        status: "pending",
        currentStageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: reviewerAgentId },
        returnAssignee: { type: "agent", agentId: coderAgentId },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
      isDependencyReady: true,
      agentId: reviewerAgentId,
    })).toBe(false);
  });
});


describe("Wizard standing chat checkout compatibility", () => {
  const room = {
    contextSnapshot: { wakeReason: "issue_commented" },
    issueStatus: "backlog",
    issueAssigneeAgentId: "agent-1",
    issueTitle: "Wizard · Verification [wizard-project:wp-eos08]",
    issueDescription: "Standing chat lane\n[wizard-project:wp-eos08]",
    issueParentId: null,
    isDependencyReady: true,
    agentId: "agent-1",
  };

  it("keeps the Wizard room in backlog on first and follow-up comments", () => {
    expect(shouldAutoCheckoutIssueForWake(room)).toBe(false);
    expect(shouldAutoCheckoutIssueForWake({ ...room, contextSnapshot: { wakeReason: "issue_commented", wakeCommentId: "follow-up" } })).toBe(false);
  });

  it("still checks out ordinary backlog and todo tasks on comments", () => {
    for (const issueStatus of ["backlog", "todo"]) {
      expect(shouldAutoCheckoutIssueForWake({ ...room, issueStatus, issueTitle: "Ordinary task", issueDescription: null })).toBe(true);
    }
    expect(shouldAutoCheckoutIssueForWake({ ...room, issueParentId: "parent-room" })).toBe(true);
  });

  it("does not broaden the exemption to blocked, recovery, or assignment wakes", () => {
    expect(shouldAutoCheckoutIssueForWake({ ...room, issueStatus: "blocked" })).toBe(true);
    expect(shouldAutoCheckoutIssueForWake({ ...room, contextSnapshot: { wakeReason: "issue_recovery_action_restored" } })).toBe(true);
    expect(shouldAutoCheckoutIssueForWake({ ...room, contextSnapshot: { wakeReason: "issue_assigned" } })).toBe(true);
    expect(shouldAutoCheckoutIssueForWake({ ...room, issueStatus: "blocked", contextSnapshot: { wakeReason: "source_scoped_recovery_action" } })).toBe(false);
  });

  it("preserves dependency and assignee gates for ordinary tasks", () => {
    expect(shouldAutoCheckoutIssueForWake({ ...room, issueTitle: "Task", issueDescription: null, isDependencyReady: false })).toBe(false);
    expect(shouldAutoCheckoutIssueForWake({ ...room, issueTitle: "Task", issueDescription: null, agentId: "other" })).toBe(false);
  });

  it("recognizes the exact existing identity in either title or description", () => {
    expect(isWizardStandingChatLane({ title: "[wizard-project:wp-eos08]" })).toBe(true);
    expect(isWizardStandingChatLane({ description: "[wizard-project:wp-eos08]" })).toBe(true);
    expect(isWizardStandingChatLane({ title: room.issueTitle, description: room.issueDescription })).toBe(true);
  });

  it.each([
    "Founder OS Cockpit",
    "wizard-project:wp-eos08",
    "[wizard-project:]",
    "[wizard-project:wp eos08]",
    "[wizard-project:wp.eos08]",
    "[wizard-project:" + "a".repeat(65) + "]",
    "[wizard-project:wp-eos08] [wizard-project:other]",
  ])("rejects non-Wizard or ambiguous marker %s", (title) => {
    expect(isWizardStandingChatLane({ title })).toBe(false);
  });
});
