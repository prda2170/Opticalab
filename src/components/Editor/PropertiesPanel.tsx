// Right-side properties panel — compact inline-label layout
import React from 'react';
import { useLayout } from '../../store/layoutContext';
import type { OpticalNodeData } from '../../types/components';
import { CATEGORY_COLORS } from '../../types/components';
import type { BeamState } from '../../types/beam';
import { componentOutputs, isEmitter, DEFAULT_WAIST_UM } from '../../physics/propagate';
import { formatLength, formatSpot } from '../../physics/scale';
import { formatDetuning } from '../../physics/wavelength';
import { detectorVolts, formatVoltage, incidentPower, detectorBeat } from '../../physics/detector';
import { getNodeIcon } from '../Nodes/NodeIcons';
import { ANNOTATION_COLOURS } from '../../utils/annotationStyle';
import { ANNOTATION_NODE_TYPES } from '../../types/components';
import { angleStepFor, SURFACE_AT_45 } from '../../utils/nodeGeometry';
import { norm360, snapAngle } from '../../physics/geometry';

// ── Shared primitives ─────────────────────────────────────────────────────────

/** Row: label on left (fixed width) + control on right */
const Row: React.FC<{ label: string; unit?: string; children: React.ReactNode }> = ({ label, unit, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', alignItems: 'center', gap: 6, marginBottom: 6 }}>
    <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, lineHeight: 1.2 }}>
      {label}{unit ? <span style={{ color: '#6b7280', fontWeight: 400 }}> {unit}</span> : ''}
    </label>
    <div>{children}</div>
  </div>
);

const inputClass = 'w-full bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-blue-400 focus:outline-none';
const selectClass = 'w-full bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-blue-400 focus:outline-none';

const Inp: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (p) => (
  <input {...p} className={inputClass} />
);
const Sel: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (p) => (
  <select {...p} className={selectClass} />
);

function Num({ value, onChange, min, max, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <Inp type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(parseFloat(e.target.value) || 0)} />
  );
}

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
        background: checked ? '#3b82f6' : '#374151', position: 'relative', flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 14 : 2, width: 14, height: 14,
        background: '#fff', borderRadius: '50%', transition: 'left 0.15s',
      }}/>
    </button>
    <span style={{ fontSize: 11, color: '#d1d5db' }}>{label}</span>
  </div>
);

const Divider = () => <div style={{ borderTop: '1px solid #374151', margin: '8px 0' }} />;

const stepBtn: React.CSSProperties = {
  width: 20, height: 22, flexShrink: 0, borderRadius: 4, cursor: 'pointer',
  background: '#1e2030', color: '#9ca3af', border: '1px solid #374151',
  fontSize: 13, lineHeight: 1, padding: 0,
};

/**
 * Component angle, on its own lattice.
 *
 * One control for every component, replacing the "/" vs "\\" pair mirrors used to get and
 * the four-value dropdown everything else got. Typed or stepped values are snapped to the
 * component's grain, so a layout can never hold an angle the beam lattice cannot express.
 * The presets are the orientations that used to be the whole menu; for a mirror they are
 * labelled by the *surface* it presents, which is 45° behind its body.
 */
const AngleControl: React.FC<{
  value: number;
  step: number;
  surface: boolean;
  onChange: (deg: number) => void;
}> = ({ value, step, surface, onChange }) => {
  const bump = (dir: number) => onChange(norm360(value + dir * step));
  const presets = surface
    ? [{ deg: 0, label: '/' }, { deg: 90, label: '\\' }]
    : [{ deg: 0, label: '→' }, { deg: 90, label: '↓' }, { deg: 180, label: '←' }, { deg: 270, label: '↑' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <button style={stepBtn} title={`−${step}°`} onClick={() => bump(-1)}>−</button>
        <input
          type="number" value={value} step={step} min={0} max={360}
          onChange={e => onChange(snapAngle(parseFloat(e.target.value) || 0, step))}
          className={inputClass}
          style={{ textAlign: 'center' }}
        />
        <button style={stepBtn} title={`+${step}°`} onClick={() => bump(1)}>+</button>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {presets.map(({ deg, label }) => {
          const active = Math.abs(norm360(value) - deg) < 1e-9;
          return (
            <button
              key={deg}
              onClick={() => onChange(deg)}
              title={surface ? `Surface at ${norm360(deg - 45)}°` : `${deg}°`}
              style={{
                flex: 1, padding: '2px 0', fontSize: 12, fontFamily: 'monospace',
                lineHeight: 1.3, borderRadius: 4, cursor: 'pointer',
                background: active ? '#3b82f6' : '#1e2030',
                color: active ? '#fff' : '#9ca3af',
                border: `1px solid ${active ? '#3b82f6' : '#374151'}`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 9.5, color: '#6b7280', lineHeight: 1.3 }}>
        {surface
          ? `Surface at ${Number(norm360(value - 45).toFixed(1))}°, in ${step}° steps — half the beam grain, since reflection doubles it.`
          : `${step}° steps.`}
      </div>
    </div>
  );
};

/** Human name for an output port handle. */
const PORT_LABELS: Record<string, string> = {
  out:    'Output',
  trans:  'Transmitted',
  refl:   'Reflected',
  shg:    'Output 2ω',
  fund:   'Output ω',
  order1: 'Diffracted Order',
  order0: '0th Order',
  retro:  'Retroreflected',
  fiber:  'Into Fibre',
};

/**
 * Read-only λ / Δf / P / pol / spot readout for one beam.
 * `muted` dims a port whose power never leaves the component (a beam dump).
 */
const BeamReadout: React.FC<{ title: string; beam: BeamState; muted?: boolean }> = ({ title, beam, muted }) => (
  <>
    <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
    <div style={{
      background: '#151820', borderRadius: 6, padding: '7px 9px', marginBottom: 8,
      border: `1px solid ${muted ? '#171d28' : '#1f2937'}`, fontSize: 11,
      color: muted ? '#7c8899' : '#cbd5e1', lineHeight: 1.8,
      display: 'grid', gridTemplateColumns: '52px 1fr', rowGap: 0,
    }}>
      <span style={{ color: '#6b7280' }}>λ</span>
      <span>{Math.round(beam.wavelength)} nm</span>
      {!!beam.detuningHz && <>
        <span style={{ color: '#6b7280' }} title="Frequency offset from the source carrier">Δf</span>
        <span>{formatDetuning(beam.detuningHz)}</span>
      </>}
      <span style={{ color: '#6b7280' }}>P</span>
      <span>
        {beam.power >= 1000     ? `${(beam.power / 1000).toFixed(3)} W`
          : beam.power >= 0.5   ? `${beam.power.toFixed(2)} mW`
          : `${(beam.power * 1000).toFixed(1)} µW`}
      </span>
      <span style={{ color: '#6b7280' }}>Pol</span>
      <span>
        {beam.polarization.type === 'H' ? 'H'
          : beam.polarization.type === 'V' ? 'V'
          : beam.polarization.type === 'circular' ? `${(beam.polarization as { handedness: string }).handedness}CP`
          : 'custom'}
      </span>
      {beam.w != null && <>
        <span style={{ color: '#6b7280' }} title="1/e² intensity radius at this plane">w</span>
        <span>{formatSpot(beam.w)}</span>
      </>}
      {beam.w0 != null && <>
        <span style={{ color: '#6b7280' }} title="Waist radius of this beam">w₀</span>
        <span>{formatSpot(beam.w0)}</span>
      </>}
      {beam.waistDistance != null && Math.abs(beam.waistDistance) > 1e-6 && <>
        <span style={{ color: '#6b7280' }} title="Distance to the waist — positive is downstream">Δz</span>
        <span>
          {beam.waistDistance > 0
            ? `${formatLength(beam.waistDistance)} ahead`
            : `${formatLength(-beam.waistDistance)} behind`}
        </span>
      </>}
      {beam.zR != null && <>
        <span style={{ color: '#6b7280' }} title="Rayleigh range">z_R</span>
        <span>{formatLength(beam.zR)}</span>
      </>}
      {beam.divergence != null && <>
        <span style={{ color: '#6b7280' }} title="Far-field half-angle divergence">θ</span>
        <span>{beam.divergence.toFixed(2)} mrad</span>
      </>}
    </div>
  </>
);

const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6, lineHeight: 1.4 }}>{children}</div>
);

// ── Per-type field blocks ──────────────────────────────────────────────────────

function renderFields(data: OpticalNodeData, update: (p: Partial<OpticalNodeData>) => void): React.ReactNode {
  const u = update as (p: Record<string, unknown>) => void;

  switch (data.type) {
    case 'laser_source': return <>
      <Row label="Wavelength" unit="nm"><Num value={data.wavelength} onChange={v => u({ wavelength: v })} min={200} max={2000} /></Row>
      <Row label="Power" unit="mW"><Num value={data.outputPower} step={0.1} onChange={v => u({ outputPower: v })} min={0} /></Row>
      <Row label="Polarization">
        <Sel value={data.polarization} onChange={e => u({ polarization: e.target.value })}>
          <option value="H">H (horizontal)</option>
          <option value="V">V (vertical)</option>
          <option value="circular">Circular</option>
          <option value="custom">Custom</option>
        </Sel>
      </Row>
      <Row label="Waist w₀" unit="µm">
        <Num value={data.waist ?? DEFAULT_WAIST_UM} onChange={v => u({ waist: v })} min={1} step={10} />
      </Row>
      <Row label="M²">
        <Num value={data.mSquared ?? 1} onChange={v => u({ mSquared: v })} min={1} step={0.05} />
      </Row>
      <Row label="Current" unit="mA">
        <Num value={data.current ?? 0} onChange={v => u({ current: v })} min={0} step={1} />
      </Row>
      <Hint>
        w₀ is the 1/e² radius at the output face — it seeds Gaussian propagation through the
        layout. Current is recorded for you, not used in the physics: it is the setting that
        produced the power above.
      </Hint>
    </>;
    case 'fiber_amplifier': return <>
      <Row label="Wavelength" unit="nm"><Num value={data.wavelength} onChange={v => u({ wavelength: v })} min={200} max={2000} /></Row>
      <Row label="Output power" unit="mW">
        <Num value={data.outputPower} onChange={v => u({ outputPower: v })} min={0} step={10} />
      </Row>
      <Row label="Polarization">
        <Sel value={data.polarization} onChange={e => u({ polarization: e.target.value })}>
          <option value="H">H (horizontal)</option>
          <option value="V">V (vertical)</option>
          <option value="circular">Circular</option>
          <option value="custom">Custom</option>
        </Sel>
      </Row>
      <Row label="Waist w₀" unit="µm">
        <Num value={data.waist ?? DEFAULT_WAIST_UM} onChange={v => u({ waist: v })} min={1} step={10} />
      </Row>
      <Row label="M²">
        <Num value={data.mSquared ?? 1} onChange={v => u({ mSquared: v })} min={1} step={0.05} />
      </Row>
      <Row label="Current" unit="mA">
        <Num value={data.current ?? 0} onChange={v => u({ current: v })} min={0} step={10} />
      </Row>
      <Hint>
        Seeded down a fibre, so it needs no beam drawn to it — it starts a beam like a
        laser does, and states its own output. The seed itself is not modelled: set the
        output to what your power meter reads. w₀ is at the output collimator.
      </Hint>
    </>;
    case 'optical_amplifier': return <>
      <Row label="Output power" unit="mW">
        <Num value={data.outputPower} onChange={v => u({ outputPower: v })} min={0} step={10} />
      </Row>
      <Row label="Current" unit="mA">
        <Num value={data.current ?? 0} onChange={v => u({ current: v })} min={0} step={10} />
      </Row>
      <Hint>
        Needs a seed: the incoming beam sets the wavelength, detuning and polarisation, and
        the power becomes the figure above. Unseeded it outputs nothing — ASE isn't modelled
        — and the output mode is the seed's. Current is bookkeeping only.
      </Hint>
    </>;
    case 'retroreflector': return <>
      <Row label="Reflectivity" unit="%"><Num value={data.reflectivity} onChange={v => u({ reflectivity: v })} min={0} max={100} step={0.1} /></Row>
      <Row label="Focal length" unit="mm"><Num value={data.focalLength} onChange={v => u({ focalLength: v })} min={0} step={5} /></Row>
      <Hint>
        Sends the beam back the way it came. {data.focalLength > 0
          ? `A cat's eye: place it ${data.focalLength} mm from the component you are double-passing and the beam returns the same size, so retuning an AOM doesn't walk it.`
          : 'A corner cube: returns the beam without re-imaging it.'}
      </Hint>
    </>;
    case 'isolator': return <>
      <Row label="Transmission" unit="%"><Num value={data.transmission} onChange={v => u({ transmission: v })} min={0} max={100} step={0.1} /></Row>
      <Row label="Isolation" unit="dB"><Num value={data.isolation} onChange={v => u({ isolation: v })} min={0} /></Row>
    </>;
    case 'linear_polarizer': return <>
      <Row label="Angle" unit="°"><Num value={data.angle} onChange={v => u({ angle: v })} min={0} max={180} /></Row>
      <Row label="Type">
        <Sel value={data.polType} onChange={e => u({ polType: e.target.value })}>
          <option value="generic">Generic</option>
          <option value="glan_taylor">Glan-Taylor</option>
        </Sel>
      </Row>
    </>;
    case 'hwp':
    case 'qwp': return <>
      <Row label="Fast Axis" unit="°"><Num value={data.fastAxisAngle} onChange={v => u({ fastAxisAngle: v })} min={0} max={180} step={0.5} /></Row>
    </>;
    case 'nd_filter': return <>
      <Row label="OD"><Num value={data.od} onChange={v => u({ od: v })} min={0} max={6} step={0.1} /></Row>
      <Hint>Transmission: {(Math.pow(10, -data.od) * 100).toFixed(3)}%</Hint>
    </>;
    case 'iris': return <>
      <Row label="Diameter" unit="mm"><Num value={data.apertureDiameter} onChange={v => u({ apertureDiameter: v })} min={0.1} step={0.1} /></Row>
    </>;
    case 'dielectric_mirror': return <>
      <Row label="Reflectivity" unit="%"><Num value={data.reflectivity} onChange={v => u({ reflectivity: v })} min={0} max={100} step={0.1} /></Row>
    </>;
    case 'dichroic_mirror': return <>
      <Row label="Edge λ" unit="nm"><Num value={data.edgeWavelength} onChange={v => u({ edgeWavelength: v })} min={200} max={2000} /></Row>
      <Row label="Type">
        <Sel value={data.mirrorType} onChange={e => u({ mirrorType: e.target.value })}>
          <option value="LP">Long Pass</option>
          <option value="SP">Short Pass</option>
        </Sel>
      </Row>
    </>;
    case 'npbs': return <>
      <Row label="Split Ratio"><Inp type="text" value={data.splitRatio} onChange={e => u({ splitRatio: e.target.value })} placeholder="50:50" /></Row>
    </>;
    case 'pbs': return <Hint>H transmits · V reflects</Hint>;
    case 'nonlinear_crystal': return <>
      <Row label="Process">
        <Sel value={data.crystalType} onChange={e => u({ crystalType: e.target.value })}>
          <option value="SHG">SHG</option>
          <option value="SFG">SFG</option>
        </Sel>
      </Row>
      <Row label="Geometry">
        <Sel value={data.geometry} onChange={e => u({ geometry: e.target.value })}>
          <option value="bulk">Bulk</option>
          <option value="waveguide">Waveguide</option>
        </Sel>
      </Row>
      <Row label="Temperature" unit="°C"><Num value={data.temperature} onChange={v => u({ temperature: v })} min={-50} max={500} /></Row>
      <Row label="Efficiency" unit="%"><Num value={data.conversionEfficiency} onChange={v => u({ conversionEfficiency: v })} min={0} max={100} step={0.1} /></Row>
    </>;
    case 'plano_convex':
    case 'plano_concave': return <>
      <Row label="Focal Length" unit="mm"><Num value={data.focalLength} onChange={v => u({ focalLength: v })} step={0.5} /></Row>
      <Toggle checked={(data as { flipped?: boolean }).flipped ?? false} onChange={v => u({ flipped: v })} label="Flip orientation" />
    </>;
    case 'fiber_coupler': return <>
      <Row label="Efficiency" unit="%"><Num value={data.couplingEfficiency} onChange={v => u({ couplingEfficiency: v })} min={0} max={100} step={0.1} /></Row>
      <Row label="Input NA"><Num value={data.inputNA} onChange={v => u({ inputNA: v })} min={0.01} max={1} step={0.01} /></Row>
    </>;
    case 'fiber_launcher': return <>
      <Row label="Wavelength" unit="nm"><Num value={data.wavelength ?? 780} onChange={v => u({ wavelength: v })} min={200} max={2000} /></Row>
      <Row label="Output power" unit="mW"><Num value={data.outputPower ?? 1} step={0.1} onChange={v => u({ outputPower: v })} min={0} /></Row>
      <Row label="Polarization">
        <Sel value={data.polarization ?? 'H'} onChange={e => u({ polarization: e.target.value })}>
          <option value="H">H (horizontal)</option>
          <option value="V">V (vertical)</option>
          <option value="circular">Circular</option>
          <option value="custom">Custom</option>
        </Sel>
      </Row>
      <Row label="Waist w₀" unit="µm">
        <Num value={data.waist ?? DEFAULT_WAIST_UM} onChange={v => u({ waist: v })} min={1} step={10} />
      </Row>
      <Row label="Collimator f" unit="mm"><Num value={data.focalLength} onChange={v => u({ focalLength: v })} step={0.5} /></Row>
      <Hint>
        A launcher is a beam source, like a laser — light arrives down the fibre and is
        launched into free space along the way it faces. Its output is stated here rather
        than carried from a coupler. For a real collimator w₀ ≈ λf/(π·w_fibre).
      </Hint>
    </>;
    case 'fiber_cable': return <>
      <Row label="Length" unit="m"><Num value={data.length} onChange={v => u({ length: v })} min={0.1} step={0.1} /></Row>
      <Toggle checked={data.pmFiber} onChange={v => u({ pmFiber: v })} label="PM Fiber" />
      <Row label="Connector">
        <Sel value={data.connectorType} onChange={e => u({ connectorType: e.target.value })}>
          <option value="FC/APC">FC/APC</option>
          <option value="FC-PC">FC-PC</option>
          <option value="SMA">SMA</option>
        </Sel>
      </Row>
    </>;
    case 'aom': return <>
      <Row label="RF Freq." unit="MHz"><Num value={data.rfFrequency} onChange={v => u({ rfFrequency: v })} min={0} step={0.1} /></Row>
      <Row label="RF Power" unit="dBm"><Num value={data.rfPower} onChange={v => u({ rfPower: v })} /></Row>
      <Row label="Efficiency" unit="%"><Num value={data.diffractionEfficiency} onChange={v => u({ diffractionEfficiency: v })} min={0} max={100} step={0.1} /></Row>
      <Row label="Transmission" unit="%"><Num value={data.transmission} onChange={v => u({ transmission: v })} min={0} max={100} step={0.1} /></Row>
      <Row label="Order">
        <Sel value={data.activeOrder} onChange={e => u({ activeOrder: e.target.value })}>
          <option value="+1">+1</option>
          <option value="-1">−1</option>
          <option value="0">0 (through)</option>
        </Sel>
      </Row>
      <Toggle
        checked={data.dumpZeroOrder !== false}
        onChange={v => u({ dumpZeroOrder: v })}
        label="Block 0th order at cell"
      />
      <Hint>
        Efficiency is the fraction of incident power in the diffracted order, which
        carries a {data.activeOrder === '-1' ? '−' : '+'}{data.rfFrequency} MHz shift and
        continues straight through. Untick above to route the 0th order out along its own
        lane, one inch {data.activeOrder === '-1' ? 'above' : 'below'}, where you can put a
        beam block on it.
      </Hint>
    </>;
    case 'aod': return <>
      <Row label="RF Freq." unit="MHz"><Num value={data.rfFrequency} onChange={v => u({ rfFrequency: v })} min={0} step={0.1} /></Row>
      <Row label="RF Power" unit="dBm"><Num value={data.rfPower} onChange={v => u({ rfPower: v })} /></Row>
      <Row label="Efficiency" unit="%"><Num value={data.diffractionEfficiency} onChange={v => u({ diffractionEfficiency: v })} min={0} max={100} step={0.1} /></Row>
      <Row label="Transmission" unit="%"><Num value={data.transmission} onChange={v => u({ transmission: v })} min={0} max={100} step={0.1} /></Row>
      <Toggle
        checked={data.dumpZeroOrder !== false}
        onChange={v => u({ dumpZeroOrder: v })}
        label="Block 0th order at cell"
      />
    </>;
    case 'eom': return <>
      <Row label="Type">
        <Sel value={data.eomType} onChange={e => u({ eomType: e.target.value })}>
          <option value="free_space">Free-Space</option>
          <option value="fiber">Fiber</option>
        </Sel>
      </Row>
      <Row label="Transmission" unit="%"><Num value={data.transmission} onChange={v => u({ transmission: v })} min={0} max={100} step={0.1} /></Row>
      <Row label="RF Freq." unit="MHz"><Num value={data.rfFrequency} onChange={v => u({ rfFrequency: v })} step={0.001} /></Row>
      <Row label="RF Power" unit="dBm"><Num value={data.rfPower} onChange={v => u({ rfPower: v })} /></Row>
    </>;
    case 'slm': return <>
      <Row label="Pixels"><Inp type="text" value={data.pixelCount} onChange={e => u({ pixelCount: e.target.value })} /></Row>
      <Row label="Frame Rate" unit="Hz"><Num value={data.frameRate} onChange={v => u({ frameRate: v })} min={1} /></Row>
    </>;
    case 'galvo': return <>
      <Row label="Scan Angle" unit="°"><Num value={data.scanAngleRange} onChange={v => u({ scanAngleRange: v })} min={0} /></Row>
      <Row label="Scan Freq." unit="Hz"><Num value={data.scanFrequency} onChange={v => u({ scanFrequency: v })} min={0} /></Row>
    </>;
    case 'photodiode': return <>
      <Row label="Bandwidth" unit="MHz"><Num value={data.bandwidth} onChange={v => u({ bandwidth: v })} min={0} /></Row>
      <Row label="Signal factor" unit="V/mW">
        <Num value={data.signalFactor} onChange={v => u({ signalFactor: v })} min={0} step={0.1} />
      </Row>
      <Toggle checked={data.showSignal === true} onChange={v => u({ showSignal: v })} label="Show signal on canvas" />
      <Hint>
        Volts per mW as read on a scope — the diode's responsivity together with whatever
        transimpedance or amplifier gain follows it, which is what you calibrate on the
        bench.
      </Hint>
    </>;
    case 'apd': return <>
      <Row label="Gain"><Num value={data.gain} onChange={v => u({ gain: v })} min={1} /></Row>
      <Row label="Bandwidth" unit="MHz"><Num value={data.bandwidth} onChange={v => u({ bandwidth: v })} min={0} /></Row>
    </>;
    case 'camera': return <>
      <Row label="Resolution"><Inp type="text" value={data.resolution} onChange={e => u({ resolution: e.target.value })} /></Row>
      <Row label="Pixel Size" unit="μm"><Num value={data.pixelSize} onChange={v => u({ pixelSize: v })} min={0.1} step={0.1} /></Row>
      <Row label="Frame Rate" unit="fps"><Num value={data.frameRate} onChange={v => u({ frameRate: v })} min={1} /></Row>
    </>;
    case 'beam_profiler': return <>
      <Row label="Sensor Size" unit="mm"><Num value={data.sensorSize} onChange={v => u({ sensorSize: v })} min={0.1} step={0.1} /></Row>
    </>;
    case 'beam_block': return <Hint>Terminates beam — no output.</Hint>;
    case 'shg_crystal': return <>
      <Row label="Geometry">
        <Sel value={data.geometry} onChange={e => u({ geometry: e.target.value })}>
          <option value="bulk">Bulk</option>
          <option value="waveguide">Waveguide</option>
        </Sel>
      </Row>
      <Row label="Temperature" unit="°C"><Num value={data.temperature} onChange={v => u({ temperature: v })} min={-50} max={500} /></Row>
      <Row label="Efficiency" unit="%"><Num value={data.conversionEfficiency} onChange={v => u({ conversionEfficiency: v })} min={0} max={100} step={0.1} /></Row>
      <Hint>Output: 2ω (SH) + residual ω</Hint>
    </>;
    case 'sfg_crystal': return <>
      <Row label="Geometry">
        <Sel value={data.geometry} onChange={e => u({ geometry: e.target.value })}>
          <option value="bulk">Bulk</option>
          <option value="waveguide">Waveguide</option>
        </Sel>
      </Row>
      <Row label="Temperature" unit="°C"><Num value={data.temperature} onChange={v => u({ temperature: v })} min={-50} max={500} /></Row>
      <Row label="Efficiency" unit="%"><Num value={data.conversionEfficiency} onChange={v => u({ conversionEfficiency: v })} min={0} max={100} step={0.1} /></Row>
      <Hint>Inputs: ω₁ (left) + ω₂ (bottom) → ω₃ (right)</Hint>
    </>;
    case 'fabry_perot': return <>
      <Row label="Linewidth" unit="MHz"><Num value={data.linewidth} onChange={v => u({ linewidth: v })} min={0} step={0.01} /></Row>
      <Row label="FSR" unit="MHz"><Num value={data.fsr} onChange={v => u({ fsr: v })} min={0} /></Row>
      <Row label="Finesse"><Num value={data.finesse} onChange={v => u({ finesse: v })} min={1} /></Row>
    </>;
    case 'reference_cavity': return <>
      <Row label="Linewidth" unit="kHz"><Num value={data.linewidth} onChange={v => u({ linewidth: v })} min={0} step={0.1} /></Row>
      <Row label="FSR" unit="GHz"><Num value={data.fsr} onChange={v => u({ fsr: v })} min={0} step={0.01} /></Row>
      <Row label="Finesse"><Num value={data.finesse} onChange={v => u({ finesse: v })} min={1} /></Row>
    </>;
    case 'delay_line': return <>
      <Row label="Delay" unit="m"><Num value={data.delayLength} onChange={v => u({ delayLength: v })} min={0} step={0.1} /></Row>
    </>;
    case 'vapor_cell': return <>
      <Row label="Species">
        <Sel value={data.species} onChange={e => u({ species: e.target.value })}>
          <option value="Rb">Rb</option>
          <option value="Cs">Cs</option>
          <option value="K">K</option>
          <option value="Na">Na</option>
          <option value="Sr">Sr</option>
          <option value="other">Other</option>
        </Sel>
      </Row>
      <Row label="Length" unit="mm"><Num value={data.length} onChange={v => u({ length: v })} min={1} step={5} /></Row>
      <Row label="Temperature" unit="°C"><Num value={data.temperature} onChange={v => u({ temperature: v })} step={1} /></Row>
      <Row label="Window wedge" unit="°"><Num value={data.windowAngle} onChange={v => u({ windowAngle: v })} min={0} max={30} step={1} /></Row>
      <Row label="Buffer gas"><Inp type="text" value={data.bufferGas ?? ''} placeholder="none"
        onChange={e => u({ bufferGas: e.target.value })} /></Row>
      <Hint>
        Resonant absorption isn't modelled — the beam passes through. Use Loss below for
        attenuation. The wedge angle tilts the end windows in the icon.
      </Hint>
    </>;
    case 'power_probe': return <>
      <Toggle checked={data.showWavelength === true} onChange={v => u({ showWavelength: v })} label="Show wavelength" />
      <Toggle checked={data.showDetuning === true} onChange={v => u({ showDetuning: v })} label="Show detuning" />
      <Toggle checked={data.showSpot === true} onChange={v => u({ showSpot: v })} label="Show spot size" />
      <Hint>
        Not an optic — it reads the beam it sits on without affecting it, and snaps onto
        the nearest one. Drag the readout to move it independently of the probe point.
        Power is constant between components, so sliding along one beam won't change it;
        spot size will.
      </Hint>
    </>;
    case 'region': return <>
      <Row label="Caption"><Inp type="text" value={data.caption ?? ''} placeholder="none"
        onChange={e => u({ caption: e.target.value })} /></Row>
      <Row label="Shape">
        <Sel value={data.shape} onChange={e => u({ shape: e.target.value as 'rect' | 'ellipse' })}>
          <option value="rect">Rectangle</option>
          <option value="ellipse">Ellipse</option>
        </Sel>
      </Row>
      <Row label="Colour"><Swatches value={data.colour} onChange={c => u({ colour: c })} /></Row>
      <Row label="Wash" unit="%">
        <Num value={Math.round(data.fillOpacity * 100)} onChange={v => u({ fillOpacity: v / 100 })}
          min={0} max={60} step={2} />
      </Row>
      <Row label="Width" unit="px"><Num value={Math.round(data.w)} onChange={v => u({ w: v })} min={48} step={10} /></Row>
      <Row label="Height" unit="px"><Num value={Math.round(data.h)} onChange={v => u({ h: v })} min={48} step={10} /></Row>
      <Hint>
        Not an optic — a wash behind the bench for saying which part of it a caption is
        about. Drag it by its border so the components inside stay clickable, and resize it
        from the handles when it is selected.
      </Hint>
    </>;
    case 'note': return <>
      <Row label="Text">
        <textarea
          value={data.text}
          onChange={e => u({ text: e.target.value })}
          rows={3}
          className="w-full px-1.5 py-1 rounded text-xs"
          style={{ background: 'transparent', border: '1px solid #94a3b855', color: 'inherit', resize: 'vertical' }}
        />
      </Row>
      <Row label="Size" unit="px"><Num value={data.fontSize} onChange={v => u({ fontSize: v })} min={6} max={48} step={1} /></Row>
      <Row label="Colour"><Swatches value={data.colour} onChange={c => u({ colour: c })} /></Row>
      <Row label="Align">
        <Sel value={data.align} onChange={e => u({ align: e.target.value as 'left' | 'center' })}>
          <option value="left">Left</option>
          <option value="center">Centre</option>
        </Sel>
      </Row>
      <Row label="Wrap width" unit="px"><Num value={Math.round(data.w)} onChange={v => u({ w: v })} min={40} step={10} /></Row>
      <Hint>
        Takes a small markup, not LaTeX: {'\\lambda'}, {'\\Delta'}, {'\\times'} and the rest
        of the Greek and symbol names, plus {'^{...}'} and {'_{...}'} for scripts. It renders to
        plain characters, which is what lets the figure export as vector text — a real TeX
        engine could not.
      </Hint>
    </>;
    default: return <Hint>No configurable properties.</Hint>;
  }
}

/** Colour picker for annotations: the fixed palette, because a figure wants few colours. */
const Swatches: React.FC<{ value: string; onChange: (c: string) => void }> = ({ value, onChange }) => (
  <div className="flex gap-1">
    {ANNOTATION_COLOURS.map(c => (
      <button
        key={c}
        onClick={() => onChange(c)}
        title={c}
        style={{
          width: 16, height: 16, borderRadius: 4, background: c,
          border: value.toLowerCase() === c.toLowerCase() ? '2px solid #e2e8f0' : '1px solid #64748b55',
          cursor: 'pointer',
        }}
      />
    ))}
  </div>
);

// ── Main component ─────────────────────────────────────────────────────────────

export const PropertiesPanel: React.FC = () => {
  const nodes          = useLayout(s => s.nodes);
  const selectedNodeId = useLayout(s => s.selectedNodeId);
  const updateNodeData = useLayout(s => s.updateNodeData);
  const nodeBeams      = useLayout(s => s.nodeBeams);
  const nodeArrivals   = useLayout(s => s.nodeArrivals);
  const allWarnings    = useLayout(s => s.warnings);

  const node = nodes.find(n => n.id === selectedNodeId);

  if (!node) {
    return (
      <div style={{
        width: 224, background: '#0f1117', borderLeft: '1px solid #1f2937',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', color: '#4b5563', fontSize: 12, gap: 6,
        userSelect: 'none',
      }}>
        <div style={{ fontSize: 22, opacity: 0.5 }}>⚙</div>
        <div style={{ textAlign: 'center', lineHeight: 1.5 }}>Select a component<br/>to edit properties</div>
      </div>
    );
  }

  const data     = node.data;
  const isAnnotation = ANNOTATION_NODE_TYPES.has(node?.type ?? '');
  const catColor = CATEGORY_COLORS[data.category];
  // Beam arriving at this component, keyed by node id (the trace publishes both
  // an edge-keyed and a node-keyed map). `beam` is the strongest arrival, which is what
  // the optics act on; `arrivals` is everything that landed, which is what a detector reads.
  const beam     = nodeBeams.get(node.id) ?? null;
  const arrivals = nodeArrivals.get(node.id) ?? (beam ? [beam] : []);
  const total    = incidentPower(arrivals);
  const volts    = detectorVolts(data, total);
  const beat     = detectorBeat(data, arrivals);

  return (
    <div style={{
      width: 224, background: '#0f1117', borderLeft: '1px solid #1f2937',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: '10px 12px 8px', borderBottom: '1px solid #1f2937',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: '#1e2030',
          border: `1.5px solid ${catColor}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          {getNodeIcon(data.type, 18, catColor)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.name}</div>
          <div style={{ fontSize: 10, color: catColor, marginTop: 1 }}>{data.category.charAt(0).toUpperCase() + data.category.slice(1)}</div>
        </div>
        {/* Lock / Unlock button */}
        <button
          title={data.locked ? 'Float (unfix position)' : 'Fix position'}
          onClick={() => updateNodeData(node.id, { locked: !data.locked })}
          style={{
            width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0,
            background: data.locked ? '#92400e' : '#1e2030',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={data.locked ? '#fbbf24' : '#6b7280'} strokeWidth="1.3">
            <rect x="1.5" y="5.5" width="10" height="7" rx="1.5" fill={data.locked ? '#fbbf24' : 'none'} fillOpacity="0.25"/>
            {data.locked
              ? <path d="M3.5 5.5V4A3 3 0 0 1 9.5 4v1.5" strokeLinecap="round"/>
              : <path d="M3.5 5.5V4A3 3 0 0 1 9.5 4" strokeLinecap="round"/>
            }
          </svg>
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>

        {/* Physical problems the trace found with this component */}
        {(allWarnings.get(node.id) ?? []).map((msg, i) => (
          <div key={i} style={{
            display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 8,
            background: 'rgba(146,64,14,0.18)', border: '1px solid #92400e',
            borderRadius: 6, padding: '6px 8px', fontSize: 10.5, lineHeight: 1.45,
            color: '#fcd34d',
          }}>
            <span style={{ flexShrink: 0 }}>⚠</span>
            <span>{msg}</span>
          </div>
        ))}


        {/* Name */}
        <Row label="Name">
          <Inp type="text" value={data.name} onChange={e => updateNodeData(node.id, { name: e.target.value })} />
        </Row>

        {/* An annotation is not on the beam path: it has no aperture, no orientation on the
            15° lattice and no name label to show. Its own fields are the whole story. */}
        {!isAnnotation && <>
          {/* Aperture */}
          <Row label="Aperture" unit="mm">
            <Inp type="number" value={data.aperture ?? ''} placeholder="—"
              onChange={e => updateNodeData(node.id, { aperture: parseFloat(e.target.value) || undefined })} />
          </Row>

          <Toggle
            checked={data.showLabel === true}
            onChange={v => updateNodeData(node.id, { showLabel: v })}
            label="Show label"
          />

          {/* Angle. One control for everything, stepping on the component's own grain:
              7.5° for a mirror-like surface, 15° for a body lying along the beam. The
              quick buttons cover the four orientations that used to be the only choices. */}
          <Row label="Angle" unit="°">
            <AngleControl
              value={norm360(data.rotation ?? 0)}
              step={angleStepFor(data.type)}
              surface={SURFACE_AT_45.has(data.type)}
              onChange={deg => updateNodeData(node.id, { rotation: deg })}
            />
          </Row>
        </>}

        <Divider />

        {/* Type-specific fields */}
        {renderFields(data, partial => updateNodeData(node.id, partial as Partial<OpticalNodeData>))}

        {/* Loss — shown for all beam-path components */}
        {(new Set([
          'optical_amplifier',
          'isolator', 'linear_polarizer', 'hwp', 'qwp', 'nd_filter', 'iris',
          'dielectric_mirror', 'dichroic_mirror', 'npbs', 'pbs',
          'nonlinear_crystal', 'shg_crystal', 'sfg_crystal',
          'plano_convex', 'plano_concave',
          'fiber_coupler', 'fiber_launcher', 'fiber_cable',
          'aom', 'aod', 'eom', 'slm', 'galvo',
          'fabry_perot', 'reference_cavity', 'delay_line', 'vapor_cell',
        ]) as Set<string>).has(data.type) && <>
          <Divider />
          <Row label="Loss" unit="%">
            <Num value={(data as { loss?: number }).loss ?? 0}
              onChange={v => updateNodeData(node.id, { loss: v })}
              min={0} max={100} step={0.1} />
          </Row>
        </>}

        {/* ── Traced beam: what arrives, and what leaves each output port ── */}
        {beam && <>
          <Divider />
          {/* An emitter's recorded beam is the one it launches, not one arriving. */}
          {isEmitter(data.type)
            ? <BeamReadout title="Output Beam" beam={beam} />
            : <>
                {/* Several beams can land on one component. Each is listed; the optics
                    downstream are resolved from the strongest, but a detector adds them up. */}
                {arrivals.map((b, i) => (
                  <BeamReadout
                    key={i}
                    title={arrivals.length > 1 ? `Input Beam ${i + 1}` : 'Input Beam'}
                    beam={b}
                  />
                ))}
                {componentOutputs(beam, data).map(port => (
                  <BeamReadout
                    key={port.handle}
                    title={`${PORT_LABELS[port.handle] ?? `Output ${port.handle}`}${port.dumped ? ` — ${port.dumpedAs ?? 'dumped'}` : ''}`}
                    beam={port.beam}
                    muted={port.dumped}
                  />
                ))}
              </>}

          {/* What the scope would show for this detector: the total of every beam on it. */}
          {volts !== null && (
            <div style={{
              background: '#151820', borderRadius: 6, padding: '7px 9px', marginBottom: 8,
              border: '1px solid #1f2937', fontSize: 11, color: '#cbd5e1',
              display: 'grid', gridTemplateColumns: '52px 1fr', lineHeight: 1.8,
            }}>
              <span style={{ color: '#6b7280' }} title="Signal factor × total incident power">Signal</span>
              <span>{formatVoltage(volts)}</span>
              {arrivals.length > 1 && <>
                <span style={{ color: '#6b7280' }} title="Total power landing on the active area">ΣP</span>
                <span>
                  {`${total! >= 1 ? total!.toFixed(2) : (total! * 1000).toFixed(1)} ${total! >= 1 ? 'mW' : 'µW'} · ${arrivals.length} beams`}
                </span>
              </>}
            </div>
          )}

          {/* Two beams of different frequency really produce a beat; this model doesn't. */}
          {beat && detectorVolts(data, 0) !== null && (
            <Hint>
              The inputs differ by {formatDetuning(beat.hz)?.replace('+', '') || `${beat.hz} Hz`}, so a
              real detector would show a beat note{beat.withinBandwidth
                ? ' — within its bandwidth.'
                : ', though above its bandwidth.'} Only the summed power is modelled here:
              relative phase isn't tracked, so no interference term.
            </Hint>
          )}
        </>}
      </div>
    </div>
  );
};
