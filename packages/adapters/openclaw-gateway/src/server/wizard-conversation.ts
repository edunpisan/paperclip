import { readFile } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { readWizardScope, sealWizardProposal, wizardDelegationEvidence } from '@paperclipai/adapter-utils/wizard-conductor-policy';

/** Official loopback transport. No ambient proxy, blind write retry or substitute model. */
export function wizardRequest(url:string,token:string,runId:string,body?:unknown):Promise<any>{
 return new Promise((resolve,reject)=>{const u=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){reject(new Error('Wizard API must be loopback'));return;}const text=body===undefined?null:JSON.stringify(body);
 const req=(u.protocol==='https:'?https:http).request(u,{agent:u.protocol==='https:'?new https.Agent({proxyEnv:undefined}):new http.Agent({proxyEnv:undefined}),method:text?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'X-Paperclip-Run-Id':runId,...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{})}},res=>{let data='';res.on('data',c=>{data+=c;if(data.length>2000000)req.destroy(new Error('Response too large'));});res.on('end',()=>{if(!res.statusCode||res.statusCode>=300){reject(new Error(`Wizard API HTTP ${res.statusCode} ${u.pathname}`));return;}try{resolve(JSON.parse(data));}catch{reject(new Error('Invalid Wizard JSON'));}})});const deadline=setTimeout(()=>req.destroy(new Error('Wizard API deadline; reconcile before retry')),4000);req.on('close',()=>clearTimeout(deadline));req.setTimeout(4000,()=>req.destroy(new Error('Wizard API timeout; reconcile before retry')));req.on('error',reject);if(text)req.write(text);req.end();
 });
}
type WizardInput={apiUrl:string;keyPath:string;agentId:string;runId:string;issueId:string;wakeCommentId:string;request?:typeof wizardRequest};
async function credentials(input:WizardInput){const key=JSON.parse(await readFile(input.keyPath.replace(/^~(?=\/)/,os.homedir()),'utf8'));const token=key.token??key.apiKey;if(typeof token!=='string')throw new Error('Conductor credential unavailable');return {token,call:input.request??wizardRequest,base:input.apiUrl.replace(/\/$/,'')+'/api'};}
async function verified(input:WizardInput){const c=await credentials(input);const [me,raw,rawRows]=await Promise.all([c.call(c.base+'/agents/me',c.token,input.runId),c.call(c.base+'/issues/'+input.issueId,c.token,input.runId),c.call(c.base+'/issues/'+input.issueId+'/comments?order=asc',c.token,input.runId)]);const room=raw.issue??raw;
 if(me.id!==input.agentId||room.assigneeAgentId!==input.agentId||room.status!=='backlog'||!JSON.stringify(room).includes('[wizard-project:'))throw new Error('Wizard room or credential mismatch');
 const rows=(Array.isArray(rawRows)?rawRows:rawRows.comments) as any[];const owner=rows.find(x=>x.id===input.wakeCommentId&&x.authorUserId&&!x.authorAgentId&&!x.deletedAt);const latest=rows.filter(x=>x.authorUserId&&!x.authorAgentId&&!x.deletedAt).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];if(!owner||latest?.id!==owner.id)throw new Error('New Owner message supersedes model result');return {...c,room,rows,owner};}

/** Approved dispatch is transport of the exact prior model proposal, not model-generated acknowledgement. */
export async function prepareWizardTurn(input:WizardInput):Promise<{context:string;dispatchedTasks?:unknown[]}>{
 const c=await verified(input);const proposal=[...c.rows].reverse().find(x=>!x.deletedAt&&x.authorAgentId===input.agentId&&readWizardScope(x.body));const parsed=proposal&&readWizardScope(proposal.body);const evidence=parsed&&wizardDelegationEvidence(c.rows,input.agentId,parsed.scope.tasks[0]);
 if(evidence&&parsed){const dispatched=[];for(const task of parsed.scope.tasks){const result=await c.call(c.base+'/issues/'+input.issueId+'/children',c.token,input.runId,task);const issue=result.issue??result;dispatched.push({id:issue.id,identifier:issue.identifier,title:issue.title,assigneeAgentId:issue.assigneeAgentId});}return {context:'The latest human Owner explicitly approved the exact current model proposal. The official server-authorized task transport completed. Report ONLY these actual receipts in everyday Indonesian; no tools or further tasks. '+JSON.stringify(dispatched),dispatchedTasks:dispatched};}
 const org=await c.call(c.base+'/companies/'+c.room.companyId+'/agents',c.token,input.runId);const agents=(Array.isArray(org)?org:org.agents??[]).map((x:any)=>({id:x.id,name:x.name,role:x.role,status:x.status}));return {context:'Read the entire existing brief and conversation below before answering. Ask only genuine missing decisions, never repeat answered details. If enough information exists, propose a plan immediately; Owner approval is still required. Available actual team: '+JSON.stringify(agents)+'\nConversation: '+JSON.stringify(c.rows.map(x=>({speaker:x.authorUserId?'Owner':'Cecep',text:x.body})))};
}
export async function publishWizardModelReply(input:WizardInput&{modelReply:string}){
 const c=await verified(input);if(c.rows.some(x=>!x.deletedAt&&x.authorAgentId===input.agentId&&Date.parse(x.createdAt)>Date.parse(c.owner.createdAt)))return {existing:true};
 if(!input.modelReply.trim())throw new Error('Model produced no response');const body=sealWizardProposal(input.modelReply);
 const hash=createHash('sha256').update(`wizard:${input.issueId}:${c.owner.id}`).digest('hex');const clientRequestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 // Recheck latest Owner immediately before the sole append; server also fences request identity.
 const fresh=await c.call(c.base+'/issues/'+input.issueId+'/comments?order=asc',c.token,input.runId);const rows=Array.isArray(fresh)?fresh:fresh.comments;const last=rows.filter((x:any)=>x.authorUserId&&!x.authorAgentId&&!x.deletedAt).sort((a:any,b:any)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];if(last?.id!==c.owner.id)throw new Error('New Owner message supersedes model result');
 const reply=await c.call(c.base+'/issues/'+input.issueId+'/comments',c.token,input.runId,{body,clientRequestId});if(reply.authorAgentId!==input.agentId)throw new Error('Reply attribution mismatch');return {existing:false,commentId:reply.id};
}
