import {Link} from 'react-router';
import {memoria,useQuery} from '../app/memoria';
import {useJournal} from '../app/journal';
import {studyFacts} from '../core/memoria/analytics';
export function MemoryDashboard(){
  const {value:o}=useQuery(()=>memoria.overview());
  return <section className="memory-dashboard" aria-label="今日学习"><div><h2>MEMORIA · 今日回忆</h2><p>到期 {o?.due??0} 张 · 新卡 {o?.newCards??0} 张 · 知识 {o?.nodes.filter(n=>!n.trashed).length??0} 条</p></div><Link to={o?.active?'/memoria/recall?session='+o.active.id:'/memoria'} className="button secondary">开始回忆 →</Link></section>;
}
export function StudyReport({start,end}:{start:string;end:string}){
  const {value:f}=useQuery(()=>studyFacts(memoria.db,start,end),[start,end]);
  return <section className="panel"><h2>知识与学习</h2><p>本周期正式评分 {f?.reviewCount??0} 次，覆盖 {f?.unique??0} 张卡；学习 {(f?.minutes??0).toFixed(1)} 分钟。</p><p>当前成熟卡 {f?.mature??0} 张。到期 Review 的实际回忆率 {f?.rate.rate==null?'样本不足':Math.round(f.rate.rate*100)+'%'}。</p><Link className="text-button" to="/memoria/analytics">查看学习分析</Link></section>;
}
export function StudyMilestones(){
  const {today}=useJournal(),{value:f}=useQuery(()=>studyFacts(memoria.db)),logs=f?.logs.slice().sort((a,b)=>a.reviewedAt.localeCompare(b.reviewedAt))??[];
  const reached=[1,100,1000,10000].filter(n=>logs.length>=n);
  return reached.length?<section className="panel"><h2>学习里程碑</h2>{reached.map(n=><p key={n}>{logs[n-1].reviewedAt.slice(0,10)} · {n===1?'完成第一次主动回忆':'完成第 '+n+' 次正式复习'}</p>)}<p>{today} · 当前成熟卡片 {f?.mature??0} 张</p></section>:null;
}
