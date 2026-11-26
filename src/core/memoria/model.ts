import { z } from 'zod';
const id=z.string().regex(/^[\w-]{1,120}$/), text=z.string().max(200_000), instant=z.iso.datetime();
const stamp={id,createdAt:instant,updatedAt:instant,revision:z.number().int().nonnegative()};
const flags={archived:z.boolean(),trashed:z.boolean(),favorite:z.boolean()};
export const memorySchema=z.object({due:instant,stability:z.number().finite().nonnegative(),difficulty:z.number().finite().min(0).max(10),
  elapsed_days:z.number().nonnegative(),scheduled_days:z.number().nonnegative(),learning_steps:z.number().int().nonnegative(),
  reps:z.number().int().nonnegative(),lapses:z.number().int().nonnegative(),state:z.number().int().min(0).max(3),last_review:instant.optional()});
export const nodeSchema=z.object({...stamp,...flags,title:z.string().trim().min(1).max(160),body:text,parentId:id.optional(),domainId:id.optional(),
  tags:z.array(z.string().max(60)).max(100),source:z.string().max(1000),versions:z.array(z.object({body:text,title:z.string(),savedAt:instant})).max(60)});
export const deckSchema=z.object({...stamp,name:z.string().trim().min(1).max(120),parentId:id.optional(),archived:z.boolean(),retention:z.number().min(.7).max(.97).optional()});
export const regionSchema=z.object({id,x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)})
  .refine(r=>r.x+r.w<=1.001&&r.y+r.h<=1.001,'遮挡区域超出图片');
export const noteSchema=z.object({...stamp,...flags,deckId:id,nodeId:id.optional(),type:z.enum(['basic','bidirectional','cloze','concept','code','image']),
  front:text,back:text,extra:text,hint:z.string().max(1000),tags:z.array(z.string().max(60)).max(100),source:z.string().max(1000),
  attachmentId:id.optional(),regions:z.array(regionSchema).max(100),origin:z.string().max(250).optional()});
export const cardSchema=z.object({...stamp,noteId:id,deckId:id,templateKey:z.string().max(100),front:text,back:text,
  attachmentId:id.optional(),region:regionSchema.optional(),memory:memorySchema,eligible:z.union([z.literal(0),z.literal(1)]),
  obsolete:z.boolean().optional(),nodeHidden:z.boolean().optional(),deckArchived:z.boolean().optional(),suspended:z.boolean(),archived:z.boolean(),trashed:z.boolean(),lastLogId:id.optional()});
export const sessionSchema=z.object({...stamp,mode:z.enum(['daily','deck','weak','exam','practice','focus']),deckId:id.optional(),nodeId:id.optional(),
  activeMs:z.number().nonnegative().optional(),cardMs:z.number().nonnegative().optional(),resumedAt:instant.optional(),queue:z.array(id).max(50_000),revealed:z.boolean(),status:z.enum(['active','paused','done']),lastNoteId:id.optional(),shownAt:instant,
  endedAt:instant.optional(),focusId:id.optional(),limitMinutes:z.number().min(1).max(180),lastLogId:id.optional()});
export const logSchema=z.object({id,cardId:id,sessionId:id,rating:z.number().int().min(1).max(4),reviewedAt:instant,duration:z.number().min(0).max(600_000),
  formal:z.boolean(),dueReview:z.boolean(),before:memorySchema,after:memorySchema,parentLogId:id.optional(),revision:z.number().int().nonnegative(),
  undone:z.boolean(),updatedAt:instant,algorithm:z.string().max(100),excluded:z.boolean().optional(),previousLogId:id.optional(),parameters:z.record(z.string(),z.unknown()),
  queuePosition:z.number().int().min(0).max(50_000).optional(),queueBefore:z.array(id).max(50_000),lastNoteBefore:id.optional()});
export const linkSchema=z.object({id,sourceId:id,targetId:id,relation:z.enum(['prerequisite','part','related','contrast','application','reference']),updatedAt:instant});
export const ruleSchema=z.object({id,habitId:id,deckId:id.optional(),metric:z.enum(['reviews','allDue','newCards','notes','minutes']),
  target:z.number().positive().max(100_000),enabled:z.boolean(),updatedAt:instant});
const step=z.string().regex(/^[1-9]\d*(m|h|d)$/);
export const settingsSchema=z.object({id:z.literal('current'),algorithm:z.literal('ts-fsrs@5.4.2'),retention:z.number().min(.7).max(.97),
  newLimit:z.number().int().min(0).max(1000),reviewLimit:z.number().int().min(1).max(10_000),maximumInterval:z.number().int().min(1).max(36_500),
  learningSteps:z.array(step).max(10),relearningSteps:z.array(step).max(10),minutes:z.number().int().min(1).max(180),burySiblings:z.boolean(),
  lastBackupAt:instant.optional(),updatedAt:instant});
export const blockSchema=z.object({id,nodeId:id,content:text,order:z.number().int().nonnegative(),type:z.enum(['markdown','card'])});
export const attachmentSchema=z.object({id,mime:z.enum(['image/png','image/jpeg','image/webp','image/gif']),size:z.number().max(10_000_000),
  hash:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().max(250),createdAt:instant});
export type KnowledgeNode=z.infer<typeof nodeSchema>;
export type Deck=z.infer<typeof deckSchema>;
export type MemoryNote=z.infer<typeof noteSchema>;
export type MemoryCard=z.infer<typeof cardSchema>;
export type MemoryState=z.infer<typeof memorySchema>;
export type ReviewSession=z.infer<typeof sessionSchema>;
export type MemoryLog=z.infer<typeof logSchema>;
export type KnowledgeLink=z.infer<typeof linkSchema>;
export type StudyRule=z.infer<typeof ruleSchema>;
export type MemorySettings=z.infer<typeof settingsSchema>;
export type KnowledgeBlock=z.infer<typeof blockSchema>;
export type Attachment=z.infer<typeof attachmentSchema>&{blob:Blob};
export const defaultSettings=():MemorySettings=>({id:'current',algorithm:'ts-fsrs@5.4.2',retention:.9,newLimit:20,reviewLimit:100,
  maximumInterval:36500,learningSteps:['1m','10m'],relearningSteps:['10m'],minutes:15,burySiblings:true,updatedAt:new Date().toISOString()});
export const memoryBackupSchema=z.object({nodes:z.array(nodeSchema).max(50_000),blocks:z.array(blockSchema).max(300_000),
  decks:z.array(deckSchema).max(5000),notes:z.array(noteSchema).max(50_000),cards:z.array(cardSchema).max(100_000),logs:z.array(logSchema).max(1_000_000),
  sessions:z.array(sessionSchema).max(100_000),links:z.array(linkSchema).max(200_000),rules:z.array(ruleSchema).max(500),
  attachments:z.array(attachmentSchema.extend({data:z.string().max(14_000_000).optional()})).max(10_000),settings:settingsSchema});
export type MemoryBackup=z.infer<typeof memoryBackupSchema>;
export const emptyMemory=():MemoryBackup=>({nodes:[],blocks:[],decks:[],notes:[],cards:[],logs:[],sessions:[],links:[],rules:[],attachments:[],settings:defaultSettings()});
export function validateTree(items:{id:string;parentId?:string}[]){
  const map=new Map(items.map(item=>[item.id,item]));
  for(const item of items){const seen=new Set([item.id]);let parent=item.parentId;
    while(parent){if(seen.has(parent)||!map.has(parent))throw new Error('层级包含循环或不存在的父节点。');seen.add(parent);parent=map.get(parent)?.parentId;}}
}
export function validateMemory(data:MemoryBackup){
  const collections=[data.nodes,data.blocks,data.decks,data.notes,data.cards,data.logs,data.sessions,data.links,data.rules,data.attachments];
  if(collections.some(items=>new Set(items.map(item=>item.id)).size!==items.length))throw new Error('备份包含重复标识。');
  validateTree(data.nodes);validateTree(data.decks);
  const enabled=data.rules.filter(r=>r.enabled);if(new Set(enabled.map(r=>r.habitId)).size!==enabled.length)throw new Error('同一习惯存在多条启用的学习规则。');
  const nodes=new Set(data.nodes.map(x=>x.id)),decks=new Set(data.decks.map(x=>x.id)),notes=new Set(data.notes.map(x=>x.id));
  const cards=new Set(data.cards.map(x=>x.id)),sessions=new Set(data.sessions.map(x=>x.id)),attachments=new Set(data.attachments.map(x=>x.id));
  if(data.notes.some(n=>!decks.has(n.deckId)||(n.nodeId&&!nodes.has(n.nodeId))||(n.attachmentId&&!attachments.has(n.attachmentId)))||
    data.cards.some(c=>!notes.has(c.noteId)||!decks.has(c.deckId))||data.logs.some(l=>!cards.has(l.cardId)||!sessions.has(l.sessionId))||
    data.links.some(l=>!nodes.has(l.sourceId)||!nodes.has(l.targetId))||data.blocks.some(b=>!nodes.has(b.nodeId))||
    data.sessions.some(s=>s.queue.some(key=>!cards.has(key))))throw new Error('学习备份存在缺失关联。');
  if(new Set(data.cards.map(c=>c.noteId+':'+c.templateKey)).size!==data.cards.length)throw new Error('卡片模板标识重复。');
}
