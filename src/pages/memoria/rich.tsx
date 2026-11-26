import {useEffect,useMemo,useState} from 'react';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import {useQuery,memoria} from '../../app/memoria';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
export function Rich({text,className=''}:{text:string;className?:string}){
  const {value:attachments}=useQuery(()=>memoria.db.attachments.toArray());
  const {value:blocks=[]}=useQuery(()=>memoria.db.knowledgeBlocks.toArray());
  const [urls,setUrls]=useState<Record<string,string>>({});
  useEffect(()=>{const next=Object.fromEntries((attachments??[]).map(a=>[a.id,URL.createObjectURL(a.blob)]));setUrls(next);return()=>Object.values(next).forEach(URL.revokeObjectURL);},[attachments]);
  const html=useMemo(()=>{
    const math:string[]=[];
    const referenced=text.replace(/\(\(([\w-]+)\)\)/g,(_,id)=>{const b=blocks.find(b=>b.id===id);return b?'\n> '+b.content.replace(/\n/g,'\n> ')+'\n\n[查看原文](#/memoria/vault?node='+b.nodeId+')':'[段落已删除]';});
    let source=referenced.replace(/\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g,(_,block,inline)=>{const key='NOCTURNEMATH'+math.length+'TOKEN';math.push(katex.renderToString(block??inline,{displayMode:!!block,throwOnError:false,trust:false}));return key;});
    source=source.replace(/\[\[([^\]]+)]]/g,(_,name)=>'['+name+'](#/memoria/vault?find='+encodeURIComponent(name)+')');
    let result=marked.parse(source,{async:false,gfm:true}) as string;
    result=result.replace(/NOCTURNEMATH(\d+)TOKEN/g,(_,i)=>math[Number(i)]??'');
    result=result.replace(/src="attachment:([\w-]+)"/g,'data-attachment="$1"');
    const doc=new DOMParser().parseFromString(DOMPurify.sanitize(result,{ADD_TAGS:['annotation','semantics'],ADD_ATTR:['target']}),'text/html');
    for(const image of doc.querySelectorAll('img')){const id=image.getAttribute('data-attachment')??'';if(urls[id])image.src=urls[id];else image.removeAttribute('src');image.loading='lazy';}
    for(const code of doc.querySelectorAll('pre code')){const lang=Array.from(code.classList).find(c=>c.startsWith('language-'))?.slice(9);if(lang&&hljs.getLanguage(lang))code.innerHTML=hljs.highlight(code.textContent??'',{language:lang}).value;}
    for(const link of doc.querySelectorAll('a')){if(link.getAttribute('href')?.startsWith('http')){link.target='_blank';link.rel='noopener noreferrer';}}
    return doc.body.innerHTML;
  },[text,urls,blocks]);
  return <div className={'rich '+className} dangerouslySetInnerHTML={{__html:html}}/>;
}
export function AttachmentImage({id,region,hidden=false}:{id:string;region?:{x:number;y:number;w:number;h:number};hidden?:boolean}){
  const {value}=useQuery(()=>memoria.db.attachments.get(id),[id]),[url,setUrl]=useState('');
  useEffect(()=>{if(!value)return;const src=URL.createObjectURL(value.blob);setUrl(src);return()=>URL.revokeObjectURL(src);},[value]);
  return <div className="occlusion-image">{url&&<img src={url} alt={value?.name??'知识图片'}/>}
    {region&&hidden&&<span className="occlusion-mask" style={{left:region.x*100+'%',top:region.y*100+'%',width:region.w*100+'%',height:region.h*100+'%'}}/>}</div>;
}
