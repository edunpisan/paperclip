import { createHash } from "node:crypto";

export type WizardCommentEvidence = { id: string; body: string; authorAgentId?: string | null; authorUserId?: string | null; deletedAt?: unknown; createdAt: Date | string };
export type WizardTaskScope = { title: string; description: string; assigneeAgentId: string };
export type WizardScope = { purpose: string; pages: string; style: string; references: string; audience: string; tasks: WizardTaskScope[] };
export function isWizardRoom(issue: { title?: string | null; description?: string | null; status?: string | null; assigneeAgentId?: string | null }) {
  const markers = `${issue.title ?? ""}\n${issue.description ?? ""}`.match(/\[wizard-project:[A-Za-z0-9_-]+\]/g) ?? [];
  return markers.length > 0 && new Set(markers).size === 1 && issue.status === "backlog" && !!issue.assigneeAgentId;
}
export function wizardScopeHash(scope: WizardScope): string {
  // Fixed field order is part of the approval contract. No fuzzy matching of work scope.
  return createHash("sha256").update(JSON.stringify({purpose:scope.purpose,pages:scope.pages,style:scope.style,references:scope.references,audience:scope.audience,tasks:scope.tasks.map(t=>({title:t.title,description:t.description,assigneeAgentId:t.assigneeAgentId}))})).digest("hex");
}
export function readWizardScope(body: string): { scope: WizardScope; hash: string } | null {
  const match = body.match(/\[wizard-scope:([a-f0-9]{64})\]\s*```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const scope = JSON.parse(match[2]) as WizardScope;
    if (![scope.purpose,scope.pages,scope.style,scope.references,scope.audience].every(v=>typeof v==="string"&&v.trim().length>0) || !Array.isArray(scope.tasks) || !scope.tasks.length || scope.tasks.length>20) return null;
    if (!scope.tasks.every(t=>t && [t.title,t.description,t.assigneeAgentId].every(v=>typeof v==="string"&&v.trim().length>0))) return null;
    return wizardScopeHash(scope)===match[1] ? {scope,hash:match[1]} : null;
  } catch { return null; }
}
export function wizardDelegationEvidence(comments: WizardCommentEvidence[], conductorId: string, task: WizardTaskScope): { approvalId: string; proposalId: string; hash: string; taskIndex: number } | null {
  const rows=comments.filter(c=>!c.deletedAt).sort((a,b)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
  const firstOwner=rows.find(c=>c.authorUserId&&!c.authorAgentId);
  const clarification=rows.find(c=>c.authorAgentId===conductorId && firstOwner && new Date(c.createdAt)>new Date(firstOwner.createdAt) && !readWizardScope(c.body));
  // Even a complete initial brief must receive clarification before any approved proposal.
  if (!firstOwner || !clarification) return null;
  const latestOwner=[...rows].reverse().find(c=>c.authorUserId&&!c.authorAgentId);
  const proposal=[...rows].reverse().find(c=>c.authorAgentId===conductorId&&readWizardScope(c.body));
  if (!latestOwner || !proposal || new Date(proposal.createdAt)<=new Date(clarification.createdAt) || new Date(latestOwner.createdAt)<=new Date(proposal.createdAt) || latestOwner.authorUserId!==firstOwner.authorUserId) return null;
  const parsed=readWizardScope(proposal.body)!;
  if (latestOwner.body.trim()!==`SETUJU SCOPE ${parsed.hash}`) return null;
  const taskIndex=parsed.scope.tasks.findIndex(t=>t.title===task.title&&t.description===task.description&&t.assigneeAgentId===task.assigneeAgentId);
  return taskIndex<0?null:{approvalId:latestOwner.id,proposalId:proposal.id,hash:parsed.hash,taskIndex};
}
