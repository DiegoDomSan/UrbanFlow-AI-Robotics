import { DRAINAGE_CONFIG as C } from './drainageConfig';
import type { DrainageNetworkData } from './types';
type HeightSource={getTerrainHeight(x:number,z:number):number; config?: {topY:number;thickness:number}};
/** Validate serialized data independently of the generator or renderer. */
export function validateDrainageNetwork(network:DrainageNetworkData,terrain:HeightSource):string[] {
  const errors:string[]=[],nodes=new Map(network.nodes.map(n=>[n.id,n])),pipes=new Map(network.pipes.map(p=>[p.id,p])),outgoing=new Map<string,string[]>();
  if(!network.nodes.length||!network.pipes.length)errors.push('Network is empty.');
  if(nodes.size!==network.nodes.length||pipes.size!==network.pipes.length)errors.push('Duplicate identifiers.');
  if(!network.outfallIds.length)errors.push('No outfall.');
  for(const id of network.outfallIds)if(nodes.get(id)?.kind!=='outfall')errors.push(`${id}: declared outfall is missing or has wrong kind.`);
  for(const n of network.nodes)if(![n.x,n.y,n.z,n.surfaceY].every(Number.isFinite))errors.push(`${n.id}: non-finite coordinate.`);
  for(const p of network.pipes) {
    const a=nodes.get(p.from),b=nodes.get(p.to);
    if(!a||!b){errors.push(`${p.id}: missing node.`);continue;}
    const list=outgoing.get(a.id)??[];list.push(p.id);outgoing.set(a.id,list);
    const range=p.kind==='collector'?C.collectorDiameter:C.secondaryDiameter;
    if(!Number.isFinite(p.diameter)||p.diameter<range[0]-1e-9||p.diameter>range[1]+1e-9)errors.push(`${p.id}: invalid diameter.`);
    const horizontal=Math.hypot(a.x-b.x,a.z-b.z),length=Math.hypot(horizontal,a.y-b.y),slope=(a.y-b.y)/horizontal;
    if(horizontal<=0||!Number.isFinite(p.length)||Math.abs(p.length-length)>1e-6)errors.push(`${p.id}: invalid length.`);
    if(!Number.isFinite(p.gradient)||p.gradient<C.minGradient-1e-9||p.gradient>C.maxGradient||Math.abs(p.gradient-slope)>1e-8)errors.push(`${p.id}: invalid gravity gradient.`);
    if(!Number.isFinite(p.fillPercentage)||p.fillPercentage<0||p.fillPercentage>100)errors.push(`${p.id}: invalid fill.`);
    if(a.downstreamId!==b.id)errors.push(`${p.id}: inconsistent node destination.`);
    const expected=network.pipes.find(next=>next.from===b.id)?.id??null;
    if(p.downstreamId!==expected)errors.push(`${p.id}: inconsistent pipe destination.`);
    const samples=Math.max(2,Math.ceil(horizontal));
    for(let i=0;i<=samples;i++) {
      const t=i/samples,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,y=a.y+(b.y-a.y)*t;
      // The final few meters at the declared bank outfall emerge through its sloping face.
      const exposedMouth=b.kind==='outfall' && horizontal*(1-t)<=7;
      const cover=terrain.getTerrainHeight(x,z)-(y+p.diameter/2);
      if(!exposedMouth && cover<C.minimumCover-1e-6){errors.push(`${p.id}: insufficient cover at ${(t*100).toFixed(0)}%.`);break;}
      if(y-p.diameter/2 < (terrain.config ? terrain.config.topY-terrain.config.thickness : -12.05)) {errors.push(`${p.id}: below terrain base.`);break;}
    }
  }
  for(const n of network.nodes) {
    if(n.kind==='outfall') {
      if(!network.outfallIds.includes(n.id)||n.downstreamId!==null||(outgoing.get(n.id)?.length??0)!==0)errors.push(`${n.id}: invalid outfall.`);
      if(!network.pipes.some(p=>p.to===n.id))errors.push(`${n.id}: disconnected outfall.`);
      continue;
    }
    if((outgoing.get(n.id)?.length??0)!==1)errors.push(`${n.id}: must have one downstream pipe.`);
    const seen=new Set<string>();let id:string|null=n.id;
    while(id && !network.outfallIds.includes(id)) {
      if(seen.has(id)){errors.push(`${n.id}: downstream cycle.`);break;}
      seen.add(id);
      const next=nodes.get(id);
      if(!next){errors.push(`${n.id}: unknown downstream node.`);break;}
      id=next.downstreamId;
    }
    if(id===null)errors.push(`${n.id}: no outfall path.`);
  }
  // Require a single undirected connected component, even with multiple declared outlets.
  if(network.nodes[0]) {
    const seen=new Set([network.nodes[0].id]),queue=[network.nodes[0].id];
    for(let i=0;i<queue.length;i++)for(const p of network.pipes){const next=p.from===queue[i]?p.to:p.to===queue[i]?p.from:null;if(next&&!seen.has(next)){seen.add(next);queue.push(next);}}
    if(seen.size!==nodes.size)errors.push('Graph is disconnected.');
  }
  return errors;
}
