// Free text on the bench, on the canvas.
//
// The runs come from `utils/richText`, which the SVG export parses too — so `Δ = 2π×80 MHz`
// lands the same way in the figure as it does here.
//
// Double-click to edit in place. That means handing the keyboard to a `<textarea>` inside an
// xyflow node, which needs three things: `nodrag`/`nowheel` so the canvas doesn't pan while
// you type or select, key events kept from bubbling (Delete would otherwise delete the node
// you are editing), and the *raw* markup on screen while editing — you type `\lambda`, you
// see `\lambda`, and it becomes λ when you are done.
import React, { useEffect, useRef, useState } from 'react';
import { NodeResizer, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { useLayout, useLayoutApi } from '../../store/layoutContext';
import type { NoteData } from '../../types/components';
import { parseRich, SCRIPT_SCALE, SCRIPT_RISE } from '../../utils/richText';
import { NOTE_STYLE } from '../../utils/annotationStyle';

const NoteNode: React.FC<NodeProps<Node<NoteData>>> = ({ id, data, selected }) => {
  const { updateNodeData } = useReactFlow();
  const setSelectedNode = useLayout(s => s.setSelectedNode);
  const saveSnapshot = useLayout(s => s.saveSnapshot);
  const layoutApi = useLayoutApi();

  // A note dropped from the toolbar arrives empty and selected: go straight into editing, so
  // the gesture is "add a note, type it" rather than "add a note, hunt for the text field".
  const [editing, setEditing] = useState(data.text === '' && selected === true);
  const [draft, setDraft] = useState(data.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const lines = parseRich(data.text);
  const size = data.fontSize;

  useEffect(() => {
    if (!editing) return;
    // Next frame, not this one: xyflow focuses the node element itself when it becomes
    // selected (nodes carry `tabindex` for keyboard navigation), and that would take the
    // caret straight back out of the textarea.
    const frame = requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      // Caret at the end: editing an existing note is usually appending to it.
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const beginEdit = () => {
    if (editing) return;
    // One undo step per editing session, not per keystroke.
    const state = layoutApi.getState();
    saveSnapshot(state.nodes, state.edges);
    setDraft(data.text);
    setEditing(true);
    setSelectedNode(id);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== data.text) updateNodeData(id, { text: draft });
  };

  // Committing on blur alone is not enough: xyflow calls `preventDefault` on pane mousedown,
  // which stops the textarea losing focus, so clicking the canvas would leave the note stuck
  // in edit mode. A capture-phase pointerdown runs before that and settles it.
  // The listener is registered once per editing session, so it needs the *latest* commit —
  // hence a ref, updated after each render rather than during it.
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });
  useEffect(() => {
    if (!editing) return;
    const onDown = (event: PointerEvent) => {
      const area = areaRef.current;
      if (area && event.target instanceof globalThis.Node && !area.contains(event.target)) {
        commitRef.current();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [editing]);

  const cancel = () => {
    setEditing(false);
    setDraft(data.text);
  };

  return (
    <>
      {/* Width only: the height is whatever the text needs. */}
      <NodeResizer
        isVisible={selected && !editing}
        color={data.colour}
        minWidth={NOTE_STYLE.minWidth}
        minHeight={size}
        onResize={(_, params) => updateNodeData(id, { w: params.width })}
      />

      {editing ? (
        <textarea
          ref={areaRef}
          // `nodrag` stops the canvas panning as you select text; `nowheel` lets the textarea
          // scroll instead of zooming the canvas.
          className="nodrag nowheel"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            // xyflow listens on the document for Delete and Backspace; without this, editing
            // a note deletes it.
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            // Enter makes a new line — a note is often two or three. Commit deliberately.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
          }}
          style={{
            width: data.w,
            minHeight: size * NOTE_STYLE.lineHeight * Math.max(2, lines.length),
            padding: NOTE_STYLE.pad,
            fontSize: size,
            lineHeight: NOTE_STYLE.lineHeight,
            color: data.colour,
            textAlign: data.align,
            fontFamily: 'system-ui, sans-serif',
            fontWeight: 500,
            background: 'rgba(255,255,255,0.92)',
            border: `1px solid ${data.colour}`,
            borderRadius: 3,
            outline: 'none',
            resize: 'none',
            overflow: 'hidden',
          }}
        />
      ) : (
        <div
          title="Double-click to edit"
          onMouseDown={() => setSelectedNode(id)}
          onDoubleClick={beginEdit}
          style={{
            width: data.w,
            padding: NOTE_STYLE.pad,
            fontSize: size,
            lineHeight: NOTE_STYLE.lineHeight,
            color: data.colour,
            textAlign: data.align,
            fontFamily: 'system-ui, sans-serif',
            fontWeight: 500,
            cursor: 'move',
            userSelect: 'none',
            // A note is text, not a box: no border, no background, nothing to compete with
            // the layout it is annotating.
            outline: selected ? `1px dashed ${data.colour}` : 'none',
          }}
        >
          {data.text === '' ? (
            // An empty note would be an invisible thing you cannot get back to.
            <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Double-click to edit</span>
          ) : lines.map((runs, li) => (
            <div key={li} style={{ minHeight: size * NOTE_STYLE.lineHeight }}>
              {runs.map((run, ri) => run.script === 'normal' ? (
                <span key={ri}>{run.text}</span>
              ) : (
                <span
                  key={ri}
                  style={{
                    fontSize: size * SCRIPT_SCALE,
                    verticalAlign: 'baseline',
                    position: 'relative',
                    top: run.script === 'sup' ? -size * SCRIPT_RISE : size * SCRIPT_RISE * 0.6,
                  }}
                >
                  {run.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default NoteNode;
