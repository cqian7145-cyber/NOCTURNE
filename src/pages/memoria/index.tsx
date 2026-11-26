import {NavLink,Link,Route,Routes,useNavigate} from 'react-router';
import {useState} from 'react';
import {Brain,Plus,ArrowUpRight} from 'lucide-react';
import {memoria,useQuery} from '../../app/memoria';
import {useJournal} from '../../app/journal';
import {PageHeading,Empty,Field} from '../../ui/primitives';
import {studyFacts} from '../../core/memoria/analytics';
import {type ReviewSession} from '../../core/memoria/model';
import {Recall} from './recall';
import {Vault} from './vault';
import {Studio} from './studio';
import {Decks,Browser} from './browser';
import {MemoryAnalytics,Constellation} from './insights';
import {Exchange,MemorySettings} from './exchange';
import './memoria.css';
const tabs=[['','学习中心'],['vault','知识库'],['decks','卡组'],['studio','制卡工坊'],['recall','复习'],['browser','卡片浏览器'],['analytics','学习分析'],['graph','知识星图'],['exchange','导入导出'],['settings','学习设置']];
export function MemoryHome(){
  const {value:o}=useQuery(()=>memoria.overview()),{value:facts}=useQuery(()=>studyFacts(memoria.db)),{value:paused}=useQuery(()=>memoria.db.studySessions.where('status').equals('paused').reverse().limit(4).toArray()),{commit}=useJournal(),navigate=useNavigate();
  const [mode,setMode]=useState<ReviewSession['mode']>('daily'),[deck,setDeck]=useState(''),[override,setOverride]=useState(false),[busy,setBusy]=useState(false);
  async function start(){setBusy(true);await commit(async()=>{const s=await memoria.startSession(mode,deck||undefined,undefined,override);navigate('/memoria/recall?session='+s.id);});setBusy(false);}
  return <><section className="memory-hero"><div><span className="eyebrow">MEMORIA / KEEP WHAT MATTERS</span><h2>让知识，成为你的一部分。</h2><p>行动留下痕迹，主动回忆让它留得更久。</p><Link className="hero-link" to="/memoria/vault">记录一个想法 <ArrowUpRight size={15}/></Link></div><Brain size={100} strokeWidth={.6} aria-hidden/></section>
    <dl className="memory-metrics"><div><dt>到期复习</dt><dd>{o?.due??0}</dd></div><div><dt>待学习</dt><dd>{o?.newCards??0}</dd></div><div><dt>成熟卡片</dt><dd>{facts?.mature??0}</dd></div><div><dt>知识节点</dt><dd>{facts?.notes.length??0}</dd></div></dl>
    <section className="panel"><h2>今日回忆</h2><p>默认新卡 20 张，到期卡 100 张。上限控制本轮数量，积压仍会完整显示。</p>
      <div className="form-grid"><Field label="复习模式"><select value={mode} onChange={e=>setMode(e.target.value as ReviewSession['mode'])}>{Object.entries({daily:'今日队列',deck:'指定卡组',weak:'薄弱卡片',exam:'考试模拟（不更新记忆）',practice:'自由练习（不更新记忆）',focus:'专注复习'}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="卡组"><select value={deck} onChange={e=>setDeck(e.target.value)}><option value="">全部卡组</option>{o?.decks.filter(d=>!d.archived).map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></Field></div>
      <label className="check-field"><input type="checkbox" checked={override} onChange={e=>setOverride(e.target.checked)}/>本轮临时突破每日数量上限</label>
      <div className="inline-actions"><button className="button primary" onClick={()=>void start()} disabled={busy}>{o?.active?'继续当前复习':'开始主动回忆'}</button><Link className="button secondary" to="/memoria/studio"><Plus size={16}/>制作卡片</Link></div>
      {paused?.map(s=><p key={s.id}><button className="text-button" onClick={()=>void commit(async()=>{await memoria.resume(s.id);navigate('/memoria/recall?session='+s.id);})}>恢复 {new Date(s.updatedAt).toLocaleString('zh-CN')} 的会话 · {s.queue.length} 张</button></p>)}
    </section>
    {!o?.nodes.length&&<Empty title="从刚学会的一个概念开始" action={<Link to="/memoria/vault" className="button secondary">创建第一条知识</Link>}>把知识写清楚，再变成能检验自己的问题。</Empty>}
  </>;
}
export function Memoria(){
  return <div className="memoria"><PageHeading title="MEMORIA" description="知识、回忆与成长之间的连接。"/><nav className="memory-tabs" aria-label="MEMORIA 导航">{tabs.map(([path,label])=><NavLink end={path===''} key={path} to={'/memoria'+(path?'/'+path:'')}>{label}</NavLink>)}</nav>
    <Routes><Route index element={<MemoryHome/>}/><Route path="vault" element={<Vault/>}/><Route path="decks" element={<Decks/>}/><Route path="studio" element={<Studio/>}/><Route path="recall" element={<Recall/>}/><Route path="browser" element={<Browser/>}/><Route path="analytics" element={<MemoryAnalytics/>}/><Route path="graph" element={<Constellation/>}/><Route path="exchange" element={<Exchange/>}/><Route path="settings" element={<MemorySettings/>}/></Routes>
  </div>;
}
