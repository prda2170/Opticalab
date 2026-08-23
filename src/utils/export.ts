// Export utilities for OpticaLab

import type { Node, Edge } from '@xyflow/react';
import type { OpticalNodeData, BeamEdgeData } from '../types/components';
import { isKnownComponentType } from './nodeGeometry';

// ── Layout files ──────────────────────────────────────────────────────────────
//
// A layout file is the node and edge arrays as they sit in the store, plus a version.
// The version is *load-bearing*: component fields have been renamed more than once, and a
// file written before a rename must not be read as though the field simply wasn't set —
// that way an amplifier with no `outputPower` computes a NaN power and quietly poisons
// every beam downstream of it.
//
// So loading is: check the version, migrate forward, validate, and report what changed.
// Nothing is silently dropped without a note the UI can show.

/**
 * Schema version written by this build.
 *
 * Bump the **minor** for an additive or migratable change and add a `Migration` below;
 * bump the **major** only for a change no migration can express, since a major ahead of
 * this build is refused rather than guessed at.
 */
export const LAYOUT_VERSION = '1.1';

/** What a layout file looks like on disk. `metadata` is informational only. */
interface LayoutFile {
  version?: string;
  metadata?: { created?: string; app?: string };
  nodes?: unknown;
  edges?: unknown;
}

export interface LoadedLayout {
  nodes: Node<OpticalNodeData>[];
  /**
   * User-drawn wiring only. An edge's `data` is beam state, which the tracer rebuilds on
   * every pass, so whatever a file happens to carry there is not part of the contract.
   */
  edges: Edge<BeamEdgeData>[];
  /** The version stamped in the file, or null if it had none (i.e. pre-versioning). */
  fileVersion: string | null;
  /**
   * Human-readable notes about anything migrated or dropped on the way in. Empty for a
   * current, clean file. Worth showing the user: every entry means their file and what
   * they now see differ.
   */
  notes: string[];
}

export function layoutToJSON(
  nodes: Node<OpticalNodeData>[],
  edges: Edge<BeamEdgeData>[],
): string {
  return JSON.stringify(
    {
      version: LAYOUT_VERSION,
      metadata: { created: new Date().toISOString(), app: 'OpticaLab' },
      nodes,
      edges,
    },
    null,
    2,
  );
}

/** `[major, minor]`, defaulting a missing or unparseable version to the first release. */
function parseVersion(v: string | null | undefined): [number, number] {
  const m = /^(\d+)\.(\d+)/.exec(String(v ?? '1.0'));
  return m ? [Number(m[1]), Number(m[2])] : [1, 0];
}

/** True when `a` is strictly older than `b`. */
function isOlder(a: [number, number], b: [number, number]): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
}

interface Migration {
  /** The version this migration brings a file up to. */
  to: string;
  /** Applied to one node's `data`; may mutate it. Push a note for anything lossy. */
  node(data: Record<string, unknown>, notes: Set<string>): void;
}

/**
 * Ordered oldest-first. A file is run through every migration whose `to` is newer than the
 * file's own version, so a 1.0 file gets all of them and a current file gets none.
 */
const MIGRATIONS: Migration[] = [
  {
    to: '1.1',
    node(data, notes) {
      // A photodiode was characterised by responsivity in A/W; it now carries the whole
      // chain's V/mW. There is no exact conversion — the missing factor is the
      // transimpedance — so assume the reference case of a bare diode into 50 Ω:
      // V/mW = R[A/W] × 50 Ω × 1e-3 W/mW.
      if (data.type === 'photodiode' && data.signalFactor === undefined) {
        const r = typeof data.responsivity === 'number' ? data.responsivity : null;
        data.signalFactor = r !== null ? r * 50e-3 : 1;
        delete data.responsivity;
        notes.add(r !== null
          ? `Photodiode responsivity converted to a signal factor assuming a 50 Ω load (${r} A/W → ${(r * 50e-3).toFixed(3)} V/mW). Set it to your real V/mW if you use a transimpedance amplifier.`
          : 'Photodiode had no responsivity; its signal factor defaults to 1 V/mW.');
      }

      // An amplifier was a saturable gain stage (min(P_in·G, P_sat)); it now states its
      // output power outright. The saturated figure is the closest single number to what
      // the old model delivered when driven, so use that where there is one.
      if (data.type === 'optical_amplifier' && data.outputPower === undefined) {
        const sat = typeof data.saturatedPower === 'number' ? data.saturatedPower : 0;
        data.outputPower = sat > 0 ? sat : 1000;
        notes.add(sat > 0
          ? `Optical amplifier gain/saturation replaced by a stated output power (${sat} mW, from its saturated figure).`
          : 'Optical amplifier had no saturated power, so its output power defaults to 1000 mW.');
        delete data.gain;
        delete data.saturatedPower;
      }
    },
  },
];

/** Shape check: a node xyflow can place and the tracer can read. */
function isPlaceable(node: unknown): node is Node<OpticalNodeData> & { type?: string } {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as { id?: unknown; position?: { x?: unknown; y?: unknown } };
  return typeof n.id === 'string'
    && typeof n.position === 'object' && n.position !== null
    && Number.isFinite(n.position.x) && Number.isFinite(n.position.y);
}

/**
 * Read a layout file: parse, check the version, migrate, validate, report.
 *
 * Throws only for input that cannot be a layout at all — unparseable JSON, no node array,
 * or a *major* version this build does not know. Everything else is repaired and noted.
 */
export function layoutFromJSON(json: string): LoadedLayout {
  let data: LayoutFile;
  try {
    data = JSON.parse(json) as LayoutFile;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null || !Array.isArray(data.nodes)) {
    throw new Error('That file does not look like an OpticaLab layout (no node list).');
  }

  const fileVersion = typeof data.version === 'string' ? data.version : null;
  const from = parseVersion(fileVersion);
  const here = parseVersion(LAYOUT_VERSION);
  if (from[0] > here[0]) {
    throw new Error(
      `This layout was saved by a newer version of OpticaLab (file format ${fileVersion}, `
      + `this build reads ${LAYOUT_VERSION}). Update the app to open it.`,
    );
  }

  const due = MIGRATIONS.filter(m => isOlder(from, parseVersion(m.to)));
  const noteSet = new Set<string>();
  if (due.length > 0) {
    noteSet.add(`Layout was saved in format ${fileVersion ?? '1.0'} and has been brought up to ${LAYOUT_VERSION}.`);
  }

  const nodes: Node<OpticalNodeData>[] = [];
  const dropped: string[] = [];
  const unknownTypes = new Set<string>();

  for (const raw of data.nodes) {
    if (!isPlaceable(raw)) {
      dropped.push('(malformed)');
      continue;
    }
    const node = raw as Node<OpticalNodeData> & { type?: string };

    // Phantom beam endpoints are regenerated by every trace; a saved one is stale noise.
    if (node.type === 'beam_endpoint') continue;

    const nodeData = (node.data ?? {}) as unknown as Record<string, unknown>;
    const type = nodeData.type;
    if (typeof type !== 'string' || !isKnownComponentType(type)) {
      dropped.push(node.id);
      if (typeof type === 'string') unknownTypes.add(type);
      continue;
    }

    for (const m of due) m.node(nodeData, noteSet);
    nodes.push(node);
  }

  // An edge to a node that is gone would leave xyflow with a dangling reference.
  const keptIds = new Set(nodes.map(n => n.id));
  const rawEdges: unknown[] = Array.isArray(data.edges) ? data.edges : [];
  const edges = (rawEdges as Edge<BeamEdgeData>[]).filter(
    e => typeof e?.id === 'string' && keptIds.has(e.source) && keptIds.has(e.target),
  );

  if (dropped.length > 0) {
    const which = unknownTypes.size > 0 ? ` (${[...unknownTypes].join(', ')})` : '';
    noteSet.add(
      `${dropped.length} component${dropped.length === 1 ? '' : 's'} could not be read and `
      + `${dropped.length === 1 ? 'was' : 'were'} left out${which}. Components removed from `
      + 'the app in a later version look like this.',
    );
  }
  if (edges.length < rawEdges.length) {
    noteSet.add(`${rawEdges.length - edges.length} manual connection(s) referred to components that are gone, and were dropped.`);
  }

  return { nodes, edges, fileVersion, notes: [...noteSet] };
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
