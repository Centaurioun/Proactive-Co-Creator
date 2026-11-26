/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';

interface ReturnPositionSnapshot {
  sectionId: string;
  textIdentity: string;
  start: number;
  end: number;
  textareaScrollTop: number;
  editorScrollTop: number;
}

interface UseReturnSelectionOptions {
  isActive: boolean;
  focus: boolean;
  previewSection: boolean;
  selectedId: string;
  selectedText: string;
  selectionRange: { start: number; end: number };
  setSelectionRange: Dispatch<SetStateAction<{ start: number; end: number }>>;
  resolveSelection: (
    currentText: string,
    position: { textIdentity: string; start: number; end: number }
  ) => { start: number; end: number; textMatches: boolean };
}

export function useReturnSelection({
  isActive,
  focus,
  previewSection,
  selectedId,
  selectedText,
  selectionRange,
  setSelectionRange,
  resolveSelection,
}: UseReturnSelectionOptions) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editorMain = useRef<HTMLElement>(null);
  const editorOwnedFocus = useRef(false);
  const wasActive = useRef(isActive);
  const textareaScrollTop = useRef(0);
  const returnPosition = useRef<ReturnPositionSnapshot | null>(null);
  const restorePosition = useRef(false);
  const restoreFocus = useRef(false);

  const captureReturnPosition = useCallback(() => {
    const editor = textarea.current;
    returnPosition.current = {
      sectionId: selectedId,
      textIdentity: editor?.value ?? selectedText,
      start: editor?.selectionStart ?? selectionRange.start,
      end: editor?.selectionEnd ?? selectionRange.end,
      textareaScrollTop: editor?.scrollTop ?? textareaScrollTop.current,
      editorScrollTop: editorMain.current?.scrollTop ?? 0,
    };
  }, [selectedId, selectedText, selectionRange.start, selectionRange.end]);

  const scheduleRestore = useCallback(
    (shouldRestoreFocus: boolean) => {
      captureReturnPosition();
      restorePosition.current = true;
      restoreFocus.current = shouldRestoreFocus;
    },
    [captureReturnPosition]
  );

  const recordScrollPosition = useCallback(
    (editor: HTMLTextAreaElement) => {
      returnPosition.current = {
        sectionId: selectedId,
        textIdentity: editor.value,
        start: editor.selectionStart,
        end: editor.selectionEnd,
        textareaScrollTop: editor.scrollTop,
        editorScrollTop: editorMain.current?.scrollTop ?? 0,
      };
      textareaScrollTop.current = editor.scrollTop;
    },
    [selectedId]
  );

  useLayoutEffect(() => {
    const activeChanged = wasActive.current !== isActive;
    if (activeChanged) {
      wasActive.current = isActive;
      if (!isActive) {
        editorOwnedFocus.current =
          editorOwnedFocus.current || document.activeElement === textarea.current;
        captureReturnPosition();
        return;
      }
      restorePosition.current = true;
      restoreFocus.current = editorOwnedFocus.current;
    }
    if (!isActive || !restorePosition.current || !returnPosition.current) return;
    restorePosition.current = false;
    const position = returnPosition.current;
    if (position.sectionId !== selectedId) return;
    const editor = textarea.current;
    let restoredStart = position.start;
    let restoredEnd = position.end;
    if (editor) {
      ({ start: restoredStart, end: restoredEnd } = resolveSelection(editor.value, position));
      editor.setSelectionRange(restoredStart, restoredEnd);
      editor.scrollTop = position.textareaScrollTop;
      if (restoreFocus.current) editor.focus({ preventScroll: true });
      textareaScrollTop.current = position.textareaScrollTop;
    }
    if (editorMain.current) editorMain.current.scrollTop = position.editorScrollTop;
    setSelectionRange({ start: restoredStart, end: restoredEnd });
    restoreFocus.current = false;
  }, [
    captureReturnPosition,
    focus,
    isActive,
    previewSection,
    resolveSelection,
    selectedId,
    setSelectionRange,
  ]);

  const markFocused = useCallback(() => {
    editorOwnedFocus.current = true;
  }, []);

  const markBlurred = useCallback(
    (hasRelatedTarget: boolean) => {
      if (hasRelatedTarget || isActive) editorOwnedFocus.current = false;
    },
    [isActive]
  );

  return {
    textarea,
    editorMain,
    scheduleRestore,
    recordScrollPosition,
    markFocused,
    markBlurred,
  };
}
