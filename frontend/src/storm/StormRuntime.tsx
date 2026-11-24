import { useEffect } from 'react';
import { useStormStore } from './useStormStore';

/** One ticking owner for the entire workshop, not tied to the panel visibility. */
export function StormRuntime() {
  useEffect(() => {
    let handle: number | undefined;
    let last = 0;
    const stop = () => { if (handle !== undefined) window.clearInterval(handle); handle = undefined; };
    const sync = () => {
      if (useStormStore.getState().status !== 'RUNNING') { stop(); return; }
      if (handle !== undefined) return;
      last = performance.now();
      handle = window.setInterval(() => {
        const now = performance.now();
        useStormStore.getState().tick((now - last) / 1000);
        last = now;
      }, 100);
    };
    const unsubscribe = useStormStore.subscribe((next, previous) => {
      if (next.status !== previous.status) sync();
    });
    sync();
    return () => { unsubscribe(); stop(); };
  }, []);
  return null;
}
