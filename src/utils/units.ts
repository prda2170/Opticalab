// Formatting for the non-optical numbers a layout records about its sources.
//
// Kept out of the panels so both views (and their tests) quote a laser the same way.

/**
 * A source's own output power, mW in, W once the figure gets large — the way a spec sheet
 * quotes it. This is a *stated* power, unlike `physics/scale`'s beam formatting, which
 * describes the traced beam.
 */
export function formatSourcePower(mW: number): string {
  return mW >= 1000 ? `${(mW / 1000).toFixed(2)} W` : `${mW} mW`;
}

/**
 * Drive current, quoted in amps once the numbers get big, as a tapered amplifier's spec
 * sheet does. Stored in mA throughout so lasers (~100 mA) and TAs (~2 A) share one field.
 */
export function formatCurrent(mA: number): string {
  return mA >= 1000 ? `${(mA / 1000).toFixed(2)} A` : `${mA} mA`;
}
