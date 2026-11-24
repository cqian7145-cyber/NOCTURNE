import { useJournal } from '../app/journal';
import { Field } from './primitives';

export function DomainSelect({ value, change }: { value?: string; change: (value?: string) => void }) {
  const { data } = useJournal();
  return <Field label="人生领域"><select value={value ?? ''} onChange={event => change(event.target.value || undefined)}>
    <option value="">未分类</option>{data.domains.map(area => <option key={area.id} value={area.id}>{area.title}</option>)}
  </select></Field>;
}
