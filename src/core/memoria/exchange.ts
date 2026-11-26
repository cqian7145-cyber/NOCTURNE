import {z} from 'zod';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import type {JournalDatabase} from '../database';
import {snapshotSchema,mergeBackup,emptySnapshot} from '../model';
import {emptyMemory,memoryBackupSchema,validateMemory,type MemoryBackup} from './model';
import {parseDelimited,templates} from './content';
import {blankNote,stamp} from './repository';
import {freshMemory} from './scheduler';

const envelope=z.object({version:z.literal(3),exportedAt:z.iso.datetime(),journal:snapshotSchema,memory:memoryBackupSchema});
export type FullBackup=z.infer<typeof envelope>;
const pairs=[['nodes','knowledgeNodes'],['blocks','knowledgeBlocks'],['decks','decks'],['notes','notes'],['cards','cards'],['logs','reviewLogs'],['sessions','studySessions'],['links','knowledgeLinks'],['rules','studyRules']] as const;
function crossValidate(data:FullBackup){
  validateMemory(data.memory);
  const habits=new Set(data.journal.habits.map(h=>h.id)),domains=new Set(data.journal.domains.map(d=>d.id)),decks=new Set(data.memory.decks.map(d=>d.id)),nodes=new Set(data.memory.nodes.map(n=>n.id));
  if(data.memory.rules.some(r=>!habits.has(r.habitId)||r.deckId&&!decks.has(r.deckId))||data.memory.nodes.some(n=>n.domainId&&!domains.has(n.domainId)))throw new Error('备份的习惯或领域关联缺失。');
  if([...data.journal.sessions,...(data.journal.timer?[data.journal.timer]:[])].some(s=>s.deckId&&!decks.has(s.deckId)||s.nodeId&&!nodes.has(s.nodeId)))throw new Error('专注的学习关联缺失。');
}
export function parseFull(text:string):FullBackup{
  if(text.length>200_000_000)throw new Error('备份超过 200MB，请使用 ZIP。');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('请选择有效的 JSON 备份。');}
  const result=typeof raw==='object'&&raw!==null&&'version'in raw&&raw.version===3?envelope.parse(raw):
    {version:3 as const,exportedAt:new Date().toISOString(),journal:snapshotSchema.parse(raw),memory:emptyMemory()};
  crossValidate(result);return result;
}
const b64=(bytes:Uint8Array)=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
async function attachmentBlob(item:MemoryBackup['attachments'][number]){
  if(!item.data)throw new Error('附件内容缺失：'+item.name);
  const binary=atob(item.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.length!==item.size)throw new Error('附件长度校验失败。');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==item.hash)throw new Error('附件内容校验失败。');return new Blob([bytes],{type:item.mime});
}
export async function capture(db:JournalDatabase):Promise<FullBackup>{
  const snapshot=await db.transaction('r',db.tables,async()=>{
    const memory=emptyMemory();for(const [key,table]of pairs)Object.assign(memory,{[key]:await db.table(table).toArray()});
    memory.settings=await db.memorySettings.get('current')??memory.settings;
    const files=await db.attachments.toArray();
    memory.attachments=files.map(a=>({id:a.id,mime:a.mime,size:a.size,hash:a.hash,name:a.name,createdAt:a.createdAt}));
    return{data:{version:3 as const,exportedAt:new Date().toISOString(),journal:(await db.journal.get('current'))?.value??emptySnapshot(),memory},files};
  });
  for(const item of snapshot.data.memory.attachments){const blob=snapshot.files.find(f=>f.id===item.id)!.blob;item.data=b64(new Uint8Array(await blob.arrayBuffer()));}
  return snapshot.data;
}
function combine<T extends{id:string}>(a:T[],b:T[],incoming:boolean){const map=new Map(a.map(x=>[x.id,x]));for(const x of b){const old=map.get(x.id);if(!old||incoming)map.set(x.id,x);}return[...map.values()];}
export class HistoryConflict extends Error{constructor(public cards:string[]){super(cards.length+' 张卡片存在分叉的复习历史。请选择保留本地或导入版本。');}}
export async function restoreFull(db:JournalDatabase,input:FullBackup,mode:'merge'|'replace',choice?:'local'|'incoming'){
  const parsed=envelope.parse(input);crossValidate(parsed);
  const attachments=await Promise.all(parsed.memory.attachments.map(async meta=>{return{id:meta.id,mime:meta.mime,size:meta.size,hash:meta.hash,name:meta.name,createdAt:meta.createdAt,blob:await attachmentBlob(meta)};}));
  return db.transaction('rw',db.tables,async()=>{
    let result=parsed;
    if(mode==='merge'){
      const current=emptyMemory();for(const[key,table]of pairs)Object.assign(current,{[key]:await db.table(table).toArray()});
      current.settings=await db.memorySettings.get('current')??current.settings;
      current.attachments=(await db.attachments.toArray()).map(a=>({id:a.id,mime:a.mime,size:a.size,hash:a.hash,name:a.name,createdAt:a.createdAt}));
      const localMap=new Map(current.cards.map(c=>[c.id,c])),allLogs=new Map([...current.logs,...parsed.memory.logs].map(l=>[l.id,l]));
      const ancestor=(a:string|undefined,b:string|undefined)=>{const seen=new Set<string>();while(b&&!seen.has(b)){if(b===a)return true;seen.add(b);b=allLogs.get(b)?.parentLogId;}return !a;};
      const conflicts=parsed.memory.cards.filter(c=>{const old=localMap.get(c.id);return old&&old.lastLogId!==c.lastLogId&&!ancestor(old.lastLogId,c.lastLogId)&&!ancestor(c.lastLogId,old.lastLogId);}).map(c=>c.id);
      // Same log pointer with divergent state (reset, undo or editing on two devices) also needs a choice.
      for(const card of parsed.memory.cards){const old=localMap.get(card.id);if(old&&old.lastLogId===card.lastLogId&&JSON.stringify(old.memory)!==JSON.stringify(card.memory))conflicts.push(card.id);}
      if(conflicts.length&&!choice)throw new HistoryConflict([...new Set(conflicts)]);
      const memory=emptyMemory();
      for(const[key]of pairs)Object.assign(memory,{[key]:combine(current[key] as {id:string}[],parsed.memory[key] as {id:string}[],choice==='incoming')});
      memory.cards=combine(current.cards,parsed.memory.cards,false).map(old=>{
        const incoming=parsed.memory.cards.find(c=>c.id===old.id);if(!incoming)return old;
        if(conflicts.includes(old.id))return choice==='incoming'?incoming:old;
        return ancestor(old.lastLogId,incoming.lastLogId)&&old.lastLogId!==incoming.lastLogId?incoming:old;
      });
      const conflicting=new Set(conflicts);
      memory.logs=memory.logs.map(log=>{if(!log.formal||!conflicting.has(log.cardId))return log;const card=memory.cards.find(c=>c.id===log.cardId)!;return{...log,excluded:!ancestor(log.id,card.lastLogId)&&!log.undone};});
      memory.attachments=combine(current.attachments,parsed.memory.attachments,choice==='incoming');
      memory.settings=choice==='incoming'?parsed.memory.settings:current.settings;
      result={...parsed,journal:mergeBackup((await db.journal.get('current'))?.value??emptySnapshot(),parsed.journal),memory};crossValidate(result);
    }else for(const table of db.tables)await table.clear();
    await db.journal.put({id:'current',value:result.journal});
    for(const[key,table]of pairs)await db.table(table).bulkPut(result.memory[key]);
    await db.attachments.bulkPut(attachments.filter(a=>result.memory.attachments.find(meta=>meta.id===a.id)?.hash===a.hash));await db.memorySettings.put(result.memory.settings);
  });
}
export async function exportZip(db:JournalDatabase){
  const data=await capture(db),files:Record<string,Uint8Array>={};
  for(const item of data.memory.attachments){files['attachments/'+item.id]=Uint8Array.from(atob(item.data!),c=>c.charCodeAt(0));delete item.data;}
  files['nocturne.json']=strToU8(JSON.stringify(data));return zipSync(files,{level:4});
}
export async function readBackupFile(file:File){
  if(file.size>200_000_000)throw new Error('备份超过 200MB。');
  if(!file.name.toLowerCase().endsWith('.zip'))return parseFull(await file.text());
  let bytes=0;
  const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:f=>{bytes+=f.originalSize;if(bytes>250_000_000)throw new Error('解压后超过容量限制。');return f.name==='nocturne.json'||/^attachments\/[\w-]+$/.test(f.name);}});
  if(!files['nocturne.json'])throw new Error('ZIP 缺少 nocturne.json。');
  const raw=JSON.parse(strFromU8(files['nocturne.json']));
  for(const item of raw.memory?.attachments??[]){const data=files['attachments/'+item.id];if(!data)throw new Error('ZIP 缺少附件。');item.data=b64(data);}
  return parseFull(JSON.stringify(raw));
}
export function previewDelimited(text:string,front=0,back=1,header=true){
  const rows=parseDelimited(text),items=rows.slice(header?1:0),seen=new Set<string>(),errors:string[]=[];
  const valid=items.flatMap((r,i)=>{const a=r[front]?.trim(),b=r[back]?.trim();if(!a||!b){errors.push('第 '+(i+(header?2:1))+' 行缺少问题或答案');return[];}
    const key=JSON.stringify([a,b]);if(seen.has(key))return[];seen.add(key);return[{front:a,back:b}];});
  return{headers:rows[0]??[],valid,errors,duplicates:items.length-valid.length-errors.length};
}
export async function importDelimited(db:JournalDatabase,text:string,deckId:string,front=0,back=1,header=true){
  const result=previewDelimited(text,front,back,header);if(result.errors.length)throw new Error(result.errors.join('；'));
  return db.transaction('rw',[db.decks,db.notes,db.cards],async()=>{
    if(!await db.decks.get(deckId))throw new Error('请选择有效卡组。');
    const previous=new Set((await db.notes.where('deckId').equals(deckId).toArray()).map(n=>JSON.stringify([n.front,n.back])));let added=0;
    for(const row of result.valid){const key=JSON.stringify([row.front,row.back]);if(previous.has(key))continue;previous.add(key);
      const note={...blankNote(deckId),...row};await db.notes.add(note);
      for(const t of templates(note))await db.cards.add({...stamp(),noteId:note.id,deckId,templateKey:t.key,front:t.front,back:t.back,memory:freshMemory(),eligible:1,suspended:false,archived:false,trashed:false});added++;}
    return{added,skipped:result.valid.length-added+result.duplicates};
  });
}
export function exportCSV(rows:{front:string;back:string}[],delimiter=','){const cell=(s:string)=>'"'+s.replace(/"/g,'""')+'"';return[['front','back'],...rows.map(c=>[c.front,c.back])].map(r=>r.map(cell).join(delimiter)).join('\r\n');}
