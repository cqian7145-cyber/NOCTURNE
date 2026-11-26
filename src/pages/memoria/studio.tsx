import {useEffect,useRef,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router';
import {memoria,useQuery} from '../../app/memoria';
import {useJournal} from '../../app/journal';
import {blankNote} from '../../core/memoria/repository';
import {templates} from '../../core/memoria/content';
import type {MemoryNote} from '../../core/memoria/model';
import {Dialog,Field,Empty} from '../../ui/primitives';
import {Rich,AttachmentImage} from './rich';
const types={basic:'基础问答',bidirectional:'双向卡',cloze:'编号填空',concept:'概念解释',code:'代码卡',image:'图片遮挡'};
export function Studio(){
  const [params]=useSearchParams(),id=params.get('note'),{value:o}=useQuery(()=>memoria.overview()),{value:note}=useQuery(()=>id?memoria.db.notes.get(id):Promise.resolve(undefined),[id]);
  if(!o)return <p>正在打开工坊…</p>;
  if(!o.decks.some(d=>!d.archived))return <Empty title="先创建一个卡组" action={<a className="button primary" href="#/memoria/decks">创建卡组</a>}/>;
  if(id&&!note)return <p>正在读取卡片笔记…</p>;
  return <NoteEditor key={id??'new'} initial={note??blankNote(o.decks.find(d=>!d.archived)!.id)} decks={o.decks} nodes={o.nodes} returnId={params.get('return')??undefined}/>;
}
function NoteEditor({initial,decks,nodes,returnId}:{initial:MemoryNote;decks:{id:string;name:string}[];nodes:{id:string;title:string}[];returnId?:string}){
  const [value,setValue]=useState<MemoryNote>(()=>{if(initial.front)return initial;try{const raw=sessionStorage.getItem('memoria-card-draft');if(raw){return{...initial,...JSON.parse(raw)};}}catch{/* Empty draft. */}return initial;});
  useEffect(()=>{sessionStorage.removeItem('memoria-card-draft');},[]);
  const {commit,reduced}=useJournal(),navigate=useNavigate(),[preview,setPreview]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),anchor=useRef<{x:number;y:number}|undefined>(undefined);
  function set<K extends keyof MemoryNote>(k:K,v:MemoryNote[K]){setValue(old=>({...old,[k]:v}));setSaved(false);}
  let generated:ReturnType<typeof templates>=[];try{generated=templates(value);}catch{/* Display the error on save. */}
  async function save(){setBusy(true);if(await commit(async()=>{const result=await memoria.saveNote(value);setValue(result);setSaved(true);if(returnId)navigate('/memoria/recall?session='+returnId);},'卡片已保存。',setError))setError('');setBusy(false);}
  const image=useRef<HTMLDivElement>(null);
  return <section className="panel card-studio"><header className="panel-heading"><div><h2>Card Studio</h2><p>先问一个明确的问题，再写一个能验证的答案。</p></div><button className="button secondary" onClick={()=>setPreview(true)}>预览 {generated.length} 张卡</button></header>
    <div className="form-grid"><Field label="模板"><select value={value.type} onChange={e=>set('type',e.target.value as MemoryNote['type'])}>{Object.entries(types).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="卡组"><select value={value.deckId} onChange={e=>set('deckId',e.target.value)}>{decks.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></Field>
      <Field label="关联知识"><select value={value.nodeId??''} onChange={e=>set('nodeId',e.target.value||undefined)}><option value="">独立卡片</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></Field>
      <Field label="标签"><input value={value.tags.join(', ')} onChange={e=>set('tags',e.target.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean))}/></Field>
    </div>
    <Field label={value.type==='cloze'?'填空正文':'问题'} hint={value.type==='cloze'?'例如：梯度下降沿 {{c1::负梯度::方向}} 更新；步长由 {{c2::学习率}} 控制。同一编号生成同一张卡。':'支持 Markdown、公式与代码。'}>
      <textarea aria-label="卡片问题" rows={5} value={value.front} onChange={e=>set('front',e.target.value)}/></Field>
    {value.type!=='cloze'&&<Field label={value.type==='code'?'答案 / 代码':'答案'}><textarea aria-label="卡片答案" rows={5} value={value.back} onChange={e=>set('back',e.target.value)}/></Field>}
    {value.type==='code'&&<button className="text-button" onClick={()=>set('back','~~~python\n'+value.back+'\n~~~')}>添加 Python 代码块</button>}
    {value.type==='concept'&&<p className="muted">推荐答案包含定义、例子与常见误解。用自己的话解释。</p>}
    {value.type==='image'&&<><Field label="图片"><input aria-label="遮挡图片" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async e=>{const f=e.target.files?.[0];if(f)await commit(async()=>set('attachmentId',await memoria.addAttachment(f,f.name)),undefined,setError);}}/></Field>
      <p>在图片上拖出矩形。每个区域独立生成一张卡。键盘也可用下方按钮添加，再调整坐标。</p>
      {value.attachmentId&&<div ref={image} className="occlusion-canvas" onPointerDown={e=>{const box=e.currentTarget.getBoundingClientRect();anchor.current={x:(e.clientX-box.left)/box.width,y:(e.clientY-box.top)/box.height};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(!anchor.current)return;const box=e.currentTarget.getBoundingClientRect(),x=(e.clientX-box.left)/box.width,y=(e.clientY-box.top)/box.height,a=anchor.current;anchor.current=undefined;const w=Math.abs(x-a.x),h=Math.abs(y-a.y);if(w>.01&&h>.01)set('regions',[...value.regions,{id:crypto.randomUUID(),x:Math.max(0,Math.min(a.x,x)),y:Math.max(0,Math.min(a.y,y)),w:Math.min(w,1-Math.min(a.x,x)),h:Math.min(h,1-Math.min(a.y,y))}]);}}>
        <AttachmentImage id={value.attachmentId}/>{value.regions.map((r,i)=><span className="occlusion-mask" key={r.id} style={{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'}}>{i+1}</span>)}</div>}
      <button className="button secondary" onClick={()=>set('regions',[...value.regions,{id:crypto.randomUUID(),x:.1,y:.1,w:.25,h:.2}])}>添加遮挡区域</button>
      {value.regions.map((r,i)=><div className="region-row" key={r.id}><span>区域 {i+1}</span>{(['x','y','w','h'] as const).map(k=><label key={k}>{k}<input aria-label={'区域 '+(i+1)+' '+k} type="number" min={0} max={1} step={.01} value={r[k]} onChange={e=>set('regions',value.regions.map(v=>v.id===r.id?{...v,[k]:Number(e.target.value)}:v))}/></label>)}<button className="text-button" onClick={()=>set('regions',value.regions.filter(v=>v.id!==r.id))}>删除</button></div>)}
    </>}
    <div className="form-grid"><Field label="补充解释"><textarea rows={2} value={value.extra} onChange={e=>set('extra',e.target.value)}/></Field><Field label="来源"><input value={value.source} onChange={e=>set('source',e.target.value)}/></Field></div>
    {error&&<p role="alert" className="form-error">{error}</p>}<footer className="inline-actions"><button className="button primary" onClick={()=>void save()} disabled={busy}>{busy?'保存中…':saved?'已保存':'保存卡片笔记'}</button><button className="button ghost" onClick={()=>{setValue(blankNote(value.deckId,value.nodeId));setSaved(false);}}>继续制作下一张</button><small>修改已有模板会保留记忆参数。重置请到卡片浏览器确认操作。</small></footer>
    {preview&&<Dialog title="卡片预览" reduced={reduced} onClose={()=>setPreview(false)}><div className="dialog-body">{generated.length?generated.map(c=><article className="preview-card" key={c.key}><small>{c.key}</small><Rich text={c.front}/>{c.attachmentId&&<AttachmentImage id={c.attachmentId} region={'region'in c?c.region as MemoryNote['regions'][number]:undefined} hidden/>}<hr/><Rich text={c.back}/><Rich text={value.extra}/></article>):<p>先完善模板内容。图片卡还需要图片和遮挡区域。</p>}</div></Dialog>}
  </section>;
}
