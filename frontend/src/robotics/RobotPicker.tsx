import { ROBOT_LIST } from './definitions';
import type { RobotKind } from './types';

export function RobotPicker({onSelect,onClose,hasRobot}:{onSelect:(kind:RobotKind)=>void;onClose:()=>void;hasRobot:boolean}) {
  return <section className="robot-picker" aria-label="Choose a robot">
    <div className="robot-picker-heading"><div><span className="eyebrow">ROBOTICS WORKSHOP / 01</span><h2>Choose your mission partner.</h2><p>Four ready-to-use robots. You create the instructions.</p></div><button className="robot-icon-button" onClick={onClose} aria-label={hasRobot?'Back to your robot':'Close robot selection'}>×</button></div>
    <div className="robot-picker-grid">{ROBOT_LIST.map((robot,index)=><button type="button" key={robot.kind} className="robot-card" style={{'--robot-accent':robot.color} as React.CSSProperties} onClick={()=>onSelect(robot.kind)}>
      <div className="robot-card-top"><span className="robot-portrait" aria-hidden="true">{robot.icon}</span><span className="robot-card-number">0{index+1}</span></div>
      <h3>{robot.name}</h3><p>{robot.description}</p><dl><dt>MISSION</dt><dd>{robot.purpose}</dd><dt>SENSORS</dt><dd>{robot.sensors.join(' · ')}</dd><dt>ACTIONS</dt><dd>{robot.actions.join(' · ')}</dd></dl>
      <div className="robot-learning"><span>YOU WILL LEARN</span><p>{robot.objective}</p></div><span className="robot-card-choose">Choose {robot.shortName}<span aria-hidden="true">↗</span></span>
    </button>)}</div>
    <p className="robot-picker-note">Sensors and missions use explicit educational rules. Robots follow your blocks; they are never controlled by the AI workshop.</p>
  </section>;
}
