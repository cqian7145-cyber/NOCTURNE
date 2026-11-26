import Dexie,{type Table} from 'dexie';
import {emptySnapshot,snapshotSchema,type Snapshot} from './model';
import type {Attachment,Deck,KnowledgeBlock,KnowledgeLink,KnowledgeNode,MemoryCard,MemoryLog,MemoryNote,MemorySettings,ReviewSession,StudyRule} from './memoria/model';
export class JournalDatabase extends Dexie{
  journal!:Table<{id:'current';value:Snapshot},string>;
  knowledgeNodes!:Table<KnowledgeNode,string>;knowledgeBlocks!:Table<KnowledgeBlock,string>;decks!:Table<Deck,string>;
  notes!:Table<MemoryNote,string>;cards!:Table<MemoryCard,string>;reviewLogs!:Table<MemoryLog,string>;studySessions!:Table<ReviewSession,string>;
  knowledgeLinks!:Table<KnowledgeLink,string>;attachments!:Table<Attachment,string>;studyRules!:Table<StudyRule,string>;memorySettings!:Table<MemorySettings,string>;
  constructor(name:string){
    super(name);
    this.version(1).stores({journal:'id'});
    this.version(2).stores({journal:'id'}).upgrade(tx=>tx.table('journal').toCollection().modify(row=>{row.value=snapshotSchema.parse(row.value);}));
    this.version(3).stores({journal:'id',knowledgeNodes:'id,parentId,domainId,updatedAt',knowledgeBlocks:'id,nodeId,[nodeId+order]',
      decks:'id,parentId',notes:'id,nodeId,deckId,origin,*tags,updatedAt',
      cards:'id,noteId,deckId,memory.due,memory.state,[deckId+memory.due],[eligible+memory.due]',
      reviewLogs:'id,cardId,sessionId,reviewedAt,[cardId+reviewedAt]',studySessions:'id,status,createdAt',
      knowledgeLinks:'id,sourceId,targetId',attachments:'id,hash',studyRules:'id,habitId,deckId',memorySettings:'id'});
    this.on('populate',async()=>{await this.journal.add({id:'current',value:emptySnapshot()});});
  }
}
