import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {createRepository} from '../repository';
import {JournalDatabase} from '../database';
import {emptySnapshot} from '../model';
import {createMemoryRepository,stamp,blankNote,blankNode} from './repository';
import {defaultSettings,validateMemory,type MemoryNote} from './model';
import {freshMemory,predictions,schedule} from './scheduler';
import {parseMarkdown,templates,parseDelimited} from './content';
import {capture,restoreFull,importDelimited,previewDelimited,HistoryConflict,exportZip,readBackupFile} from './exchange';
import {recallRate,studyFacts,learningGoalValues} from './analytics';
let repo:ReturnType<typeof createRepository>,m:ReturnType<typeof createMemoryRepository>,name:string,deck:string;
beforeEach(async()=>{name='memoria-test-'+crypto.randomUUID();repo=createRepository(name);m=createMemoryRepository(repo.database);const d={...stamp(),name:'学习',archived:false};await m.saveDeck(d);deck=d.id;});
afterEach(async()=>{repo.close();await Dexie.delete(name);});
async function note(type:MemoryNote['type']='basic',front='问题',back='答案'){return m.saveNote({...blankNote(deck),type,front,back});}
async function grade(rating=3){const s=await m.startSession('daily');await m.reveal(s.id,s.revision);const r=(await m.recall(s.id))!;await m.grade(s.id,r.session.revision,r.card!.id,r.card!.revision,rating,crypto.randomUUID());return s.id;}
it('matches real ts-fsrs predictions and keeps algorithm state',()=>{
  const now=new Date('2026-11-26T10:00:00Z'),state=freshMemory(now),config=defaultSettings();
  const next=predictions(state,now,config);expect(new Set(next.map(c=>c.due)).size).toBeGreaterThan(1);
  expect(schedule(state,3,now,config).memory).toEqual(next[2]);expect(next[2].reps).toBe(1);expect(next[2].stability).toBeGreaterThan(0);
});
it('all six note types generate independent stable template keys',()=>{
  const base=blankNote(deck);expect(templates({...base,front:'A',back:'B'})).toHaveLength(1);
  expect(templates({...base,type:'bidirectional',front:'A',back:'B'}).map(c=>c.key)).toEqual(['forward','reverse']);
  expect(templates({...base,type:'cloze',front:'{{c1::A}} {{c1::B}} {{c2::C::提示}}'}).map(c=>c.key)).toEqual(['cloze-1','cloze-2']);
  expect(templates({...base,type:'concept',front:'概念',back:'解释'})).toHaveLength(1);
  expect(templates({...base,type:'code',front:'输出？',back:'~~~python\n1+1\n~~~'})).toHaveLength(1);
  expect(templates({...base,type:'image',attachmentId:'image',regions:[{id:'r',x:0,y:0,w:.4,h:.4}]})).toHaveLength(1);
});
it('edits preserve card IDs and FSRS unless explicitly reset',async()=>{
  const n=await note();const id=await grade(4),before=(await m.db.cards.toArray())[0];
  const updated=await m.saveNote({...n,front:'修改后的问题'});const after=(await m.db.cards.toArray())[0];
  expect(after.id).toBe(before.id);expect(after.memory).toEqual(before.memory);expect(after.front).toBe(updated.front);
  await m.batch([after.id],'reset');expect((await m.db.cards.get(after.id))!.memory.reps).toBe(0);expect(await m.db.reviewLogs.count()).toBe(1);expect(id).toBeTruthy();
});
it('rejects hidden grading and atomically prevents cross-tab double ratings',async()=>{
  await note();const s=await m.startSession('daily'),r=(await m.recall(s.id))!;
  await expect(m.grade(s.id,s.revision,r.card!.id,r.card!.revision,3,'hidden')).rejects.toThrow(/揭晓/);expect(await m.db.reviewLogs.count()).toBe(0);
  await m.reveal(s.id,s.revision);const shown=(await m.recall(s.id))!,other=createMemoryRepository(m.db);
  const a=()=>[s.id,shown.session.revision,shown.card!.id,shown.card!.revision,3,crypto.randomUUID()] as const;
  const results=await Promise.allSettled([m.grade(...a()),other.grade(...a())]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await m.db.reviewLogs.count()).toBe(1);
  const log=(await m.db.reviewLogs.toArray())[0];await m.grade(s.id,0,log.cardId,0,3,log.id);expect(await m.db.reviewLogs.count()).toBe(1);
});
it('undo restores full memory and permits replacement rating',async()=>{
  await note();const original=(await m.db.cards.toArray())[0],id=await grade(4),s=(await m.recall(id))!.session;
  await m.undo(id,s.revision);expect((await m.db.cards.get(original.id))!.memory).toEqual(original.memory);
  expect(recallRate(await m.db.reviewLogs.toArray()).total).toBe(0);
  const r=(await m.recall(id))!;expect(r.card!.id).toBe(original.id);await m.reveal(id,r.session.revision);
  const shown=(await m.recall(id))!;await m.grade(id,shown.session.revision,original.id,shown.card!.revision,2,crypto.randomUUID());
  expect((await m.db.reviewLogs.toArray()).filter(l=>!l.undone)).toHaveLength(1);
});
it('practice and exam logs never alter formal memory or formal statistics',async()=>{
  await note();for(const mode of ['practice','exam'] as const){const s=await m.startSession(mode);await m.reveal(s.id,s.revision);const r=(await m.recall(s.id))!;await m.grade(s.id,r.session.revision,r.card!.id,r.card!.revision,1,crypto.randomUUID());}
  expect((await m.db.cards.toArray())[0].memory.reps).toBe(0);expect((await studyFacts(m.db)).reviewCount).toBe(0);
});
it('daily limit is explicit while overview retains backlog',async()=>{
  await m.saveSettings({...defaultSettings(),newLimit:1});await note('basic','A','B');await note('basic','C','D');
  expect((await m.overview()).newCards).toBe(2);const s=await m.startSession('daily');expect(s.queue).toHaveLength(1);
  await m.pause(s.id);const all=await m.startSession('daily',undefined,undefined,true);expect(all.queue).toHaveLength(2);
});
it('siblings are separated when an unrelated card is available and sessions resume',async()=>{
  await note('bidirectional','A','B');await note('basic','C','D');const s=await m.startSession('daily');
  const first=(await m.recall(s.id))!.card!;await m.reveal(s.id,s.revision);const shown=(await m.recall(s.id))!;
  await m.grade(s.id,shown.session.revision,first.id,first.revision,4,crypto.randomUUID());
  expect((await m.recall(s.id))!.card!.noteId).not.toBe(first.noteId);
  await m.pause(s.id);await m.resume(s.id);expect((await m.recall(s.id))!.session.status).toBe('active');
});
it('Markdown parsing ignores code, deduplicates, and retains identities after reorder',()=>{
  const first=parseMarkdown('Q >> A\nX <> Y\nQ >> A\n~~~js\nF >> G\n~~~\n{{c1::hello}}');
  expect(first.errors).toEqual([]);expect(first.parsed).toHaveLength(3);
  const blocks=first.parsed.map(p=>({id:p.blockId,nodeId:'n',content:p.line,order:p.order,type:'card' as const}));
  const next=parseMarkdown('X <> Y\nQ >> B\n{{c1::hello}}',blocks);
  expect(next.parsed[0].blockId).toBe(first.parsed[1].blockId);expect(next.parsed[1].blockId).toBe(first.parsed[0].blockId);
});
it('knowledge save creates stable cards, versions, backlinks and rejects cycles atomically',async()=>{
  const a=await m.saveNode({...blankNode(),title:'A',body:'Q >> A'},true),b=await m.saveNode({...blankNode(),title:'B',body:'[[A]]'});
  const first=(await m.db.cards.toArray())[0];const edited=await m.saveNode({...a,body:'Q >> B'},true);
  expect((await m.db.cards.toArray())[0].id).toBe(first.id);expect(edited.versions).toHaveLength(1);expect(await m.db.knowledgeLinks.count()).toBe(1);
  const moved=await m.saveNode({...edited,parentId:b.id});await expect(m.saveNode({...b,parentId:moved.id})).rejects.toThrow(/循环/);
  expect((await m.db.knowledgeNodes.get(b.id))!.parentId).toBeUndefined();
});
it('node/deck archival excludes reviews while preserving memory and explicit card suspension',async()=>{
  const n=await m.saveNode({...blankNode(),title:'节点'});await m.saveNote({...blankNote(deck,n.id),front:'Q',back:'A'});
  let card=(await m.db.cards.toArray())[0];await m.saveNode({...n,trashed:true});expect((await m.overview()).newCards).toBe(0);
  const updated=(await m.db.knowledgeNodes.get(n.id))!;await m.saveNode({...updated,trashed:false});expect((await m.overview()).newCards).toBe(1);
  await m.batch([card.id],'suspend');const d=(await m.db.decks.get(deck))!;await m.saveDeck({...d,archived:true});await m.saveDeck({...d,revision:d.revision+1,archived:false});
  card=(await m.db.cards.get(card.id))!;expect(card.suspended).toBe(true);expect(card.eligible).toBe(0);
});
it('CSV supports multiline quoting, mapping, dedupe and all-or-nothing validation',async()=>{
  const text='answer,question\n"two\nlines","Q, with comma"\n"two\nlines","Q, with comma"';
  expect(parseDelimited(text)[1]).toEqual(['two\nlines','Q, with comma']);expect(previewDelimited(text,1,0).duplicates).toBe(1);
  expect(await importDelimited(m.db,text,deck,1,0)).toEqual({added:1,skipped:1});expect((await importDelimited(m.db,text,deck,1,0)).added).toBe(0);
  await expect(importDelimited(m.db,'front,back\nvalid,answer\nmissing,',deck)).rejects.toThrow(/缺少/);expect(await m.db.notes.count()).toBe(1);
});
it('JSON and ZIP preserve local image bytes and reject corrupted attachments before writes',async()=>{
  const blob=new Blob([new Uint8Array([1,2,3,4])],{type:'image/png'}),id=await m.addAttachment(blob,'test.png');await m.saveNote({...blankNote(deck),type:'image',attachmentId:id,regions:[{id:'r',x:0,y:0,w:.3,h:.2}]});
  const saved=await capture(m.db);validateMemory(saved.memory);const zip=await exportZip(m.db),parsed=await readBackupFile(new File([zip as BlobPart],'backup.zip'));
  expect(parsed.memory.attachments[0].data).toBe(saved.memory.attachments[0].data);await restoreFull(m.db,parsed,'replace');expect((await m.db.attachments.get(id))!.blob.size).toBe(4);
  const bad=structuredClone(saved);bad.memory.attachments[0].data='AAAA';await expect(restoreFull(m.db,bad,'replace')).rejects.toThrow(/校验/);expect(await m.db.cards.count()).toBe(1);
});
it('backup merge detects divergent review histories before mutation and keeps only selected statistics',async()=>{
  await note();const original=await capture(m.db);await grade(4);const local=await capture(m.db);
  await restoreFull(m.db,original,'replace');await grade(2);const incoming=await capture(m.db);await restoreFull(m.db,local,'replace');
  await expect(restoreFull(m.db,incoming,'merge')).rejects.toBeInstanceOf(HistoryConflict);expect(await m.db.reviewLogs.count()).toBe(1);
  await restoreFull(m.db,incoming,'merge','local');expect(await m.db.reviewLogs.count()).toBe(2);expect((await studyFacts(m.db)).reviewCount).toBe(1);
});
it('learned old cards alone form actual recall denominator',()=>{
  const base={formal:true,undone:false,dueReview:true,rating:3} as Parameters<typeof recallRate>[0][number];
  expect(recallRate([base,{...base,rating:1},{...base,formal:false},{...base,dueReview:false},{...base,undone:true}])).toEqual({total:2,success:1,rate:.5});
});
it('automatic habits undo safely and never override manual records',async()=>{
  const today=new Date().toISOString().slice(0,10);await repo.saveSettings({...emptySnapshot().settings,zone:'UTC'});
  await repo.saveHabit({name:'复习',description:'',icon:'book',color:'lilac',category:'学习',startDate:today,schedule:{type:'daily',weekdays:[]},reminderEnabled:false,reminderTime:'10:00',measurement:{unit:'张',minimum:1}});
  const habit=(await repo.read()).habits[0];await m.saveRule({...stamp(),habitId:habit.id,metric:'reviews',target:1,enabled:true});await note();const id=await grade(4);
  expect((await repo.read()).entries[0]).toMatchObject({completed:true,source:'memoria'});
  await m.undo(id,(await m.recall(id))!.session.revision);expect((await repo.read()).entries[0].completed).toBe(false);
  await repo.setEntry(habit.id,today,true,false,{quantity:5});await m.refreshBridge();expect((await repo.read()).entries[0]).toMatchObject({quantity:5,source:'manual'});
});
it('learning goals derive from real data and focus-linked review time is deduplicated',async()=>{
  await note();const id=await grade(4);const snapshot=await repo.read();
  const now=new Date().toISOString(),focusId='focus';snapshot.sessions.push({id:focusId,mode:'focus',deckId:deck,startedAt:now,endedAt:now,plannedSeconds:600,actualSeconds:600,completed:true});
  await m.db.journal.put({id:'current',value:snapshot});await m.db.studySessions.update(id,{focusId});await m.db.reviewLogs.toCollection().modify({duration:120000});
  expect((await studyFacts(m.db)).minutes).toBe(10);
  await repo.saveGoal({title:'复习一次',description:'',habitIds:[],goalType:'reviews',targetValue:1,startDate:now.slice(0,10),studyDeckId:deck});
  const current=await repo.read();expect((await learningGoalValues(m.db,current))[current.goals[0].id]).toBe(1);
});
it('upgrades a real V2 IndexedDB without altering its snapshot',async()=>{
  const oldName='v2-'+crypto.randomUUID(),v2=new Dexie(oldName);v2.version(2).stores({journal:'id'});const snapshot=emptySnapshot();await v2.table('journal').put({id:'current',value:snapshot});v2.close();
  const upgraded=new JournalDatabase(oldName);await upgraded.open();expect((await upgraded.journal.get('current'))!.value).toEqual(snapshot);expect(upgraded.verno).toBe(3);expect(await upgraded.cards.count()).toBe(0);upgraded.close();await Dexie.delete(oldName);
});

it('undo after midnight repairs the original habit day',async()=>{
  const {vi}=await import('vitest');vi.useFakeTimers({toFake:['Date']});
  try{
    vi.setSystemTime(new Date('2026-11-26T23:59:00Z'));await repo.saveSettings({...emptySnapshot().settings,zone:'UTC'});
    await repo.saveHabit({name:'跨日复习',description:'',icon:'book',color:'lilac',category:'学习',startDate:'2026-11-26',schedule:{type:'daily',weekdays:[]},reminderEnabled:false,reminderTime:'10:00',measurement:{unit:'张',minimum:1}});
    const h=(await repo.read()).habits[0];await m.saveRule({...stamp(),habitId:h.id,metric:'reviews',target:1,enabled:true});await note();const id=await grade(4);
    vi.setSystemTime(new Date('2026-11-27T00:01:00Z'));await m.undo(id,(await m.recall(id))!.session.revision);
    expect((await repo.read()).entries.find(e=>e.date==='2026-11-26')).toMatchObject({completed:false,source:'memoria'});
  }finally{vi.useRealTimers();}
});
it('removing generated syntax suspends obsolete cards and retains archived history',async()=>{
  let node=await m.saveNode({...blankNode(),title:'语法',body:'Q >> A'},true);const original=(await m.db.cards.toArray())[0];
  node=await m.saveNode({...node,body:'普通段落'});expect((await m.overview()).newCards).toBe(0);
  await m.saveNode({...node,body:'Q >> A'},true);
  const cards=await m.db.cards.toArray();expect(cards.filter(c=>c.eligible)).toHaveLength(1);
  // The source block itself was removed, so restoring text produces a new source identity.
  expect(cards.find(c=>c.id===original.id)?.eligible).toBe(0);
  expect(await m.db.knowledgeBlocks.toCollection().filter(b=>b.type==='markdown').count()).toBeGreaterThan(0);
});
