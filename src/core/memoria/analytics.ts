import type {JournalDatabase} from '../database';
import {clock,addDays} from '../dates';
import {engine,deserialize} from './scheduler';
import {defaultSettings} from './model';
import type {MemoryLog} from './model';
export function recallRate(logs:MemoryLog[]){const due=logs.filter(l=>l.formal&&!l.undone&&!l.excluded&&l.dueReview);return{total:due.length,success:due.filter(l=>l.rating>=2).length,rate:due.length?due.filter(l=>l.rating>=2).length/due.length:null};}
export async function studyFacts(db:JournalDatabase,start?:string,end?:string){
  const row=await db.journal.get('current'),zone=row?.value.settings.zone??'UTC',today=clock(zone).date;
  const [cards,all,sessions,notes]=await Promise.all([db.cards.toArray(),db.reviewLogs.toArray(),db.studySessions.toArray(),db.knowledgeNodes.toArray()]);
  const active=cards.filter(c=>!c.trashed&&!c.archived),logs=all.filter(l=>!l.undone&&!l.excluded&&l.formal&&(!start||clock(zone,new Date(l.reviewedAt)).date>=start)&&(!end||clock(zone,new Date(l.reviewedAt)).date<=end));
  const completed=row?.value.sessions.filter(s=>s.completed&&(!start||clock(zone,new Date(s.endedAt)).date>=start)&&(!end||clock(zone,new Date(s.endedAt)).date<=end))??[];
  const linked=new Set(sessions.filter(s=>s.focusId&&completed.some(f=>f.id===s.focusId)).map(s=>s.id));
  const minutes=logs.filter(l=>!linked.has(l.sessionId)).reduce((n,l)=>n+l.duration/60000,0)+completed.filter(f=>f.deckId||f.nodeId).reduce((n,f)=>n+f.actualSeconds/60,0);
  const day=(instant:string)=>clock(zone,new Date(instant)).date;
  const dueCounts=new Map<string,number>();for(const c of active.filter(c=>c.eligible&&c.memory.state>0)){const key=day(c.memory.due)<=today?today:day(c.memory.due);dueCounts.set(key,(dueCounts.get(key)??0)+1);}
  const logCounts=new Map<string,number>();for(const log of logs){const key=day(log.reviewedAt);logCounts.set(key,(logCounts.get(key)??0)+1);}
  const forecast=Array.from({length:14},(_,i)=>{const date=addDays(today,i);return{date,count:dueCounts.get(date)??0};});
  const heatmap=Array.from({length:84},(_,i)=>{const date=addDays(today,i-83);return{date,count:logCounts.get(date)??0};});
  const config=await db.memorySettings.get('current')??defaultSettings();
  const scheduler=engine(config),at=new Date();
  const predicted=active.filter(c=>c.memory.state===2&&c.memory.last_review).map(c=>Number(scheduler.get_retrievability(deserialize(c.memory),at,false)));
  return{logs,cards:active,notes:notes.filter(n=>!n.trashed),minutes,reviewCount:logs.length,unique:new Set(logs.map(l=>l.cardId)).size,rate:recallRate(logs),
    mature:active.filter(c=>c.memory.state===2&&c.memory.stability>=21).length,forecast,heatmap,
    predicted:predicted.length?predicted.reduce((n,v)=>n+v,0)/predicted.length:null,
    distribution:[0,1,2,3].map(state=>active.filter(c=>c.memory.state===state).length),
    lapses:active.filter(c=>c.memory.lapses>0).sort((a,b)=>b.memory.lapses-a.memory.lapses).slice(0,10)};
}

export async function learningGoalValues(db:JournalDatabase,journal:import('../model').Snapshot){
  const goals=journal.goals.filter(g=>['studyMinutes','reviews','matureCards','recallRate'].includes(g.goalType));if(!goals.length)return{} as Record<string,number|null>;
  const facts=await studyFacts(db),notes=await db.notes.toArray(),sessions=await db.studySessions.toArray(),values:Record<string,number|null>={};
  for(const goal of goals){
    const cards=facts.cards.filter(c=>!goal.studyDeckId||c.deckId===goal.studyDeckId),ids=new Set(cards.map(c=>c.id));
    const logs=facts.logs.filter(l=>ids.has(l.cardId)&&clock(journal.settings.zone,new Date(l.reviewedAt)).date>=goal.startDate&&(!goal.endDate||clock(journal.settings.zone,new Date(l.reviewedAt)).date<=goal.endDate));
    if(goal.goalType==='reviews')values[goal.id]=logs.length;
    if(goal.goalType==='matureCards')values[goal.id]=cards.filter(c=>c.memory.state===2&&c.memory.stability>=21).length;
    if(goal.goalType==='recallRate'){const rate=recallRate(logs).rate;values[goal.id]=rate===null?null:rate*100;}
    if(goal.goalType==='studyMinutes'){
      const focus=journal.sessions.filter(f=>f.completed&&(f.deckId||f.nodeId)&&(!goal.studyDeckId||f.deckId===goal.studyDeckId||notes.some(n=>n.nodeId===f.nodeId&&n.deckId===goal.studyDeckId))&&clock(journal.settings.zone,new Date(f.endedAt)).date>=goal.startDate&&(!goal.endDate||clock(journal.settings.zone,new Date(f.endedAt)).date<=goal.endDate));
      const linked=new Set(sessions.filter(s=>focus.some(f=>f.id===s.focusId)).map(s=>s.id));
      values[goal.id]=Math.round((logs.filter(l=>!linked.has(l.sessionId)).reduce((s,l)=>s+l.duration/60000,0)+focus.reduce((s,f)=>s+f.actualSeconds/60,0))*10)/10;
    }
  }return values;
}
