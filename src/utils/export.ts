// Export utilities for OpticaLab

import type { Node, Edge } from '@xyflow/react';
import type { OpticalNodeData } from '../types/components';

// Export layout to JSON string
export function layoutToJSON(
  nodes: Node<OpticalNodeData>[],
  edges: Edge[],
): string {
  return JSON.stringify(
    {
      version: '1.0',
      metadata: { created: new Date().toISOString(), app: 'OpticaLab' },
      nodes,
      edges,
    },
    null,
    2,
  );
}

// Parse layout from JSON string
export function layoutFromJSON(json: string): {
  nodes: Node<OpticalNodeData>[];
  edges: Edge[];
} {
  const data = JSON.parse(json);
  return { nodes: data.nodes ?? [], edges: data.edges ?? [] };
}

// ── Figure export ─────────────────────────────────────────────────────────────
// The Diagram panel renders the whole layout as one self-contained <svg> (beams,
// component symbols and labels all as native SVG, no <foreignObject>), so both
// exports below are just that element serialised.

/** Serialise an <svg> element to a standalone SVG document string. */
export function serializeSVG(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // The on-screen element is sized by CSS (zoom); pin explicit dimensions from
  // the viewBox so the file has an intrinsic size.
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width && vb.height) {
    clone.setAttribute('width', String(vb.width));
    clone.setAttribute('height', String(vb.height));
  }
  clone.removeAttribute('style');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** Download an <svg> element as a .svg file. */
export function downloadSVG(svg: SVGSVGElement, filename = 'opticalab_diagram.svg'): void {
  downloadText(serializeSVG(svg), filename, 'image/svg+xml');
}

/**
 * Rasterise an <svg> element and download it as a PNG.
 * `scale` multiplies the viewBox size, so 2 gives a 2× resolution figure.
 */
export function downloadPNG(
  svg: SVGSVGElement,
  filename = 'opticalab_diagram.png',
  background = '#0f1117',
  scale = 2,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const vb = svg.viewBox.baseVal;
    const w = (vb?.width  || svg.clientWidth  || 1200);
    const h = (vb?.height || svg.clientHeight || 800);
    const url = URL.createObjectURL(new Blob([serializeSVG(svg)], { type: 'image/svg+xml;charset=utf-8' }));

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('no 2d context')); return; }
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('PNG encoding failed')); return; }
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(href);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG could not be rasterised')); };
    img.src = url;
  });
}

// ── Saving with a chosen path ─────────────────────────────────────────────────

/**
 * Minimal shape of the File System Access API we use. Not in every TS dom lib, and not
 * in every browser — `saveTextAs` falls back to a plain download when it is missing.
 */
interface SaveFilePicker {
  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>;
}

export type SaveOutcome = 'saved' | 'cancelled' | 'downloaded';

/**
 * Write text to a file the user picks, showing a real save dialog so they choose the
 * folder and name. Falls back to an ordinary download where the picker isn't available
 * (Firefox and Safari); Chromium — including the Electron build — has it.
 */
export async function saveTextAs(
  content: string,
  suggestedName: string,
  description: string,
  accept: Record<string, string[]>,
): Promise<SaveOutcome> {
  const picker = window as unknown as Partial<SaveFilePicker>;
  if (typeof picker.showSaveFilePicker === 'function') {
    try {
      const handle = await picker.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return 'saved';
    } catch (err) {
      // Dismissing the dialog is a normal outcome, not a failure to report.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      console.error('Save dialog failed, falling back to download:', err);
    }
  }
  downloadText(content, suggestedName, Object.keys(accept)[0] ?? 'application/octet-stream');
  return 'downloaded';
}

// Download a text file
export function downloadText(content: string, filename: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
