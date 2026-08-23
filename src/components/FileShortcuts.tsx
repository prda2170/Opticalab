// Keyboard shortcuts for the active document: save, open, and the clipboard.
//
// Rendered inside LayoutContext but outside the panels, so the shortcuts work on the
// Diagram tab too — the toolbar that carries the buttons only exists in the editor.
//
// These three we *do* take from the browser: preventDefault stops "save this page" and
// "open a file" in Chromium and Firefox alike, and a user pressing Ctrl+S in a layout
// editor means the layout. The tab-management shortcuts could not be taken this way, which
// is why those are Alt-based (see DocumentTabs).
import { useEffect } from 'react';
import { useLayoutFile } from '../store/useLayoutFile';
import { useClipboard } from '../store/useClipboard';

/** True when the keystroke belongs to a text field rather than to the bench. */
function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement
    || el instanceof HTMLTextAreaElement
    || el instanceof HTMLSelectElement
    || (el instanceof HTMLElement && el.isContentEditable);
}

export const FileShortcuts: React.FC = () => {
  const { save, saveAs, open } = useLayoutFile();
  const { copy, cut, paste } = useClipboard();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();

      // Save and open are taken even while typing: there is no competing meaning.
      if (key === 's') {
        e.preventDefault();
        void (e.shiftKey ? saveAs() : save());
        return;
      }
      if (key === 'o') {
        e.preventDefault();
        void open();
        return;
      }

      // The clipboard keys are only ours when the bench has focus — inside a field they
      // must still copy text, which is what a properties panel is full of.
      if (isTyping()) return;
      if (key === 'c') { e.preventDefault(); copy(); }
      else if (key === 'x') { e.preventDefault(); cut(); }
      else if (key === 'v') { e.preventDefault(); paste(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, saveAs, open, copy, cut, paste]);

  return null;
};
