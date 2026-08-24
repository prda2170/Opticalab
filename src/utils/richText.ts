// Note text: enough typesetting for a figure caption, and no more.
//
// A lab figure needs `Δ = 2π×80 MHz`, `⁸⁷Rb`, `F=2 → F′=3`, `w₀ = 92 µm`. It does not need a
// TeX engine: MathJax's SVG output is a megabyte, and the alternatives that are smaller
// (KaTeX, MathML) render to HTML, which cannot go into a vector export. So notes take a small
// markup and turn it into runs of plain text, which both renderers can draw — HTML `<sup>` on
// the canvas, SVG `<tspan dy>` in the export — from the same parse.
//
// The markup:
//   \lambda \Delta \mu …   named symbols, from the table below
//   ^{...} or ^x           superscript
//   _{...} or _x           subscript
//   \\                     a literal backslash; \^ and \_ likewise
//   newlines               separate lines
//
// Unknown `\name` is left as typed, so a typo shows itself instead of vanishing.

/** Where a run sits relative to the baseline. */
export type Script = 'normal' | 'sup' | 'sub';

export interface Run {
  text: string;
  script: Script;
}

/**
 * Names worth having on a bench. Greek in both cases, the arrows and relations that turn up
 * in level diagrams, and the units and constants an AMO caption reaches for.
 */
export const SYMBOLS: Record<string, string> = {
  // Greek — lower case
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'µ', nu: 'ν', xi: 'ξ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', varphi: 'ϕ', vartheta: 'ϑ',
  // Greek — upper case
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Relations and arrows
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  uparrow: '↑', downarrow: '↓', Rightarrow: '⇒',
  approx: '≈', sim: '∼', simeq: '≃', neq: '≠', leq: '≤', geq: '≥',
  ll: '≪', gg: '≫', propto: '∝', equiv: '≡',
  // Operators and marks
  times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', deg: '°', prime: '′',
  infty: '∞', partial: '∂', nabla: '∇', sqrt: '√', sum: '∑', int: '∫',
  langle: '⟨', rangle: '⟩', hbar: 'ℏ', ell: 'ℓ',
  // Spacing and punctuation
  quad: ' ', ',': ' ', dots: '…', bullet: '•',
};

/** Characters that `\` escapes to themselves. */
const ESCAPABLE = new Set(['\\', '^', '_', '{', '}']);

function pushText(runs: Run[], text: string, script: Script) {
  if (text === '') return;
  const last = runs[runs.length - 1];
  if (last && last.script === script) last.text += text;
  else runs.push({ text, script });
}

/** Parse one line into runs. */
function parseLine(src: string): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const next = src[i + 1] ?? '';
      if (ESCAPABLE.has(next)) { pushText(runs, next, 'normal'); i += 2; continue; }
      // A name: letters, or one of the punctuation entries in the table.
      const m = /^[A-Za-z]+/.exec(src.slice(i + 1));
      const name = m ? m[0] : next;
      const symbol = SYMBOLS[name];
      if (symbol !== undefined) {
        pushText(runs, symbol, 'normal');
        i += 1 + name.length;
      } else {
        // Unknown — show it as typed rather than swallowing the author's mistake.
        pushText(runs, '\\' + name, 'normal');
        i += 1 + Math.max(name.length, 1);
      }
      continue;
    }

    if (ch === '^' || ch === '_') {
      const script: Script = ch === '^' ? 'sup' : 'sub';
      const rest = src.slice(i + 1);
      if (rest.startsWith('{')) {
        const close = rest.indexOf('}');
        if (close !== -1) {
          // Scripts can hold symbols, so the body is parsed too — one level, which is all
          // a caption ever needs.
          for (const run of parseLine(rest.slice(1, close))) pushText(runs, run.text, script);
          i += 2 + close;
          continue;
        }
      }
      if (rest.length > 0) {
        // Bare single character: `F^2`, `H_1`.
        for (const run of parseLine(rest[0])) pushText(runs, run.text, script);
        i += 2;
        continue;
      }
    }

    pushText(runs, ch, 'normal');
    i += 1;
  }
  return runs;
}

/**
 * Parse note text into lines of runs.
 *
 * Always returns at least one line, so a renderer can map over it without a special case for
 * the empty note.
 */
export function parseRich(src: string): Run[][] {
  const lines = String(src ?? '').split('\n');
  return lines.map(line => {
    const runs = parseLine(line);
    return runs.length > 0 ? runs : [{ text: '', script: 'normal' as Script }];
  });
}

/** Plain text of a parsed line, for width estimates and tooltips. */
export function richPlain(runs: Run[]): string {
  return runs.map(r => r.text).join('');
}

/** Script run sizing, shared by both renderers so a note exports as it looks. */
export const SCRIPT_SCALE = 0.72;
/** Baseline shift as a fraction of the full font size. */
export const SCRIPT_RISE = 0.34;
