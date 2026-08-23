// Reading the beam at an arbitrary point.
//
// A power probe is an annotation, not an optic: it must not terminate, attenuate or
// split anything, so it is kept out of the trace entirely (like the phantom endpoints)
// and instead looks up the beam that already passes through it.
//
// Power only changes at components, so it is constant along a segment — sliding a probe
// along one beam won't change the power reading, only which beam it finds. The Gaussian
// spot *does* vary, so the reading is advanced to the probe's exact position.
import type { BeamSegment, BeamState } from '../types/beam';
import { drawnEndpoints } from './beamLayout';
import { advanceBeam } from './propagate';
import { pxToMm, formatSpot } from './scale';
import { formatDetuning } from './wavelength';
import { nearestOnSegment, type Pt } from './geometry';

/**
 * How far (px) a probe may sit from a beam and still read it. Deliberately looser than
 * `BEAM_SNAP_DIST`: a probe is placed by hand as an annotation, not aligned like an optic.
 */
export const PROBE_REACH = 30;

export interface ProbeHit {
  segment: BeamSegment;
  /** Perpendicular distance from the probe to the drawn beam, px. */
  distance: number;
  /** Distance from the segment's start to the projected point, px. */
  along: number;
  /** The point on the beam the probe reads — where its circle should sit. */
  point: Pt;
}

/** The drawn beam nearest `point`, or null if none is within `reach`. */
export function nearestBeam(
  segments: BeamSegment[],
  point: Pt,
  reach = PROBE_REACH,
): ProbeHit | null {
  let best: ProbeHit | null = null;

  for (const segment of segments) {
    const { x1, y1, x2, y2 } = drawnEndpoints(segment);
    // A zero-length segment is not a beam: it has no direction to read a spot size along,
    // so it is skipped rather than reported as a hit at distance 0.
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-9) continue;
    // Clamped to the segment's ends, so a probe past the end of a beam reads the end
    // rather than the infinite line it lies on.
    const hit = nearestOnSegment(point, { x: x1, y: y1 }, { x: x2, y: y2 });
    if (hit.distance > reach) continue;
    if (!best || hit.distance < best.distance) {
      best = { segment, distance: hit.distance, along: hit.along, point: hit.point };
    }
  }

  return best;
}

/**
 * Positions that put each probe exactly on the beam it reads.
 *
 * The optics are snapped by the tracer, which never sees probes, so this runs afterwards
 * over the finished segments. Returns top-left positions, matching `RouteResult.snaps`,
 * so the caller can merge the two and apply them in one pass.
 */
export function probeSnaps(
  probes: { id: string; position: Pt; width: number; height: number; locked?: boolean }[],
  segments: BeamSegment[],
  reach = PROBE_REACH,
): Map<string, Pt> {
  const snaps = new Map<string, Pt>();
  for (const probe of probes) {
    if (probe.locked) continue;
    const centre = { x: probe.position.x + probe.width / 2, y: probe.position.y + probe.height / 2 };
    const hit = nearestBeam(segments, centre, reach);
    if (!hit) continue;
    const next = { x: hit.point.x - probe.width / 2, y: hit.point.y - probe.height / 2 };
    if (Math.abs(next.x - probe.position.x) > 0.5 || Math.abs(next.y - probe.position.y) > 0.5) {
      snaps.set(probe.id, next);
    }
  }
  return snaps;
}

/**
 * The beam at `point`, advanced along its segment so the spot size is the one at that
 * plane rather than at the segment's start. Null when no beam is in reach.
 */
export function probeBeam(
  segments: BeamSegment[],
  point: Pt,
  reach = PROBE_REACH,
): { hit: ProbeHit; beam: BeamState } | null {
  const hit = nearestBeam(segments, point, reach);
  if (!hit) return null;
  return { hit, beam: advanceBeam(hit.segment.beam, pxToMm(hit.along)) };
}

// ── Readout ───────────────────────────────────────────────────────────────────

/** Power for a probe readout — finer-grained than the beam labels, down to nW. */
export function formatProbePower(mW: number): string {
  if (mW >= 1000)  return `${(mW / 1000).toFixed(3)} W`;
  if (mW >= 0.5)   return `${mW.toFixed(2)} mW`;
  if (mW >= 0.001) return `${(mW * 1000).toFixed(1)} µW`;
  return `${(mW * 1e6).toFixed(0)} nW`;
}

/** What a probe prints, given the beam it found. Shared by both views. */
export function probeLines(
  opts: { showWavelength?: boolean; showDetuning?: boolean; showSpot?: boolean },
  beam: BeamState | null,
): string[] {
  if (!beam) return ['no beam'];
  const lines = [formatProbePower(beam.power)];
  if (opts.showWavelength) lines.push(`${Math.round(beam.wavelength)} nm`);
  if (opts.showDetuning) {
    const det = formatDetuning(beam.detuningHz);
    if (det) lines.push(det);
  }
  if (opts.showSpot && beam.w != null) lines.push(`w = ${formatSpot(beam.w)}`);
  return lines;
}
