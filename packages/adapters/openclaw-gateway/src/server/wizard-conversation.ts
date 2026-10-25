import { readFile } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';

/** Delivery transport only. Never manufactures a reply or calls another model. */
export function wizardRequest(url:string,token:string,runId:string,body?:unknown):Promise<any>{
 return new Promise((resolve,reject)=>{const u=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){reject(new Error('Wizard API must be loopback'));return;}const text=body===undefined?null:JSON.stringify(body);
 const req=(u.protocol==='https:'?https:http).request(u,{agent:u.protocol==='https:'?new https.Agent({proxyEnv:undefined}):new http.Agent({proxyEnv:undefined}),method:text?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'X-Paperclip-Run-Id':runId,...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{})}},res=>{let data='';res.on('data',c=>{data+=c;if(data.length>2000000)req.destroy(new Error('Response too large'));});res.on('end',()=>{if(!res.statusCode||res.statusCode>=300){reject(new Error(`Wizard API HTTP ${res.statusCode} ${u.pathname}`));return;}try{resolve(JSON.parse(data));}catch{reject(new Error('Invalid Wizard JSON'));}})});const deadline=setTimeout(()=>req.destroy(new Error('Wizard API deadline; reconcile before retry')),4000);req.on('close',()=>clearTimeout(deadline));req.setTimeout(4000,()=>req.destroy(new Error('Wizard API timeout; reconcile before retry')));req.on('error',reject);if(text)req.write(text);req.end();
 });
}
export async function publishWizardModelReply(input:{apiUrl:string;keyPath:string;agentId:string;runId:string;issueId:string;wakeCommentId:string;modelReply:string;request?:typeof wizardRequest}){
 const key=JSON.parse(await readFile(input.keyPath.replace(/^~(?=\/)/,os.homedir()),'utf8'));const token=key.token??key.apiKey;if(typeof token!=='string')throw new Error('Conductor credential unavailable');const call=input.request??wizardRequest,base=input.apiUrl.replace(/\/$/,'')+'/api';
 const me=await call(base+'/agents/me',token,input.runId);if(me.id!==input.agentId)throw new Error('Conductor credential mismatch');const raw=await call(base+'/issues/'+input.issueId,token,input.runId);const room=raw.issue??raw;
 if(room.assigneeAgentId!==input.agentId||room.status!=='backlog'||!JSON.stringify(room).includes('[wizard-project:'))throw new Error('Wizard room mismatch');
 const rawRows=await call(base+'/issues/'+input.issueId+'/comments?order=asc',token,input.runId);const rows=(Array.isArray(rawRows)?rawRows:rawRows.comments) as any[];const owner=rows.find(c=>c.id===input.wakeCommentId&&c.authorUserId&&!c.authorAgentId&&!c.deletedAt);if(!owner)throw new Error('Owner message unavailable');
 const latest=[...rows].filter(c=>c.authorUserId&&!c.authorAgentId&&!c.deletedAt).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];if(latest?.id!==owner.id)throw new Error('New Owner message supersedes model result');
 if(rows.some(c=>!c.deletedAt&&c.authorAgentId===input.agentId&&Date.parse(c.createdAt)>Date.parse(owner.createdAt)))return {existing:true};
 if(!input.modelReply.trim())throw new Error('Model produced no response');
 const hash=createHash('sha256').update(`wizard:${input.issueId}:${owner.id}`).digest('hex');const clientRequestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 // One append attempt. A timeout is uncertain and is never blindly retried here.
 const reply=await call(base+'/issues/'+input.issueId+'/comments',token,input.runId,{body:input.modelReply,clientRequestId});if(reply.authorAgentId!==input.agentId)throw new Error('Reply attribution mismatch');return {existing:false,commentId:reply.id};
}
