import {useEffect,useState,type DependencyList} from 'react';
import {liveQuery} from 'dexie';
import {repository} from '../core/repository';
import {createMemoryRepository} from '../core/memoria/repository';
export const memoria=createMemoryRepository(repository.database);
export function useQuery<T>(query:()=>Promise<T>,deps:DependencyList=[]){
  const [value,setValue]=useState<T>(),[error,setError]=useState('');
  useEffect(()=>{let active=true;const sub=liveQuery(query).subscribe({next:v=>{if(active){setValue(v);setError('');}},error:e=>{if(active)setError(e instanceof Error?e.message:'无法读取学习数据。');}});return()=>{active=false;sub.unsubscribe();};
    // Callers specify all inputs of their database query.
  },deps);
  return{value,error};
}
