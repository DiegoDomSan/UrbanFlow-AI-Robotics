import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { city } from '../city/model';
import { useCityStore } from '../stores/useCityStore';
function CityContent() {
  const mode = useCityStore(s => s.mode);
  const select = useCityStore(s => s.select);
  return <>
    <ambientLight intensity={1.4}/><directionalLight position={[70, 120, 40]} intensity={2} castShadow/>
    <mesh receiveShadow position={[0,-0.6,0]}><boxGeometry args={[240,1,240]}/><meshStandardMaterial color="#638c79" transparent opacity={mode === 'underground' ? 0.28 : 1}/></mesh>
    <Grid args={[240,240]} position={[0,0.02,0]} cellSize={10} cellColor="#8da6a0" sectionColor="#4b6b69" fadeDistance={350}/>
    <mesh position={[0,0.06,0]}><boxGeometry args={[18,0.1,240]}/><meshStandardMaterial color="#394958"/></mesh>
    <mesh position={[0,0.07,0]}><boxGeometry args={[240,0.1,18]}/><meshStandardMaterial color="#394958"/></mesh>
    {city.buildings.map(b => <mesh key={b.id} position={[b.position[0], b.dimensions[1]/2, b.position[2]]} castShadow onClick={e => {e.stopPropagation();select(b.id)}}>
      <boxGeometry args={[...b.dimensions]}/><meshStandardMaterial color={b.kind === 'office' ? '#88b5c8' : b.kind === 'commercial' ? '#e0b78d' : '#d7dce3'} transparent opacity={mode === 'underground' ? 0.25 : 1}/>
    </mesh>)}
    {mode === 'underground' && <mesh position={[0,-4,0]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[1.8,1.8,220,16]}/><meshStandardMaterial color="#38bdf8"/></mesh>}
    <OrbitControls makeDefault enableDamping minDistance={30} maxDistance={440} maxPolarAngle={Math.PI/2.05}/>
  </>;
}
export function CityScene() { return <Canvas shadows camera={{position:[175,155,175],fov:48,near:0.1,far:1000}}><color attach="background" args={['#c7dbe4']}/><CityContent/></Canvas>; }
