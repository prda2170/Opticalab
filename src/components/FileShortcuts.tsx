// Ctrl+S, Ctrl+Shift+S and Ctrl+O for the active document.
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

export const FileShortcuts: React.FC = () => {
  const { save, saveAs, open } = useLayoutFile();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void (e.shiftKey ? saveAs() : save());
      } else if (key === 'o') {
        e.preventDefault();
        void open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, saveAs, open]);

  return null;
};
