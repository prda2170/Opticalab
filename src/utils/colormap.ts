// Map optical wavelength (nm) to RGB color
// Visible spectrum: ~380–700nm
// IR wavelengths shown as dashed dark red

export function wavelengthToRGB(nm: number): string {
  if (nm < 380 || nm > 1200) return '#888888';

  // Near-IR: dashed lines; use bright-enough reds to be visible on dark canvas
  if (nm > 700) {
    if (nm <= 800)  return '#dd3300'; // near-IR  (780nm Rb, 813nm Sr)
    if (nm <= 1100) return '#aa2200'; // IR       (852nm Cs, 1064nm Nd:YAG)
    return '#773300';                 // deep-IR  (1550nm telecom, etc.)
  }

  let r = 0, g = 0, b = 0;

  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (nm >= 440 && nm < 490) {
    r = 0;
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm >= 490 && nm < 510) {
    r = 0;
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (nm >= 580 && nm < 645) {
    r = 1;
    g = -(nm - 645) / (645 - 580);
    b = 0;
  } else if (nm >= 645 && nm <= 700) {
    r = 1;
    g = 0;
    b = 0;
  }

  // Intensity correction at edges
  let factor = 1.0;
  if (nm >= 380 && nm < 420) factor = 0.3 + 0.7 * (nm - 380) / (420 - 380);
  else if (nm > 680 && nm <= 700) factor = 0.3 + 0.7 * (700 - nm) / (700 - 680);

  const R = Math.round(255 * Math.pow(r * factor, 0.8));
  const G = Math.round(255 * Math.pow(g * factor, 0.8));
  const B = Math.round(255 * Math.pow(b * factor, 0.8));

  return `rgb(${R},${G},${B})`;
}

// Returns stroke-dasharray for IR beams
export function wavelengthDashArray(nm: number): string {
  if (nm > 700) return '6,3';
  return '0';
}

// Known laser wavelengths mapped to common names
export const KNOWN_WAVELENGTHS: Record<number, string> = {
  405: '405nm (violet diode)',
  445: '445nm (blue diode)',
  488: '488nm (Ar-ion / diode)',
  515: '515nm (Yb fiber freq-doubled)',
  532: '532nm (Nd:YAG SHG)',
  556: '556nm (Yb MOT)',
  589: '589nm (Na D2)',
  633: '633nm (HeNe)',
  671: '671nm (Li D)',
  689: '689nm (Sr clock)',
  780: '780nm (Rb D2)',
  813: '813nm (Sr MOT)',
  852: '852nm (Cs D2)',
  1064: '1064nm (Nd:YAG)',
};
