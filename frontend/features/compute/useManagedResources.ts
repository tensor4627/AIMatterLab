import {useEffect,useRef,useState} from 'react';
import type {ManagedSnapshot} from '../../../contracts/dto/managed-compute';
import {invoke} from '../../api/studio';

const empty:ManagedSnapshot = {resources:[],conversations:[],sources:[]};
type ManagedObservation = {snapshot:ManagedSnapshot; status:'loading'|'current'|'pending'};

export function useManagedResources() {
  const [state,setState] = useState<ManagedObservation>({snapshot:empty,status:'loading'});
  const refreshRef = useRef<()=>void>(()=>{});
  useEffect(() => {
    let alive = true, pending = false, dirty = false;
    async function refresh() {
      if (!alive) return;
      if (pending) { dirty = true; return; }
      pending = true;
      try {
        do {
          dirty = false;
          try {
            const snapshot = await invoke<ManagedSnapshot>('compute.managed.snapshot',{});
            if (!Array.isArray(snapshot?.conversations) || !Array.isArray(snapshot.resources) || !Array.isArray(snapshot.sources)) throw Error('invalid_managed_compute_snapshot');
            if (alive && !dirty) setState({snapshot,status:'current'});
          } catch {
            if (alive && !dirty) setState(previous => previous.status==='pending' ? previous : {...previous,status:'pending'});
          }
        } while (alive && dirty);
      } finally { pending = false; }
    }
    const unsubscribe = window.studio?.onEvent(event => {
      if (['studio/managedActivity','studio/agentTurnState','studio/workerConnected','studio/computeResourceChanged'].includes(event.method)) void refresh();
    });
    const focused = () => { void refresh(); };
    refreshRef.current = focused;
    window.addEventListener('focus', focused);
    void refresh();
    return () => { alive = false; unsubscribe?.(); window.removeEventListener('focus',focused); };
  },[]);
  return {...state.snapshot,observation:state.status,retry:()=>refreshRef.current()};
}
