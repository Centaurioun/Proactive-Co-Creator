/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import type { ViewTransform } from '../../lib/graphLayout';
import { removeTrackedPointer } from './graphCanvasHelpers';

interface UsePanZoomGesturesOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  fitTransform: ViewTransform;
  onChangeUserTransform: Dispatch<SetStateAction<ViewTransform | null>>;
  onClearSelectedRel: () => void;
}

export function usePanZoomGestures({
  containerRef,
  fitTransform,
  onChangeUserTransform,
  onClearSelectedRel,
}: UsePanZoomGesturesOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const prevPinchDistRef = useRef<number | null>(null);
  const fitTransformRef = useRef(fitTransform);

  useEffect(() => {
    fitTransformRef.current = fitTransform;
  }, [fitTransform]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"]')) {
        return;
      }
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      onChangeUserTransform((prev) => {
        const cur = prev ?? fitTransformRef.current;
        return {
          ...cur,
          k: Math.min(4, Math.max(0.25, cur.k * Math.exp(delta))),
        };
      });
    };

    node.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleNativeWheel);
  }, [containerRef, onChangeUserTransform]);

  const handlePointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size === 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
    if (activePointersRef.current.size === 2) {
      prevPinchDistRef.current = null;
    }
    onClearSelectedRel();
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    e.preventDefault();
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pointers = Array.from(activePointersRef.current.values());
    if (pointers.length === 2) {
      const dist = Math.hypot(
        pointers[1].x - pointers[0].x,
        pointers[1].y - pointers[0].y
      );
      if (prevPinchDistRef.current !== null && prevPinchDistRef.current > 0) {
        const zoomFactor = dist / prevPinchDistRef.current;
        onChangeUserTransform((prev) => {
          const cur = prev ?? fitTransformRef.current;
          return {
            ...cur,
            k: Math.min(4, Math.max(0.25, cur.k * zoomFactor)),
          };
        });
      }
      prevPinchDistRef.current = dist;
    } else if (pointers.length === 1 && isDragging && dragStartRef.current) {
      const dx = pointers[0].x - dragStartRef.current.x;
      const dy = pointers[0].y - dragStartRef.current.y;
      onChangeUserTransform((prev) => {
        const cur = prev ?? fitTransformRef.current;
        return { ...cur, x: cur.x + dx, y: cur.y + dy };
      });
      dragStartRef.current = { x: pointers[0].x, y: pointers[0].y };
    }
  };

  const handlePointerEnd = (e: PointerEvent) => {
    const result = removeTrackedPointer(activePointersRef.current, e.pointerId);
    if (result.shouldResetPinch) prevPinchDistRef.current = null;
    if (result.remainingCount === 0) {
      setIsDragging(false);
    }
    dragStartRef.current = result.nextDragStart;
  };

  const zoomIn = () =>
    onChangeUserTransform((prev) => {
      const cur = prev ?? fitTransformRef.current;
      return { ...cur, k: Math.min(4, cur.k * 1.2) };
    });

  const zoomOut = () =>
    onChangeUserTransform((prev) => {
      const cur = prev ?? fitTransformRef.current;
      return { ...cur, k: Math.max(0.25, cur.k / 1.2) };
    });

  const resetView = () => onChangeUserTransform(null);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    zoomIn,
    zoomOut,
    resetView,
  };
}
