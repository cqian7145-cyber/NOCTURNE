import {liveQuery} from 'dexie';
import type {JournalDatabase} from '../database';
import {clock} from '../dates';
import {scheduled} from '../stats';
import {cardSchema,deckSchema,nodeSchema,noteSchema,ruleSchema,settingsSchema,linkSchema,defaultSettings,validateTree,
  type KnowledgeNode,type MemoryNote,type MemoryCard,type ReviewSession,type MemoryLog,type StudyRule,type MemorySettings,type Deck} from './model';
import {freshMemory,schedule} from './scheduler';
import {parseMarkdown,templates} from './content';

const now=()=>new Date().toISOString();
export const stamp=()=>({id:crypto.randomUUID(),createdAt:now(),updatedAt:now(),revision:0});
const flags={archived:false,trashed:false,favorite:false};
export const blankNote=(deckId:string,nodeId?:string):MemoryNote=>({...stamp(),deckId,nodeId,type:'basic',front:'',back:'',extra:'',hint:'',tags:[],source:'',regions:[],...flags});
export const blankNode=():KnowledgeNode=>({...stamp(),title:'未命名知识',body:'',tags:[],source:'',versions:[],...flags});
function conflict():never {throw new Error('记录已在另一个窗口更新，请刷新后继续。');}

export function createMemoryRepository(db:JournalDatabase){
  const tables=[db.journal,db.knowledgeNodes,db.knowledgeBlocks,db.decks,db.notes,db.cards,db.reviewLogs,db.studySessions,db.knowledgeLinks,db.attachments,db.studyRules,db.memorySettings];
  const transaction=<T>(fn:()=>Promise<T>)=>db.transaction('rw',tables,fn);
  const settings=async()=>await db.memorySettings.get('current')??defaultSettings();

  async function syncNote(input:MemoryNote,expected?:number){
    const note=noteSchema.parse(input),existing=await db.notes.get(note.id);
    if(existing&&expected!==undefined&&existing.revision!==expected)conflict();
    const deck=await db.decks.get(note.deckId);if(!deck)throw new Error('请选择有效卡组。');
    if(note.nodeId&&!await db.knowledgeNodes.get(note.nodeId))throw new Error('来源知识已不存在。');
    const node=note.nodeId?await db.knowledgeNodes.get(note.nodeId):undefined;
    const generated=templates(note),oldCards=await db.cards.where('noteId').equals(note.id).toArray(),keys=new Set(generated.map(t=>t.key));
    note.updatedAt=now();note.revision=(existing?.revision??-1)+1;await db.notes.put(note);
    for(const template of generated){
      const old=oldCards.find(c=>c.templateKey===template.key);
      const card:MemoryCard={...stamp(),memory:freshMemory(),eligible:1,suspended:false,archived:false,trashed:false,...old,
        noteId:note.id,deckId:note.deckId,templateKey:template.key,front:template.front,back:template.back,
        attachmentId:template.attachmentId,region:'region' in template?template.region as MemoryCard['region']:undefined,
        updatedAt:now(),revision:(old?.revision??-1)+1};
      card.archived=old?.archived??note.archived;card.trashed=old?.trashed??note.trashed;card.obsolete=false;card.nodeHidden=!!(node?.trashed||node?.archived||note.trashed||note.archived);card.deckArchived=deck.archived;
      card.eligible=card.suspended||card.archived||card.trashed||card.nodeHidden||card.deckArchived||card.obsolete?0:1;
      await db.cards.put(cardSchema.parse(card));
    }
    for(const card of oldCards.filter(c=>!keys.has(c.templateKey)))await db.cards.update(card.id,{obsolete:true,eligible:0,revision:card.revision+1,updatedAt:now()});
    return note;
  }
  async function syncGenerated(node:KnowledgeNode,generate=true){
    const blocks=await db.knowledgeBlocks.where('nodeId').equals(node.id).toArray(),{parsed,errors}=parseMarkdown(node.body,blocks.filter(b=>b.type==='card'));
    if(generate&&errors.length)throw new Error(errors.join('；'));
    const previousMarkdown=blocks.filter(b=>b.type==='markdown'),used=new Set<string>();
    const paragraphs=node.body.split(/\n\n+/).map((content,order)=>{const old=previousMarkdown.find(b=>b.content===content&&!used.has(b.id))??previousMarkdown.find(b=>b.order===order&&!used.has(b.id));const id=old?.id??crypto.randomUUID();used.add(id);return{id,nodeId:node.id,content,order,type:'markdown' as const};});
    if(!generate){await db.knowledgeBlocks.where('nodeId').equals(node.id).delete();await db.knowledgeBlocks.bulkPut(paragraphs);return 0;}
    let deck=await db.decks.toCollection().first();if(!deck){deck={...stamp(),name:'知识卡片',archived:false};await db.decks.put(deck);}
    const previous=await db.notes.where('nodeId').equals(node.id).toArray(),active=new Set<string>();
    for(const item of parsed){
      const origin=node.id+':'+item.blockId;active.add(origin);const old=previous.find(note=>note.origin===origin);
      await syncNote({...blankNote(deck.id,node.id),...old,type:item.type,front:item.front,back:item.back,origin,archived:false,trashed:false},old?.revision);
    }
    for(const old of previous.filter(note=>note.origin&&!active.has(note.origin)))await syncNote({...old,archived:true},old.revision);
    await db.knowledgeBlocks.where('nodeId').equals(node.id).delete();
    await db.knowledgeBlocks.bulkPut(paragraphs);
    for(const item of parsed)await db.knowledgeBlocks.put({id:item.blockId,nodeId:node.id,content:item.line,order:item.order,type:'card'});
    return parsed.length;
  }
  async function bridge(dateArg?:string){
    const row=await db.journal.get('current');if(!row)return;
    const rules=(await db.studyRules.toArray()).filter(rule=>rule.enabled);if(!rules.length)return;
    const data=row.value,date=dateArg??clock(data.settings.zone).date,dayStart=Date.parse(date+'T00:00:00Z')-86400000;
    const logs=(await db.reviewLogs.where('reviewedAt').between(new Date(dayStart).toISOString(),new Date(dayStart+259200000).toISOString(),true,true).toArray())
      .filter(log=>!log.undone&&!log.excluded&&log.formal&&clock(data.settings.zone,new Date(log.reviewedAt)).date===date);
    let changed=false;
    for(const rule of rules){
      const habit=data.habits.find(h=>h.id===rule.habitId);if(!habit||!scheduled(habit,date))continue;
      const cards=rule.deckId?await db.cards.where('deckId').equals(rule.deckId).toArray():await db.cards.toArray(),ids=new Set(cards.map(c=>c.id));
      const filtered=logs.filter(log=>ids.has(log.cardId));let value=new Set(filtered.map(l=>l.cardId)).size;
      if(rule.metric==='newCards')value=cards.filter(c=>!c.trashed&&clock(data.settings.zone,new Date(c.createdAt)).date===date).length;
      if(rule.metric==='notes')value=(await db.knowledgeNodes.toArray()).filter(n=>!n.trashed&&clock(data.settings.zone,new Date(n.createdAt)).date===date).length;
      if(rule.metric==='minutes'){
        const sessions=await db.studySessions.toArray(),focusIds=new Set(data.sessions.map(s=>s.id));
        value=filtered.filter(log=>!sessions.some(s=>s.id===log.sessionId&&s.focusId&&focusIds.has(s.focusId))).reduce((sum,l)=>sum+l.duration/60000,0);
        value+=data.sessions.filter(s=>s.completed&&(s.mode==='focus'||s.mode==='stopwatch')&&(!rule.deckId||s.deckId===rule.deckId)&&clock(data.settings.zone,new Date(s.endedAt)).date===date).reduce((sum,s)=>sum+s.actualSeconds/60,0);
      }
      if(rule.metric==='allDue')value=cards.some(c=>c.eligible&&c.memory.state!==0&&c.memory.due<=now())?0:filtered.length?1:0;
      const entry=data.entries.find(e=>e.habitId===habit.id&&e.date===date);if(entry&&entry.source!=='memoria')continue;
      const completed=value>=rule.target,quantity=value||undefined;if(entry?.completed===completed&&entry?.quantity===quantity)continue;
      const next={habitId:habit.id,date,completed,quantity,source:'memoria' as const,createdAt:entry?.createdAt??now(),updatedAt:now()};
      if(entry)Object.assign(entry,next);else data.entries.push(next);changed=true;
    }
    if(changed)await db.journal.put({id:'current',value:data});
  }
  async function nextCard(session:ReviewSession){
    const available=(await db.cards.bulkGet(session.queue)).filter((c):c is MemoryCard=>!!c&&c.eligible===1);
    const practice=['practice','exam'].includes(session.mode),due=available.filter(c=>practice||c.memory.state===0||c.memory.due<=now());
    return(await settings()).burySiblings?due.find(c=>c.noteId!==session.lastNoteId)??due[0]:due[0];
  }
  async function overview(){
    const [nodes,decks,due,newCards,learning,active,configuration]=await Promise.all([
      db.knowledgeNodes.toArray(),db.decks.toArray(),
      db.cards.where('[eligible+memory.due]').between([1,''],[1,now()],true,true).and(c=>c.memory.state!==0).count(),
      db.cards.where('memory.state').equals(0).and(c=>c.eligible===1).count(),
      db.cards.where('memory.state').anyOf(1,3).and(c=>c.eligible===1).count(),db.studySessions.where('status').equals('active').first(),settings()]);
    return{nodes,decks,due,newCards,learning,active,settings:configuration};
  }
  return{
    db,settings,overview,observe:()=>liveQuery(overview),refreshBridge:()=>transaction(()=>bridge()),
    saveSettings(value:MemorySettings){return transaction(async()=>{await db.memorySettings.put(settingsSchema.parse({...value,updatedAt:now()}));});},
    saveNote(value:MemoryNote){return transaction(async()=>{const result=await syncNote(value,value.revision);await bridge();return result;});},
    saveNode(value:KnowledgeNode,generate=false){return transaction(async()=>{
      const input=nodeSchema.parse(value),old=await db.knowledgeNodes.get(input.id);if(old&&old.revision!==input.revision)conflict();
      validateTree([...(await db.knowledgeNodes.toArray()).filter(n=>n.id!==input.id),input]);
      const versions=old&&(old.body!==input.body||old.title!==input.title)?[...old.versions,{title:old.title,body:old.body,savedAt:old.updatedAt}].slice(-60):input.versions;
      const next={...input,versions,revision:(old?.revision??-1)+1,updatedAt:now()};await db.knowledgeNodes.put(next);
      await syncGenerated(next,generate||(await db.notes.where('nodeId').equals(next.id).toArray()).some(n=>n.origin));
      const nodes=await db.knowledgeNodes.toArray(),links=await db.knowledgeLinks.where('sourceId').equals(next.id).toArray();
      await db.knowledgeLinks.bulkDelete(links.filter(l=>l.id.startsWith('wiki-')).map(l=>l.id));
      for(const match of next.body.matchAll(/\[\[([^\]]+)]]/g)){
        const target=nodes.find(n=>n.id===match[1]||n.title===match[1]);
        if(target&&target.id!==next.id)await db.knowledgeLinks.put({id:'wiki-'+next.id+'-'+target.id,sourceId:next.id,targetId:target.id,relation:'reference',updatedAt:now()});
      }
      for(const note of await db.notes.where('nodeId').equals(next.id).toArray())for(const c of await db.cards.where('noteId').equals(note.id).toArray()){c.nodeHidden=next.archived||next.trashed||note.archived||note.trashed;c.eligible=c.suspended||c.archived||c.trashed||c.nodeHidden||c.deckArchived||c.obsolete?0:1;c.revision++;await db.cards.put(c);}
      await bridge();return next;
    });},
    saveDeck(value:Deck){return transaction(async()=>{
      const next=deckSchema.parse(value),old=await db.decks.get(next.id);if(old&&old.revision!==next.revision)conflict();
      validateTree([...(await db.decks.toArray()).filter(d=>d.id!==next.id),next]);await db.decks.put({...next,revision:(old?.revision??-1)+1,updatedAt:now()});
      if(old?.archived!==next.archived)for(const c of await db.cards.where('deckId').equals(next.id).toArray())await db.cards.update(c.id,{deckArchived:next.archived,eligible:next.archived||c.suspended||c.trashed||c.archived||c.nodeHidden||c.obsolete?0:1,revision:c.revision+1});
    });},
    saveLink(value:unknown){return transaction(async()=>{const l=linkSchema.parse(value);if(l.sourceId===l.targetId||!await db.knowledgeNodes.get(l.sourceId)||!await db.knowledgeNodes.get(l.targetId))throw new Error('请选择两个不同的知识节点。');await db.knowledgeLinks.put(l);});},
    deleteLink(id:string){return transaction(async()=>{await db.knowledgeLinks.delete(id);});},
    saveRule(value:StudyRule){return transaction(async()=>{const rule=ruleSchema.parse(value),row=await db.journal.get('current');if(!row?.value.habits.some(h=>h.id===rule.habitId&&h.measurement))throw new Error('请选择一个量化习惯。');if(rule.deckId&&!await db.decks.get(rule.deckId))throw new Error('卡组已不存在。');if(rule.enabled&&(await db.studyRules.where('habitId').equals(rule.habitId).toArray()).some(r=>r.enabled&&r.id!==rule.id))throw new Error('同一习惯只保留一条启用的联动规则，请先停用原规则。');const habit=row.value.habits.find(h=>h.id===rule.habitId)!;if(rule.target<habit.measurement!.minimum)throw new Error('联动目标不能小于习惯的最低执行标准。');await db.studyRules.put(rule);await bridge();});},

    cards(filter:{query?:string;deckId?:string;state?:string;flag?:string;tag?:string;sort?:string;minimumLapses?:number;minimumDifficulty?:number;minimumStability?:number;createdAfter?:string;updatedAfter?:string},offset=0,limit=50){
      let q=filter.deckId?db.cards.where('deckId').equals(filter.deckId):db.cards.toCollection();
      q=q.filter(c=>filter.flag==='trash'?c.trashed:!c.trashed);
      if(filter.state)q=q.filter(c=>String(c.memory.state)===filter.state);
      if(filter.query)q=q.filter(c=>(c.front+' '+c.back).toLowerCase().includes(filter.query!.toLowerCase()));
      if(filter.flag==='due')q=q.filter(c=>c.eligible===1&&c.memory.state!==0&&c.memory.due<=now());
      if(filter.flag==='suspended')q=q.filter(c=>c.suspended);if(filter.flag==='archived')q=q.filter(c=>c.archived);
      if(filter.minimumLapses)q=q.filter(c=>c.memory.lapses>=filter.minimumLapses!);
      if(filter.minimumDifficulty)q=q.filter(c=>c.memory.difficulty>=filter.minimumDifficulty!);
      if(filter.minimumStability)q=q.filter(c=>c.memory.stability>=filter.minimumStability!);
      if(filter.createdAfter)q=q.filter(c=>c.createdAt>=filter.createdAfter!);if(filter.updatedAfter)q=q.filter(c=>c.updatedAt>=filter.updatedAfter!);
      return q.toArray().then(async cards=>{
        const notes=filter.tag?await db.notes.where('tags').equals(filter.tag).primaryKeys():null,selected=cards.filter(c=>!notes||notes.includes(c.noteId));
        selected.sort((a,b)=>filter.sort==='difficulty'?b.memory.difficulty-a.memory.difficulty:filter.sort==='stability'?a.memory.stability-b.memory.stability:a.memory.due.localeCompare(b.memory.due));
        return{total:selected.length,items:selected.slice(offset,offset+limit)};
      });
    },
    batch(ids:string[],action:'suspend'|'resume'|'archive'|'trash'|'restore'|'reset'|'move'|'tag',value=''){return transaction(async()=>{
      if(ids.length>10_000)throw new Error('请分批处理卡片。');if(action==='move'&&!await db.decks.get(value))throw new Error('请选择卡组。');
      for(const c of(await db.cards.bulkGet(ids)).filter((c):c is MemoryCard=>!!c)){
        if(action==='suspend')c.suspended=true;if(action==='resume')c.suspended=false;if(action==='archive')c.archived=true;
        if(action==='trash')c.trashed=true;if(action==='restore'){c.trashed=false;c.archived=false;}
        if(action==='reset'){c.memory=freshMemory();delete c.lastLogId;}if(action==='move')c.deckId=value;
        c.deckArchived=(await db.decks.get(c.deckId))?.archived??false;c.eligible=c.suspended||c.archived||c.trashed||c.nodeHidden||c.deckArchived?0:1;c.revision++;c.updatedAt=now();await db.cards.put(c);
        if(action==='tag'){const n=await db.notes.get(c.noteId);if(n)await db.notes.update(n.id,{tags:[...new Set([...n.tags,...value.split(/[,，]/).map(x=>x.trim()).filter(Boolean)])],updatedAt:now(),revision:n.revision+1});}
      }await bridge();
    });},
    deleteCards(ids:string[]){return transaction(async()=>{
      const cards=(await db.cards.bulkGet(ids)).filter((c):c is MemoryCard=>!!c);if(cards.some(c=>!c.trashed))throw new Error('请先将卡片移入回收站。');
      const removedLogs=new Set<string>();for(const c of cards){const logs=await db.reviewLogs.where('cardId').equals(c.id).toArray();logs.forEach(l=>removedLogs.add(l.id));await db.reviewLogs.bulkDelete(logs.map(l=>l.id));}
      for(const s of await db.studySessions.toArray()){s.queue=s.queue.filter(id=>!ids.includes(id));if(s.lastLogId&&removedLogs.has(s.lastLogId))delete s.lastLogId;if(!s.queue.length)s.status='done';s.revision++;await db.studySessions.put(s);}
      await db.cards.bulkDelete(ids);await bridge();
    });},
    async addAttachment(file:File|Blob,name='图片'){
      if(file.size>10_000_000||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('请选择 10MB 内的 PNG、JPEG、WebP 或 GIF。');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
      return transaction(async()=>{const old=await db.attachments.where('hash').equals(hash).first();if(old)return old.id;
        const item={id:crypto.randomUUID(),hash,blob:file,mime:file.type as 'image/png',size:file.size,name,createdAt:now()};await db.attachments.add(item);return item.id;});
    },
    startSession(mode:ReviewSession['mode'],deckId?:string,nodeId?:string,override=false,focusId?:string){return transaction(async()=>{
      const active=await db.studySessions.where('status').equals('active').first();if(active)return active;
      const config=await settings(),journal=await db.journal.get('current'),zone=journal?.value.settings.zone??'UTC',date=clock(zone).date;
      const history=(await db.reviewLogs.where('reviewedAt').above(new Date(Date.now()-172800000).toISOString()).toArray()).filter(l=>l.formal&&!l.undone&&!l.excluded&&clock(zone,new Date(l.reviewedAt)).date===date);
      const doneNew=new Set(history.filter(l=>l.before.state===0).map(l=>l.cardId)).size,doneReviews=new Set(history.filter(l=>l.before.state!==0).map(l=>l.cardId)).size;
      let cards=deckId?await db.cards.where('deckId').equals(deckId).toArray():await db.cards.toArray();
      if(nodeId){const ids=new Set((await db.notes.where('nodeId').equals(nodeId).toArray()).map(n=>n.id));cards=cards.filter(c=>ids.has(c.noteId));}
      const practice=['practice','exam'].includes(mode);cards=cards.filter(c=>c.eligible&&(practice||c.memory.state===0||c.memory.due<=now()));
      if(mode==='weak')cards=cards.filter(c=>c.memory.lapses>0||c.memory.difficulty>=7);
      cards.sort((a,b)=>Number(a.memory.state===0)-Number(b.memory.state===0)||a.memory.due.localeCompare(b.memory.due)||a.id.localeCompare(b.id));
      if(!override&&!practice){
        const ids=new Set([...cards.filter(c=>c.memory.state!==0).slice(0,Math.max(0,config.reviewLimit-doneReviews)),
          ...cards.filter(c=>c.memory.state===0).slice(0,Math.max(0,config.newLimit-doneNew))].map(c=>c.id));cards=cards.filter(c=>ids.has(c.id));
      }
      const s:ReviewSession={...stamp(),mode,deckId,nodeId,queue:cards.map(c=>c.id),revealed:false,status:cards.length?'active':'done',shownAt:now(),resumedAt:now(),activeMs:0,cardMs:0,limitMinutes:config.minutes,focusId};
      await db.studySessions.add(s);return s;
    });},
    async recall(id:string){const session=await db.studySessions.get(id);if(!session)return null;const card=await nextCard(session);return{session,card,settings:await settings(),retention:card?(await db.decks.get(card.deckId))?.retention:undefined};},
    reveal(id:string,revision:number){return transaction(async()=>{
      const s=await db.studySessions.get(id);if(!s||s.revision!==revision)conflict();
      if(s.status!=='active'||!await nextCard(s))throw new Error('当前没有可揭晓的卡片。');
      await db.studySessions.update(id,{revealed:true,revision:revision+1,updatedAt:now()});
    });},
    grade(id:string,revision:number,cardId:string,cardRevision:number,rating:number,operationId:string){return transaction(async()=>{
      if(await db.reviewLogs.get(operationId))return;
      const s=await db.studySessions.get(id),c=await db.cards.get(cardId);
      if(!s||!c||s.revision!==revision||c.revision!==cardRevision)conflict();
      if(!s.revealed||s.status!=='active'||(await nextCard(s))?.id!==cardId)throw new Error('请先主动回忆并揭晓当前答案。');
      const config=await settings(),deck=await db.decks.get(c.deckId),formal=!['exam','practice'].includes(s.mode);
      const result=formal?schedule(c.memory,rating,new Date(),config,deck?.retention):{memory:c.memory,parameters:{}};
      if(!Number.isInteger(rating)||rating<1||rating>4)throw new Error('无效评分。');
      const log:MemoryLog={id:operationId,cardId,sessionId:id,rating,reviewedAt:now(),duration:Math.min(600000,(s.cardMs??0)+Math.max(0,Date.now()-Date.parse(s.shownAt))),
        formal,dueReview:formal&&c.memory.state===2&&c.memory.due<=now(),before:c.memory,after:result.memory,parentLogId:c.lastLogId,
        previousLogId:s.lastLogId,revision:c.revision+1,undone:false,updatedAt:now(),algorithm:config.algorithm,parameters:{...result.parameters},queuePosition:Math.max(0,s.queue.indexOf(cardId)),queueBefore:[],lastNoteBefore:s.lastNoteId};
      await db.reviewLogs.add(log);
      if(formal)await db.cards.update(cardId,{memory:result.memory,revision:c.revision+1,lastLogId:log.id,updatedAt:now()});
      s.queue=s.queue.filter(item=>item!==cardId);
      if(formal&&(result.memory.state===1||result.memory.state===3))s.queue.push(cardId);
      Object.assign(s,{revealed:false,revision:s.revision+1,lastNoteId:c.noteId,lastLogId:log.id,updatedAt:now(),shownAt:now(),cardMs:0});
      if(!s.queue.length){s.status='done';s.endedAt=now();}await db.studySessions.put(s);await bridge();
    });},
    undo(id:string,revision:number){return transaction(async()=>{
      const s=await db.studySessions.get(id);if(!s||s.revision!==revision)conflict();
      const log=s.lastLogId?await db.reviewLogs.get(s.lastLogId):undefined;if(!log||log.undone)throw new Error('没有可撤销的评分。');
      const c=await db.cards.get(log.cardId);if(!c||log.formal&&c.lastLogId!==log.id)conflict();
      if(log.formal)await db.cards.update(c.id,{memory:log.before,lastLogId:log.parentLogId,revision:c.revision+1,updatedAt:now()});
      await db.reviewLogs.update(log.id,{undone:true,updatedAt:now()});
      await db.studySessions.update(id,{queue:log.queuePosition!==undefined?(()=>{const q=s.queue.filter(id=>id!==log.cardId);q.splice(log.queuePosition,0,log.cardId);return q;})():(await db.cards.bulkGet(log.queueBefore)).filter((c):c is MemoryCard=>!!c).map(c=>c.id),revealed:false,lastNoteId:log.lastNoteBefore,lastLogId:log.previousLogId,status:'active',
        endedAt:undefined,revision:revision+1,shownAt:now(),resumedAt:now(),cardMs:0,updatedAt:now()});const journal=await db.journal.get('current');await bridge(clock(journal?.value.settings.zone??'UTC',new Date(log.reviewedAt)).date);
    });},
    pause(id:string){return transaction(async()=>{const s=await db.studySessions.get(id);if(s)await db.studySessions.update(id,{status:'paused',revealed:false,activeMs:(s.activeMs??0)+Math.max(0,Date.now()-Date.parse(s.resumedAt??s.createdAt)),cardMs:(s.cardMs??0)+Math.max(0,Date.now()-Date.parse(s.shownAt)),revision:s.revision+1,updatedAt:now()});});},
    resume(id:string){return transaction(async()=>{if(await db.studySessions.where('status').equals('active').count())throw new Error('请先退出当前复习会话。');
      const s=await db.studySessions.get(id);if(s)await db.studySessions.update(id,{status:'active',shownAt:now(),resumedAt:now(),activeMs:s.mode==='focus'&&(s.activeMs??0)>=s.limitMinutes*60000?0:s.activeMs,revision:s.revision+1,updatedAt:now()});});},
  };
}
