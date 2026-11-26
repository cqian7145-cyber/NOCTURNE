import {useEffect,useRef,useState,type ClipboardEvent} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router';
import {Plus,ChevronDown,ChevronRight,Star,Trash2} from 'lucide-react';
import {memoria,useQuery} from '../../app/memoria';
import {useJournal} from '../../app/journal';
import {blankNode} from '../../core/memoria/repository';
import {parseMarkdown} from '../../core/memoria/content';
import {type KnowledgeNode} from '../../core/memoria/model';
import {Field,Empty,Dialog} from '../../ui/primitives';
import {Rich} from './rich';
export function Vault(){
  const {value:nodes=[],error}=useQuery(()=>memoria.db.knowledgeNodes.toArray()),[params,setParams]=useSearchParams(),{commit}=useJournal();
  const [query,setQuery]=useState(''),[scope,setScope]=useState('active'),[collapsed,setCollapsed]=useState<Set<string>>(new Set()),[drag,setDrag]=useState('');
  const selected=nodes.find(n=>n.id===params.get('node')||n.title===params.get('find'));
  async function create(){await commit(async()=>{const node=await memoria.saveNode(blankNode());setParams({node:node.id});});}
  const visible=nodes.filter(n=>scope==='trash'?n.trashed:!n.trashed&&(scope!=='favorite'||n.favorite)&&(scope==='archive'?n.archived:!n.archived)).filter(n=>(n.title+' '+n.body+' '+n.tags.join(' ')).toLowerCase().includes(query.toLowerCase()));
  function branch(parent?:string,depth=0):React.ReactNode{
    return visible.filter(n=>query?depth===0:n.parentId===parent||depth===0&&!visible.some(p=>p.id===n.parentId)).map(node=><div key={node.id}>
      <div className={'knowledge-item '+(selected?.id===node.id?'selected':'')} style={{paddingLeft:depth*14+6}} draggable
        onDragStart={()=>setDrag(node.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const moved=nodes.find(n=>n.id===drag);if(moved)void commit(()=>memoria.saveNode({...moved,parentId:node.id}));setDrag('');}}>
        <button className="tree-toggle" aria-label={(collapsed.has(node.id)?'展开':'折叠')+node.title} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(node.id))next.delete(node.id);else next.add(node.id);return next;})}>{collapsed.has(node.id)?<ChevronRight size={14}/>:<ChevronDown size={14}/>}</button>
        <button className="tree-title" onClick={()=>setParams({node:node.id})}>{node.favorite&&<Star size={12}/>} {node.title}</button>
      </div>{!query&&!collapsed.has(node.id)&&branch(node.id,depth+1)}
    </div>);
  }
  return <div className="knowledge-layout"><aside className="knowledge-tree"><div className="inline-actions"><h2>VAULT</h2><button className="icon-button" aria-label="新建知识" onClick={()=>void create()}><Plus size={17}/></button></div>
    <input aria-label="搜索知识" placeholder="搜索知识、正文、标签…" value={query} onChange={e=>setQuery(e.target.value)}/>
    <select aria-label="知识范围" value={scope} onChange={e=>setScope(e.target.value)}>{[['active','全部知识'],['favorite','收藏'],['archive','归档'],['trash','回收站']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    {error&&<p role="alert">{error}</p>}{branch()}{!visible.length&&<p className="muted">这里还没有知识。</p>}<small>拖动节点可调整层级，也可在编辑器选择父节点。</small></aside>
    {selected?<NodeEditor key={selected.id} node={selected} nodes={nodes}/>:<Empty title="把理解写成自己的话" action={<button className="button primary" onClick={()=>void create()}>创建第一条知识</button>}>支持 Markdown、公式、代码、本地图片与双向链接。</Empty>}
  </div>;
}
function NodeEditor({node,nodes}:{node:KnowledgeNode;nodes:KnowledgeNode[]}){
  const key='nocturne-draft-'+node.id;
  const {data,notify,reduced}=useJournal(),navigate=useNavigate();
  const [draft,setDraft]=useState(node),base=useRef(node),latest=useRef(node),chain=useRef(Promise.resolve()),[status,setStatus]=useState('已保存'),[preview,setPreview]=useState(false),[history,setHistory]=useState(false),[version,setVersion]=useState(0),[recovery,setRecovery]=useState<KnowledgeNode>(),[blockMode,setBlockMode]=useState(false),[selection,setSelection]=useState(''),[imageWidth,setImageWidth]=useState(80);
  const area=useRef<HTMLTextAreaElement>(null);
  const {value:links=[]}=useQuery(()=>memoria.db.knowledgeLinks.where('targetId').equals(node.id).toArray(),[node.id]);
  useEffect(()=>{try{const raw=localStorage.getItem(key);if(raw){const saved=JSON.parse(raw);if(saved.updatedAt>node.updatedAt||saved.body!==node.body)setRecovery(saved);}}catch{/* No draft available. */}},[key,node]);
  function update<K extends keyof KnowledgeNode>(field:K,value:KnowledgeNode[K]){const next={...latest.current,[field]:value,updatedAt:new Date().toISOString()};latest.current=next;setDraft(next);setStatus('尚未保存');try{localStorage.setItem(key,JSON.stringify(next));}catch{setStatus('草稿缓存已满，请立即保存');}}
  function persist(generate=false){
    chain.current=chain.current.catch(()=>{}).then(async()=>{
      const input={...latest.current,revision:base.current.revision,versions:base.current.versions};
      setStatus('正在保存…');
      try{const saved=await memoria.saveNode(input,generate);base.current=saved;
        if(latest.current.updatedAt===input.updatedAt){latest.current=saved;setDraft(saved);localStorage.removeItem(key);setStatus('已保存');}else setStatus('尚未保存');
        if(generate)notify('卡片已同步，既有模板保留复习进度。');
      }catch(e){setStatus('保存失败 · '+(e instanceof Error?e.message:'请重试'));throw e;}
    });return chain.current;
  }
  useEffect(()=>{if(status!=='尚未保存')return;const timer=setTimeout(()=>void persist().catch(()=>{}),700);return()=>clearTimeout(timer);});
  function insert(text:string){const element=area.current,start=element?.selectionStart??draft.body.length,end=element?.selectionEnd??start;update('body',draft.body.slice(0,start)+text+draft.body.slice(end));}
  async function attach(file:File){try{const id=await memoria.addAttachment(file,file.name);insert('\n<img src="attachment:'+id+'" width="'+imageWidth+'%" alt="'+file.name.replace(/["<>]/g,'')+'">\n\n*图片说明*\n');}catch(e){notify(e instanceof Error?e.message:'图片无法保存','error');}}
  function paste(event:ClipboardEvent<HTMLTextAreaElement>){const file=Array.from(event.clipboardData.files).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();void attach(file);}}
  const parsed=parseMarkdown(draft.body),blocks=draft.body.split(/\n\n+/);
  return <section className="knowledge-editor">
    {recovery&&<div className="draft-recovery"><span>发现未保存草稿。</span><button className="text-button" onClick={()=>{setDraft(recovery);latest.current=recovery;setRecovery(undefined);setStatus('尚未保存');}}>恢复草稿</button><button className="text-button" onClick={()=>{localStorage.removeItem(key);setRecovery(undefined);}}>丢弃草稿</button></div>}
    <input className="knowledge-title" aria-label="知识标题" maxLength={160} value={draft.title} onChange={e=>update('title',e.target.value)}/>
    <div className="editor-toolbar"><button className="button ghost" onClick={()=>setPreview(!preview)}>{preview?'编辑 Markdown':'阅读预览'}</button><button className="button ghost" onClick={()=>setBlockMode(!blockMode)}>段落操作</button>
      <button className="button ghost" onClick={()=>setHistory(true)}>版本历史 {base.current.versions.length}</button>
      <button className="button ghost" onClick={()=>update('favorite',!draft.favorite)}><Star size={14}/>{draft.favorite?'取消收藏':'收藏'}</button>
      <button className="button primary" onClick={()=>void persist(true).catch(()=>{})}>同步卡片 ({parsed.parsed.length})</button></div>
    <div className="editor-format">{[['标题','## '],['列表','- '],['引用','> '],['表格','\n| 概念 | 解释 |\n| --- | --- |\n|  |  |\n'],['公式','$$\nx^2 + y^2 = z^2\n$$'],['代码','\n~~~python\nprint("hello")\n~~~\n'],['双向链接','[[知识标题]]']].map(([label,text])=><button key={label} className="text-button" onClick={()=>insert(text)}>{label}</button>)}
      <label className="text-button file-button">添加图片<input type="file" aria-label="上传知识图片" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{const file=e.target.files?.[0];if(file)void attach(file);e.target.value='';}}/></label>
      <label>图片宽度 <input type="range" min={20} max={100} value={imageWidth} onChange={e=>setImageWidth(Number(e.target.value))}/>{imageWidth}%</label></div>
    {preview?<Rich text={draft.body}/>:<textarea className="markdown-editor" ref={area} aria-label="知识正文" placeholder={'把理解写在这里…\n\n问题 >> 答案\n英文 <> 中文\n概念是 {{c1::答案::提示}}'} value={draft.body} onChange={e=>update('body',e.target.value)} onPaste={paste} onSelect={e=>{const t=e.currentTarget;setSelection(t.value.slice(t.selectionStart,t.selectionEnd));}}/>}
    {selection&&<button className="button secondary" onClick={()=>{sessionStorage.setItem('memoria-card-draft',JSON.stringify({front:selection,nodeId:node.id}));navigate('/memoria/studio');}}>将选中文字制作成卡片</button>}
    {blockMode&&<div className="block-list">{blocks.map((text,index)=><div className="block-row" key={index}><p>{text.slice(0,140)||'空段落'}</p><div className="inline-actions"><button className="text-button" disabled={!index} onClick={()=>{const next=[...blocks];[next[index-1],next[index]]=[next[index],next[index-1]];update('body',next.join('\n\n'));}}>上移</button><button className="text-button" disabled={index===blocks.length-1} onClick={()=>{const next=[...blocks];[next[index],next[index+1]]=[next[index+1],next[index]];update('body',next.join('\n\n'));}}>下移</button><button className="text-button" onClick={()=>update('body',blocks.map((b,i)=>i===index?b.split('\n').map(line=>'  '+line).join('\n'):b).join('\n\n'))}>缩进</button><button className="text-button" onClick={()=>{sessionStorage.setItem('memoria-card-draft',JSON.stringify({front:text,nodeId:node.id}));navigate('/memoria/studio');}}>制作卡片</button><button className="text-button" onClick={()=>void persist().then(async()=>{const blocks=await memoria.db.knowledgeBlocks.where('nodeId').equals(node.id).toArray(),block=blocks.find(b=>b.type==='markdown'&&b.content===text);if(block)insert('\n\n(('+block.id+'))');}).catch(()=>{})}>引用段落</button></div></div>)}</div>}
    {parsed.errors.map(e=><p className="form-error" key={e}>{e}</p>)}
    <div className="form-grid"><Field label="父节点"><select value={draft.parentId??''} onChange={e=>update('parentId',e.target.value||undefined)}><option value="">根节点</option>{nodes.filter(n=>n.id!==node.id&&!n.trashed).map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></Field>
      <Field label="人生领域"><select value={draft.domainId??''} onChange={e=>update('domainId',e.target.value||undefined)}><option value="">未关联</option>{data.domains.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
      <Field label="标签（逗号分隔）"><input value={draft.tags.join(', ')} onChange={e=>update('tags',e.target.value.split(/[,，]/).map(s=>s.trim()).filter(Boolean))}/></Field><Field label="来源"><input value={draft.source} onChange={e=>update('source',e.target.value)}/></Field></div>
    <div className="inline-actions"><button className="button secondary" onClick={()=>void persist().catch(()=>{})}>保存知识</button><button className="text-button" onClick={()=>update('archived',!draft.archived)}>{draft.archived?'恢复归档':'归档'}</button><button className="text-button" onClick={()=>update('trashed',!draft.trashed)}><Trash2 size={14}/>{draft.trashed?'从回收站恢复':'移至回收站'}</button><span role="status" className="save-status">{status}</span></div>
    <aside className="backlinks"><h3>反向链接</h3>{links.length?links.map(l=><Link key={l.id} to={'/memoria/vault?node='+l.sourceId}>{nodes.find(n=>n.id===l.sourceId)?.title}</Link>):<p>其他知识使用 [[{draft.title}]] 即可在这里连接。</p>}</aside>
    {history&&<Dialog title="历史版本" reduced={reduced} onClose={()=>setHistory(false)} className="wide-dialog"><div className="dialog-body">
      <select aria-label="历史版本" value={version} onChange={e=>setVersion(Number(e.target.value))}>{base.current.versions.map((v,i)=><option key={i} value={i}>{new Date(v.savedAt).toLocaleString('zh-CN')}</option>)}</select>
      {base.current.versions[version]?<><div className="version-comparison"><div><h3>所选版本</h3><Rich text={base.current.versions[version].body}/></div><div><h3>当前内容</h3><Rich text={draft.body}/></div></div><button className="button primary" onClick={()=>{const v=base.current.versions[version];update('body',v.body);update('title',v.title);setHistory(false);}}>恢复为此版本</button></>:<p>修改正文并保存后会保留历史版本。</p>}
    </div></Dialog>}
  </section>;
}
