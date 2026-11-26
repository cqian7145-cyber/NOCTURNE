import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router';
import {memoria,useQuery} from '../../app/memoria';
import {useJournal,useNow} from '../../app/journal';
import {predictions} from '../../core/memoria/scheduler';
import {Rich,AttachmentImage} from './rich';
import {Empty} from '../../ui/primitives';
const labels=['忘记','困难','记得','轻松'];
const interval=(due:string)=>{const minutes=Math.max(0,Math.round((Date.parse(due)-Date.now())/60000));return minutes<60?minutes+' 分钟':minutes<1440?Math.round(minutes/60)+' 小时':Math.round(minutes/1440)+' 天';};
export function Recall(){
  const [params]=useSearchParams(),navigate=useNavigate(),{commit,notify}=useJournal(),id=params.get('session')??'';
  const tick=useNow(true),{value,error}=useQuery(()=>memoria.recall(id),[id,Math.floor(tick/1000)]),busy=useRef(false),[saving,setSaving]=useState(false);
  const s=value?.session,c=value?.card;
  async function act(fn:()=>Promise<unknown>){if(busy.current)return;busy.current=true;setSaving(true);await commit(fn);busy.current=false;setSaving(false);}
  function reveal(){if(s&&!s.revealed)void act(()=>memoria.reveal(id,s.revision));}
  function grade(rating:number){if(s&&c&&s.revealed)void act(()=>memoria.grade(id,s.revision,c.id,c.revision,rating,crypto.randomUUID()));}
  function undo(){if(s)void act(()=>memoria.undo(id,s.revision));}
  function pause(){if(s)void act(async()=>{await memoria.pause(id);navigate('/memoria');});}
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],dialog'))return;
      if(event.code==='Space'){event.preventDefault();reveal();}
      if(/^[1-4]$/.test(event.key)){event.preventDefault();grade(Number(event.key));}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo();}
      if(event.key==='Escape'){event.preventDefault();pause();}
      if(event.key.toLowerCase()==='e'&&c)navigate('/memoria/studio?note='+c.noteId+'&return='+id);
      if(event.key.toLowerCase()==='s'&&c)void act(()=>memoria.batch([c.id],'suspend'));
    };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  });
  useEffect(()=>{if(s?.mode==='focus'&&s.status==='active'&&(s.activeMs??0)+tick-Date.parse(s.resumedAt??s.createdAt)>s.limitMinutes*60000){void memoria.pause(s.id).then(()=>notify('本轮专注复习已到设定时间。'));}},[s,tick,notify]);
  if(error)return <p role="alert">{error}</p>;
  if(!value)return <Empty title={id?'正在打开复习…':'先选择一组卡片'} action={<Link className="button primary" to="/memoria">返回学习中心</Link>}/>;
  if(s?.status==='paused')return <Empty title="会话已暂停" action={<button className="button primary" onClick={()=>void act(()=>memoria.resume(id))}>继续复习</button>}/>;
  if(!s)return null;
  const choices=c&&s.revealed&&!['practice','exam'].includes(s.mode)?predictions(c.memory,new Date(),value.settings,value.retention):[];
  return <section className={'recall-chamber '+(s.mode==='focus'?'immersive':'')}>
    <div className="recall-meta"><span>ACTIVE RECALL / {['practice','exam'].includes(s.mode)?'练习 · 不更新记忆':'正式复习'}</span><span>队列 {s.queue.length}</span></div>
    {c?<><div className="recall-card" key={c.id} aria-live="polite">
      <small>先在心里作答</small><Rich text={c.front}/>
      {c.attachmentId&&<AttachmentImage id={c.attachmentId} region={c.region} hidden={!s.revealed}/>}
      {s.revealed&&<div className="revealed-answer"><small>参考答案</small><Rich text={c.back}/></div>}
    </div>
    {!s.revealed?<button className="button primary reveal-button" disabled={saving} onClick={reveal}>揭晓答案 <kbd>Space</kbd></button>:
      <div className="rating-grid">{labels.map((label,index)=><button className={'rating rating-'+index} key={label} disabled={saving} onClick={()=>grade(index+1)}>
        <span><kbd>{index+1}</kbd> {label}</span><small>{choices[index]?interval(choices[index].due):'仅记录本次练习'}</small></button>)}</div>}
    <div className="inline-actions"><Link className="text-button" to={'/memoria/studio?note='+c.noteId+'&return='+id}>编辑卡片 E</Link><button className="text-button" disabled={saving} onClick={()=>void act(()=>memoria.batch([c.id],'suspend'))}>暂停此卡 S</button></div></>:
    <div className="recall-card"><h2>{s.status==='done'?'这一轮，已留下痕迹。':'等待学习间隔'}</h2><p>{s.status==='done'?'回忆比重读更值得珍惜。':'刚学习的卡片会在 FSRS 给出的时间重新出现。可以暂停，稍后继续。'}</p><Link to="/memoria" className="button primary">返回学习中心</Link></div>}
    <footer className="recall-footer"><button className="button secondary" disabled={!s.lastLogId||saving} onClick={undo}>撤销评分 Ctrl Z</button><button className="button ghost" onClick={pause} disabled={saving}>暂停并退出 Esc</button></footer>
  </section>;
}
