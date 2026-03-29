// React hook for a physics-based transform engine.
// Elements can have continuous velocities applied via requestAnimationFrame.

import { useRef, useCallback, useEffect } from 'react';
import type { Velocity } from './TransformOperation';

interface UseTransformEngineOptions {
  onUpdate: (elementIds: string[], type: string, dx: number, dy: number) => void;
}

export function useTransformEngine({ onUpdate }: UseTransformEngineOptions) {
  // Element ID → current velocity (px/s)
  const velocitiesRef = useRef<Map<string, Velocity>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const scheduleLoop = useCallback(() => {
    if (rafIdRef.current !== null) return;
    lastTimeRef.current = null;

    const tick = (now: number) => {
      const dt = lastTimeRef.current !== null
        ? (now - lastTimeRef.current) / 1000 // seconds
        : 0; // first frame, no movement
      lastTimeRef.current = now;

      const velocities = velocitiesRef.current;

      for (const [elementId, vel] of velocities) {
        const dx = vel.vx * dt;
        const dy = vel.vy * dt;
        if (dx !== 0 || dy !== 0) {
          onUpdateRef.current([elementId], 'translate', dx, dy);
        }
      }

      if (velocities.size > 0) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
        lastTimeRef.current = null;
      }
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  /** Add velocity to an element. Accumulates with existing velocity. */
  const addVelocity = useCallback((elementId: string, dvx: number, dvy: number) => {
    const velocities = velocitiesRef.current;
    const existing = velocities.get(elementId);
    if (existing) {
      existing.vx += dvx;
      existing.vy += dvy;
    } else {
      velocities.set(elementId, { vx: dvx, vy: dvy });
    }
    scheduleLoop();
  }, [scheduleLoop]);

  /** Stop all velocity on an element. */
  const stopElement = useCallback((elementId: string) => {
    velocitiesRef.current.delete(elementId);
    // Loop will self-terminate when map is empty
  }, []);

  /** Stop all velocities. */
  const stopAll = useCallback(() => {
    velocitiesRef.current.clear();
    // Loop will self-terminate on next frame
  }, []);

  /** Check if any element has velocity. */
  const hasActiveVelocities = useCallback(() => {
    return velocitiesRef.current.size > 0;
  }, []);

  return { addVelocity, stopElement, stopAll, hasActiveVelocities };
}
