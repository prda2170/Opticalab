// How large a component's icon actually draws.
//
// Most icons are square and fill `size × size`. A couple derive a wider box from their
// own artwork — a laser head and a vapour cell both lie along the beam — and any caller
// that positions an icon by hand (the diagram, which translates it into place) has to
// know which. Kept out of NodeIcons.tsx so that file exports only components.
import type { OpticalNodeData } from '../types/components';

/** Laser head artwork, 90×66. */
export const LASER_ASPECT = 90 / 66;

/** Vapour cell artwork, 88×44 — a tube twice as long as it is tall. */
export const VAPOR_CELL_ASPECT = 88 / 44;

/** Amplifier artwork, 64×44 — a module lying along the beam. */
export const AMPLIFIER_ASPECT = 64 / 44;

export function iconDimensions(
  type: OpticalNodeData['type'],
  size: number,
): { w: number; h: number } {
  switch (type) {
    case 'laser_source':      return { w: size * LASER_ASPECT, h: size };
    case 'vapor_cell':        return { w: size * VAPOR_CELL_ASPECT, h: size };
    case 'optical_amplifier':
    case 'fiber_amplifier':   return { w: size * AMPLIFIER_ASPECT, h: size };
    default:                  return { w: size, h: size };
  }
}
