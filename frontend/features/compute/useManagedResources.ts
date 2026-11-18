import {useEffect,useState} from 'react';
import type {ManagedSnapshot} from '../../../contracts/dto/managed-compute';
import {invoke} from '../../api/studio';

const empty:ManagedSnapshot = {resources:[],conversations:[],sources:[]};

export function useManagedResources() {
  const [state,setState] = useState<ManagedSnapshot>(empty);
  useEffect(() => {
    let alive = true, pending = false, dirty = false;
    async function refresh() {
      if (pending) { dirty = true; return; }
      pending = true;
      try {
        do {
          dirty = false;
          const next = await invoke<ManagedSnapshot>('compute.managed.snapshot',{});
          if (alive && !dirty && Array.isArray(next?.conversations) && Array.isArray(next.resources) && Array.isArray(next.sources)) setState(next);
        } while (alive && dirty);
      } catch {
        if (alive) setState(previous => ({...previous,resources:[],sources:previous.sources.map(s=>({...s,connected:false})),
          conversations:previous.conversations.map(c=>({...c,replying:false,nextWakeAt:null,badges:c.badges.map(b=>({...b,status:'offline'}))}))}));
      } finally { pending = false; }
    }
    const unsubscribe = window.studio?.onEvent(event => {
      if (['studio/managedActivity','studio/agentTurnState','studio/workerConnected','studio/computeResourceChanged'].includes(event.method)) void refresh();
    });
    const focused = () => { void refresh(); };
    window.addEventListener('focus', focused);
    void refresh();
    return () => { alive = false; unsubscribe?.(); window.removeEventListener('focus',focused); };
  },[]);
  return state;
}
