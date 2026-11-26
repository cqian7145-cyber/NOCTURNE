import Papa from 'papaparse';
import type {KnowledgeBlock,MemoryNote} from './model';
export type ParsedNote={blockId:string;type:MemoryNote['type'];front:string;back:string;line:string;order:number};
export function parseMarkdown(body:string,blocks:KnowledgeBlock[]=[]){
  const parsed:ParsedNote[]=[],errors:string[]=[],used=new Set<string>();let fence=false;
  for(const [index,raw] of body.split(/\r?\n/).entries()){
    const line=raw.trim();
    if(/^(\x60{3,}|~{3,})/.test(line)){fence=!fence;continue;}
    if(parsed.some(p=>p.line===line))continue;
    if(fence||!line||/^\x60/.test(line)||!(/ >> | <> |\{\{c\d+::/.test(line)))continue;
    const matched=blocks.find(b=>b.content===line&&!used.has(b.id))??blocks.find(b=>!used.has(b.id)&&/ >> | <> /.test(line)&&b.content.split(/ >> | <> /)[0]===line.split(/ >> | <> /)[0])??blocks.find(b=>b.order===index&&!used.has(b.id));
    const blockId=matched?.id??crypto.randomUUID();used.add(blockId);
    const cloze=line.includes('{{c'),separator=cloze?'':line.includes(' >> ')?' >> ':' <> ';
    const [front,...rest]=separator?line.split(separator):[line],back=rest.join(separator);
    if(!front.trim()||!cloze&&!back.trim()){errors.push('第 '+(index+1)+' 行缺少问题或答案');continue;}
    if(cloze&&!/\{\{c[1-9]\d*::[^{}]+}}/.test(line)){errors.push('第 '+(index+1)+' 行填空语法无效');continue;}
    parsed.push({blockId,type:cloze?'cloze':separator===' <> '?'bidirectional':'basic',front:front.trim(),back:back.trim(),line,order:index});
  }
  return{parsed,errors};
}
export function templates(note:MemoryNote){
  const base={attachmentId:note.attachmentId};
  if(note.type==='image'){
    if(!note.attachmentId||!note.regions.length)throw new Error('请添加图片和遮挡区域。');
    return note.regions.map(region=>({...base,key:'image-'+region.id,front:note.front||'回忆遮挡区域',back:note.back+(note.extra?'\n\n'+note.extra:''),region}));
  }
  if(note.type==='cloze'){
    const groups=[...new Set([...note.front.matchAll(/\{\{c([1-9]\d*)::([^{}]+)}}/g)].map(item=>item[1]))];
    if(!groups.length)throw new Error('填空格式为 {{c1::答案::提示}}。');
    return groups.map(group=>({...base,key:'cloze-'+group,
      front:note.front.replace(/\{\{c([1-9]\d*)::([^{}]+)}}/g,(_,id,content)=>id===group?'['+(content.split('::')[1]||'…')+']':content.split('::')[0]),
      back:note.front.replace(/\{\{c([1-9]\d*)::([^{}]+)}}/g,(_,__id,content)=>content.split('::')[0])}));
  }
  if(!note.front.trim()||!note.back.trim())throw new Error('请填写问题和答案。');
  const cards=[{...base,key:'forward',front:note.front,back:note.back+(note.extra?'\n\n'+note.extra:'')}];
  if(note.type==='bidirectional')cards.push({...base,key:'reverse',front:note.back,back:note.front});return cards;
}
export function parseDelimited(text:string,delimiter?:string){
  const result=Papa.parse<string[]>(text,{delimiter:delimiter??'',skipEmptyLines:'greedy'});
  const error=result.errors.find(e=>e.code!=='UndetectableDelimiter');if(error)throw new Error('CSV 第 '+((error.row??0)+1)+' 行格式错误：'+error.message);
  return result.data;
}
