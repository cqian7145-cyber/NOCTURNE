import {createEmptyCard,fsrs,generatorParameters,type Card,type Grade,type StepUnit} from 'ts-fsrs';
import type {MemorySettings,MemoryState} from './model';
export const serialize=(card:Card):MemoryState=>({...card,due:card.due.toISOString(),last_review:card.last_review?.toISOString()});
export const freshMemory=(now=new Date())=>serialize(createEmptyCard(now));
export const deserialize=(state:MemoryState):Card=>({...state,due:new Date(state.due),last_review:state.last_review?new Date(state.last_review):undefined});
export function engine(settings:MemorySettings,retention=settings.retention){
  return fsrs(generatorParameters({request_retention:retention,maximum_interval:settings.maximumInterval,enable_fuzz:false,
    learning_steps:settings.learningSteps as StepUnit[],relearning_steps:settings.relearningSteps as StepUnit[]}));
}
export function schedule(memory:MemoryState,rating:number,now:Date,settings:MemorySettings,retention?:number){
  if(!Number.isInteger(rating)||rating<1||rating>4)throw new Error('无效评分。');
  const scheduler=engine(settings,retention),result=scheduler.next(deserialize(memory),now,rating as Grade);
  return{memory:serialize(result.card),parameters:JSON.parse(JSON.stringify(scheduler.parameters)) as Record<string,unknown>};
}
export const predictions=(state:MemoryState,now:Date,settings:MemorySettings,retention?:number)=>[1,2,3,4].map(r=>schedule(state,r,now,settings,retention).memory);
export function retrievability(memory:MemoryState,now:Date,settings:MemorySettings){
  return memory.last_review?Number(engine(settings).get_retrievability(deserialize(memory),now,false)):null;
}
