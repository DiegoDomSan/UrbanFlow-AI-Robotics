import { Component, Suspense, memo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { useCityStore } from '../stores/useCityStore';
import { Buildings } from '../city/layers/Buildings';
import { Roads } from '../city/layers/Roads';
import { LandCover } from '../city/layers/LandCover';
import { Vegetation } from '../city/layers/Vegetation';
import { Waterways } from '../city/layers/Waterways';
import { Terrain } from '../city/terrain/Terrain';
import { UrbanDetails } from '../city/layers/UrbanDetails';
import { EnvironmentLighting } from '../city/environment/EnvironmentLighting';
import { CityNavigation } from '../city/scene/CityNavigation';
import { InspectionRenderer } from '../city/scene/InspectionRenderer';
import type { TerrainModel } from '../city/terrain/terrainHeight';
import { DrainageNetwork } from '../city/drainage/DrainageNetwork';
import type { DrainageNetworkData } from '../city/drainage/types';
import type { GeoFeatureCollection } from '../city/geo/geojsonTypes';

interface Props { data:GeoFeatureCollection; terrain:TerrainModel; network:DrainageNetworkData }
const StaticCity=memo(function StaticCity({data,terrain,underground,night}:Pick<Props,'data'|'terrain'>&{underground:boolean;night:boolean}) {
  return <>
    <LandCover features={data.features} terrain={terrain} underground={underground}/>
    <Roads features={data.features} terrain={terrain} underground={underground}/>
    <Buildings features={data.features} terrain={terrain} underground={underground} night={night}/>
    <Vegetation features={data.features} terrain={terrain} underground={underground}/>
    <UrbanDetails features={data.features} terrain={terrain} underground={underground} night={night}/>
  </>;
});
function CityContent({data,terrain,network}:Props) {
  const underground=useCityStore(s=>s.mode==='underground');
  const night=useCityStore(s=>s.environment==='night');
  const depth=useCityStore(s=>s.waterDepth);
  const opacity=useCityStore(s=>s.terrainOpacity);
  const visible=useCityStore(s=>s.drainageVisible);
  const showWater=useCityStore(s=>s.showPipeWater);
  const fill=useCityStore(s=>s.pipeFill);
  const highlight=useCityStore(s=>s.highlightCollectors);
  const selected=useCityStore(s=>s.selectedId);
  const select=useCityStore(s=>s.select);
  return <>
    <EnvironmentLighting night={night} underground={underground}/>
    <Terrain terrain={terrain} underground={underground} opacity={opacity}/>
    <StaticCity data={data} terrain={terrain} underground={underground} night={night}/>
    <Waterways terrain={terrain} depth={depth} underground={underground}/>
    <DrainageNetwork network={network} underground={underground} visible={visible} fill={fill}
      highlightCollectors={highlight} selectedId={selected} onSelect={select} showWater={showWater} night={night}/>
    <CityNavigation network={network}/>
    <InspectionRenderer inspect={underground&&visible}/>
  </>;
}
class SceneBoundary extends Component<{children:ReactNode},{error:string|null}> {
  state={error:null as string|null};
  static getDerivedStateFromError(error:Error){return {error:error.message};}
  render(){return this.state.error?<div className="scene-message" role="alert"><h2>The 3D scene could not start</h2><p>{this.state.error}</p><p>Enable WebGL in your browser and reload this page.</p></div>:this.props.children;}
}
export const CityScene=memo(function CityScene(props:Props) {
  return <SceneBoundary><Canvas shadows dpr={[1,1.5]} camera={{position:[510,440,510],fov:48,near:.1,far:2400}}
    gl={{antialias:true,powerPreference:'high-performance'}} onPointerMissed={()=>useCityStore.getState().select(null)}>
    <Suspense fallback={null}><CityContent {...props}/></Suspense>
  </Canvas></SceneBoundary>;
});
