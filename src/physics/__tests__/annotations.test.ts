import { describe, it, expect } from 'vitest';
import {
  getAnnotations, annotationRows, annotationBox,
  ANNOTATION_FONT_PX, ANNOTATION_ROW_PX, ANNOTATION_GAP_PX,
} from '../../utils/annotations';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';

const mirror = { type: 'dielectric_mirror', name: 'M', category: 'steering', reflectivity: 99.5 } as OpticalNodeData;
const iris = { type: 'iris', name: 'I', category: 'conditioning', apertureDiameter: 10 } as OpticalNodeData;
const laser = {
  type: 'laser_source', name: 'L', category: 'source',
  wavelength: 780, outputPower: 100, polarization: 'H',
} as OpticalNodeData;

describe('annotationRows', () => {
  it('is the text the figure draws, one row per key', () => {
    expect(annotationRows(mirror)).toEqual(['R=99.5%']);
    expect(annotationRows(laser)).toEqual(['λ=780 nm', 'P=100 mW', 'pol=H']);
  });

  it('is empty for a component that annotates nothing', () => {
    expect(getAnnotations(iris)).toEqual({});
    expect(annotationRows(iris)).toEqual([]);
  });
});

describe('annotationBox', () => {
  it('is null when there is nothing to print', () => {
    expect(annotationBox(iris)).toBeNull();
  });

  it('sits above the component, clear of its box', () => {
    const hh = getNodeGeometry('dielectric_mirror').height / 2;
    const box = annotationBox(mirror)!;
    // Bottom edge of the box is the descent of the lowest row, one gap above the component.
    expect(box.dy + box.halfHeight).toBeCloseTo(-hh - ANNOTATION_GAP_PX + ANNOTATION_FONT_PX * 0.2, 9);
    expect(box.dy).toBeLessThan(-hh);
  });

  it('grows upwards by one row pitch per extra line', () => {
    const one = annotationBox(mirror)!;
    const three = annotationBox(laser)!;
    // Same component height would give exactly 2 × the pitch; these differ in height, so
    // compare the spans instead.
    expect(three.halfHeight - one.halfHeight).toBeCloseTo(ANNOTATION_ROW_PX, 9);
  });

  it('is as wide as its longest row', () => {
    const box = annotationBox(laser)!;
    const widest = annotationRows(laser).reduce((a, b) => (b.length > a.length ? b : a));
    expect(box.halfWidth).toBeCloseTo(widest.length * ANNOTATION_FONT_PX * 0.6 / 2, 9);
    // A one-row component with a shorter string is narrower.
    expect(annotationBox(mirror)!.halfWidth).toBeLessThan(box.halfWidth);
  });

  it('follows the component as it turns, because the box under it does', () => {
    // Annotations are drawn axis-aligned above the *occupied* box, so standing a component
    // on end pushes them further out.
    const flat = annotationBox({ ...mirror, rotation: 0 } as OpticalNodeData)!;
    const turned = annotationBox({ ...mirror, rotation: 45 } as OpticalNodeData)!;
    expect(turned.dy).toBeLessThan(flat.dy);
  });
});
