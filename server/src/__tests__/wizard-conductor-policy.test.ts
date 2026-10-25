import { describe,it,expect } from 'vitest';
import { wizardScopeHash,wizardDelegationEvidence,readWizardScope,isWizardRoom,type WizardScope } from '../services/wizard-conductor-policy.js';
const scope:WizardScope={purpose:'company site',pages:'home, contact',style:'clean',references:'none',audience:'parents',tasks:[{title:'Build website',description:'Build static home and contact, clean design for parents. No deployment.',assigneeAgentId:'cto'}]};
const hash=wizardScopeHash(scope);const msg=(id:string,body:string,sec:number,agent=false)=>({id,body,createdAt:`2026-10-25T00:00:${String(sec).padStart(2,'0')}Z`,authorAgentId:agent?'cecep':null,authorUserId:agent?null:'owner'});
const first=msg('1','website now',1),clarify=msg('2','Which purpose, pages, style, references, audience?',2,true),details=msg('3','school site',3),proposal=msg('4',`[wizard-scope:${hash}]\n\`\`\`json\n${JSON.stringify(scope)}\n\`\`\``,4,true),approve=msg('5',`SETUJU SCOPE ${hash}`,5);
describe('Wizard exact scope gate',()=>{
 it('ambiguous first and even full first brief never authorizes CTO',()=>{expect(wizardDelegationEvidence([first],'cecep',scope.tasks[0])).toBeNull();expect(wizardDelegationEvidence([{...first,body:JSON.stringify(scope)},approve],'cecep',scope.tasks[0])).toBeNull()});
 it('clarification and follow-up without fresh approval cannot create',()=>expect(wizardDelegationEvidence([first,clarify,details,proposal],'cecep',scope.tasks[0])).toBeNull());
 it('requires valid complete five-field scope and exact hash',()=>{expect(readWizardScope(proposal.body)?.hash).toBe(hash);expect(readWizardScope(proposal.body.replace('parents','customers'))).toBeNull()});
 it('permits only explicit approval after clarification and proposal',()=>expect(wizardDelegationEvidence([first,clarify,details,proposal,approve],'cecep',scope.tasks[0])).toEqual({approvalId:'5',proposalId:'4',hash,taskIndex:0}));
 it.each(['title','description','assigneeAgentId'] as const)('rejects task %s mismatch before side effect',key=>expect(wizardDelegationEvidence([first,clarify,details,proposal,approve],'cecep',{...scope.tasks[0],[key]:'changed'})).toBeNull());
 it('rejects old scope approval, new owner scope changes, another person and no model proposal',()=>{
  expect(wizardDelegationEvidence([first,clarify,details,proposal,{...approve,body:'SETUJU SCOPE '+'a'.repeat(64)}],'cecep',scope.tasks[0])).toBeNull();
  expect(wizardDelegationEvidence([first,clarify,details,proposal,approve,msg('6','change it',6)],'cecep',scope.tasks[0])).toBeNull();
  expect(wizardDelegationEvidence([first,clarify,details,proposal,{...approve,authorUserId:'other'}],'cecep',scope.tasks[0])).toBeNull();
  expect(wizardDelegationEvidence([first,proposal,approve],'cecep',scope.tasks[0])?.hash).toBe(hash);
 });
 it('room marker/assignee/backlog gate excludes other lanes',()=>{expect(isWizardRoom({title:'[wizard-project:p]',status:'backlog',assigneeAgentId:'cecep'})).toBe(true);expect(isWizardRoom({title:'chat',status:'backlog',assigneeAgentId:'cecep'})).toBe(false)});
});

describe('Owner UAT natural approval',()=>{
 it.each(['oke setuju, gas','Oke setuju, gas kerjakan.','Setuju','Ya setuju lanjut'])('binds latest same Owner approval %s',body=>expect(wizardDelegationEvidence([first,proposal,{...approve,body}],'cecep',scope.tasks[0])?.hash).toBe(hash));
 it.each(['Tidak setuju','Tolak','Setuju, tapi ganti halaman','gas','Setuju [wizard-approval:other]'])('fails closed for mixed/stale/rejected %s',body=>expect(wizardDelegationEvidence([first,proposal,{...approve,body}],'cecep',scope.tasks[0])).toBeNull());
 it('a changed brief or rejection invalidates an earlier proposal even with later positive words',()=>{expect(wizardDelegationEvidence([first,proposal,msg('x','Tolak',5),{...approve,id:'z',createdAt:'2026-10-25T00:00:07Z',body:'Setuju'}],'cecep',scope.tasks[0])).toBeNull()});
 it('cannot approve another project proposal absent this room',()=>expect(wizardDelegationEvidence([first,{...approve,body:'Setuju [wizard-approval:other]'}],'cecep',scope.tasks[0])).toBeNull());
});
