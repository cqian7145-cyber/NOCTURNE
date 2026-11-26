import {useState} from 'react';
import {Link,useNavigate} from 'react-router';
import {memoria,useQuery} from '../../app/memoria';
import {useJournal} from '../../app/journal';
import {stamp} from '../../core/memoria/repository';
import type {Deck,MemoryCard} from '../../core/memoria/model';
import {Dialog,Field,Empty} from '../../ui/primitives';
import {exportCSV} from '../../core/memoria/exchange';
export function download(data:Blob|string,name:string,mime='application/json'){
  const url=URL.createObjectURL(typeof data==='string'?new Blob([data],{type:mime}):data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export function Decks(){
  const {value:o}=useQuery(()=>memoria.overview()),{value:cards=[]}=useQuery(()=>memoria.db.cards.toArray()),{commit}=useJournal(),navigate=useNavigate(),[editing,setEditing]=useState<Deck>(),[name,setName]=useState(''),[parent,setParent]=useState(''),[retention,setRetention]=useState(.9);
  function open(d?:Deck){setEditing(d??{...stamp(),name:'',archived:false});setName(d?.name??'');setParent(d?.parentId??'');setRetention(d?.retention??o?.settings.retention??.9);}
  return <><div className="inline-actions"><h2>你的卡组</h2><button className="button primary" onClick={()=>open()}>新建卡组</button></div><div className="deck-grid">
    {o?.decks.map(d=><article className={'panel deck '+(d.archived?'archived':'')} key={d.id}><small>{d.parentId?o.decks.find(p=>p.id===d.parentId)?.name:'COLLECTION'}</small><h3>{d.name}</h3><p>{cards.filter(c=>c.deckId===d.id&&!c.trashed).length} 张卡 · {cards.filter(c=>c.deckId===d.id&&c.eligible&&c.memory.state>0&&c.memory.due<=new Date().toISOString()).length} 到期</p>
      <div className="inline-actions"><button className="button primary" disabled={d.archived} onClick={()=>void commit(async()=>{const s=await memoria.startSession('deck',d.id);navigate('/memoria/recall?session='+s.id);})}>复习</button><button className="text-button" onClick={()=>open(d)}>编辑</button><button className="text-button" onClick={()=>void commit(()=>memoria.saveDeck({...d,archived:!d.archived}))}>{d.archived?'恢复':'归档'}</button><Link className="text-button" to={'/memoria/browser?deck='+d.id}>浏览</Link></div></article>)}
  </div>{!o?.decks.length&&<Empty title="为一个学习主题建立卡组" action={<button className="button secondary" onClick={()=>open()}>创建第一组</button>}/>}
    {editing&&<Dialog title="编辑卡组" onClose={()=>setEditing(undefined)}><form className="dialog-body" onSubmit={e=>{e.preventDefault();void commit(async()=>{await memoria.saveDeck({...editing,name,parentId:parent||undefined,retention});setEditing(undefined);});}}>
      <Field label="卡组名称"><input aria-label="卡组名称" required value={name} onChange={e=>setName(e.target.value)}/></Field>
      <Field label="父卡组"><select value={parent} onChange={e=>setParent(e.target.value)}><option value="">根目录</option>{o?.decks.filter(d=>d.id!==editing.id).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="目标保留率" hint="更高的保留率通常意味着更频繁的复习。"><input type="number" min={.7} max={.97} step={.01} value={retention} onChange={e=>setRetention(Number(e.target.value))}/></Field><button type="submit" className="button primary">保存卡组</button></form></Dialog>}
  </>;
}
const states=['新卡','学习中','复习','重学'];
export function Browser(){
  const [filter,setFilter]=useState(()=>({query:'',deckId:new URLSearchParams(location.hash.split('?')[1]).get('deck')??'',state:'',flag:'',tag:'',sort:'due',minimumLapses:0,minimumDifficulty:0,minimumStability:0,createdAfter:'',updatedAfter:''})),[page,setPage]=useState(0),[selected,setSelected]=useState<Set<string>>(new Set()),[action,setAction]=useState(''),[target,setTarget]=useState(''),[confirm,setConfirm]=useState(''),[detail,setDetail]=useState<MemoryCard>();
  const {value:result,error}=useQuery(()=>memoria.cards(filter,page*50,50),[JSON.stringify(filter),page]),{value:o}=useQuery(()=>memoria.overview()),{commit}=useJournal();
  function set<K extends keyof typeof filter>(key:K,value:typeof filter[K]){setFilter(f=>({...f,[key]:value}));setPage(0);setSelected(new Set());}
  async function apply(){if(!action)return;
    if(action==='export'){download(exportCSV((await memoria.db.cards.bulkGet([...selected])).filter((c):c is MemoryCard=>!!c)),'NOCTURNE-selected.csv','text/csv');return;}
    await commit(async()=>{if(action==='delete')await memoria.deleteCards([...selected]);else await memoria.batch([...selected],action as Parameters<typeof memoria.batch>[1],target);setSelected(new Set());setConfirm('');},'批量操作已完成。');
  }
  return <><h2>卡片浏览器</h2><div className="browser-filters">
    <Field label="搜索"><input aria-label="搜索卡片" placeholder="问题、答案…" value={filter.query} onChange={e=>set('query',e.target.value)}/></Field>
    <Field label="卡组"><select value={filter.deckId} onChange={e=>set('deckId',e.target.value)}><option value="">全部卡组</option>{o?.decks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
    <Field label="状态"><select value={filter.state} onChange={e=>set('state',e.target.value)}><option value="">全部状态</option>{states.map((s,i)=><option key={i} value={i}>{s}</option>)}</select></Field>
    <Field label="范围"><select value={filter.flag} onChange={e=>set('flag',e.target.value)}>{[['','全部'],['due','已到期'],['suspended','暂停'],['archived','归档'],['trash','回收站']].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></Field>
    <Field label="标签"><input value={filter.tag} onChange={e=>set('tag',e.target.value)}/></Field><Field label="排序"><select value={filter.sort} onChange={e=>set('sort',e.target.value)}><option value="due">到期时间</option><option value="difficulty">难度降序</option><option value="stability">稳定性升序</option></select></Field></div>
    <details><summary>更多筛选</summary><div className="form-grid">{([['minimumLapses','最少遗忘次数'],['minimumDifficulty','最低难度'],['minimumStability','最低稳定性（天）']] as const).map(([key,label])=><Field label={label} key={key}><input type="number" min={0} value={filter[key]} onChange={e=>set(key,Number(e.target.value))}/></Field>)}<Field label="创建于此日期后"><input type="date" value={filter.createdAfter} onChange={e=>set('createdAfter',e.target.value)}/></Field><Field label="更新于此日期后"><input type="date" value={filter.updatedAfter} onChange={e=>set('updatedAfter',e.target.value)}/></Field></div></details>
    <div className="bulk-toolbar"><span>已选 {selected.size} · 共 {result?.total??0} 张</span><select aria-label="批量操作" value={action} onChange={e=>{setAction(e.target.value);setTarget('');}}>{[['','选择操作'],['suspend','暂停'],['resume','恢复暂停'],['archive','归档'],['trash','移入回收站'],['restore','恢复归档 / 回收站'],['move','移动卡组'],['tag','添加标签'],['reset','重置记忆'],['export','导出 CSV'],['delete','永久删除']].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>
      {action==='move'&&<select aria-label="目标卡组" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择卡组</option>{o?.decks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>}{action==='tag'&&<input aria-label="新增标签" value={target} onChange={e=>setTarget(e.target.value)}/>}
      <button className="button secondary" disabled={!selected.size||!action} onClick={()=>{if(['reset','delete'].includes(action))setConfirm(action);else void apply();}}>执行</button></div>
    {error&&<p role="alert">{error}</p>}
    <div className="table-scroll"><table className="memory-table"><thead><tr><th><input type="checkbox" aria-label="选择当前页" checked={!!result?.items.length&&result.items.every(c=>selected.has(c.id))} onChange={e=>setSelected(e.target.checked?new Set(result?.items.map(c=>c.id)):new Set())}/></th><th>问题</th><th>状态</th><th>到期</th><th>稳定性 / 难度</th><th>遗忘</th><th>操作</th></tr></thead><tbody>{result?.items.map(c=><tr key={c.id}><td><input aria-label={'选择 '+c.front.slice(0,30)} type="checkbox" checked={selected.has(c.id)} onChange={e=>setSelected(old=>{const next=new Set(old);if(e.target.checked)next.add(c.id);else next.delete(c.id);return next;})}/></td><td><button className="text-button card-front" onClick={()=>setDetail(c)}>{c.front.slice(0,100)}</button></td><td>{c.trashed?'回收站':c.archived?'归档':c.suspended?'暂停':states[c.memory.state]}</td><td>{c.memory.state===0?'待学习':new Date(c.memory.due).toLocaleString('zh-CN')}</td><td>{c.memory.stability.toFixed(1)} 天 / {c.memory.difficulty.toFixed(1)}</td><td>{c.memory.lapses}</td><td><Link className="text-button" to={'/memoria/studio?note='+c.noteId}>编辑</Link></td></tr>)}</tbody></table></div>
    {!result?.total&&<Empty title="没有符合条件的卡片"/>}<div className="pagination"><button className="button ghost" disabled={!page} onClick={()=>setPage(p=>p-1)}>上一页</button><span>第 {page+1} / {Math.max(1,Math.ceil((result?.total??0)/50))} 页</span><button className="button ghost" disabled={(page+1)*50>=(result?.total??0)} onClick={()=>setPage(p=>p+1)}>下一页</button></div>
    {confirm&&<Dialog title={confirm==='reset'?'重置记忆参数':'永久删除卡片'} onClose={()=>setConfirm('')}><div className="dialog-body"><p>{confirm==='reset'?'所选卡片恢复为新卡。历史日志保留，新记忆从头开始。':'仅回收站中的所选卡片可被永久删除，同时删除这些卡片的复习日志。此操作不可撤销。'}</p><button className="button danger" onClick={()=>void apply()}>确认{confirm==='reset'?'重置':'永久删除'}</button></div></Dialog>}
    {detail&&<Dialog title="卡片记忆详情" onClose={()=>setDetail(undefined)}><div className="dialog-body"><p>{detail.front}</p><pre>{JSON.stringify(detail.memory,null,2)}</pre><p>调度算法 ts-fsrs@5.4.2 · 参数保存于每条正式评分日志中。</p></div></Dialog>}
  </>;
}
