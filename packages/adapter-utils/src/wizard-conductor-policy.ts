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
  if (!firstOwner) return null;
  const latestOwner=[...rows].reverse().find(c=>c.authorUserId&&!c.authorAgentId);
  const proposal=[...rows].reverse().find(c=>c.authorAgentId===conductorId&&readWizardScope(c.body));
  if (!latestOwner || !proposal || new Date(latestOwner.createdAt)<=new Date(proposal.createdAt) || latestOwner.authorUserId!==firstOwner.authorUserId) return null;
  const parsed=readWizardScope(proposal.body)!;
  if (!isWizardApproval(latestOwner.body, proposal.id, parsed.hash)) return null;
  // A rejection or changed requirements after this proposal invalidates it, even if approval follows.
  if (rows.some(c=>c.authorUserId&&!c.authorAgentId&&new Date(c.createdAt)>new Date(proposal.createdAt)&&c.id!==latestOwner.id&&(!isWizardApproval(c.body,proposal.id,parsed.hash)||c.authorUserId!==firstOwner.authorUserId))) return null;
  const taskIndex=parsed.scope.tasks.findIndex(t=>t.title===task.title&&t.description===task.description&&t.assigneeAgentId===task.assigneeAgentId);
  return taskIndex<0?null:{approvalId:latestOwner.id,proposalId:proposal.id,hash:parsed.hash,taskIndex};
}

/** Deliberately narrow positive grammar. A mixed instruction or rejection is never approval. */
export function isWizardApproval(body: string, proposalId: string, hash: string): boolean {
  const binding = body.match(/\[wizard-approval:([a-zA-Z0-9-]+)\]/);
  if (binding && binding[1] !== proposalId) return false;
  const text = body.replace(/\[wizard-approval:[a-zA-Z0-9-]+\]/g, '').trim();
  if (text === `SETUJU SCOPE ${hash}`) return true; // existing evidence remains readable
  return /^(?:(?:oke|ok|ya)[, .!]*)?setuju(?:[, .!]*(?:gas(?: kerjakan)?|kerjakan|lanjut(?:kan)?))?[ .!]*$/i.test(text);
}

/** Model supplies structured intent; transport computes the exact identity, never another model. */
export function sealWizardProposal(body: string): string {
  const match = body.match(/```wizard-proposal\s*([\s\S]*?)```/);
  if (!match) return body;
  const scope = JSON.parse(match[1]) as WizardScope;
  // Normalize only a presentation variant, not scope meaning or task attribution.
  if (Array.isArray(scope.pages) && scope.pages.every(x=>typeof x==='string')) scope.pages=scope.pages.join(', ');
  const hash = wizardScopeHash(scope);
  const block = `[wizard-scope:${hash}]\n\`\`\`json\n${JSON.stringify(scope)}\n\`\`\``;
  if (!readWizardScope(block)) throw new Error('Model proposal is incomplete; no proposal published');
  return body.replace(match[0], block);
}
