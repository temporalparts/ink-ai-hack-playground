// React hook for a physics-based transform engine.
//
// Each element can have a velocity vector. A rAF loop applies velocity * dt
// each frame to move elements continuously.
//
// Forces are applied as instantaneous impulses: dv = force / mass.
// Currently mass = 1 for all elements, so force directly changes velocity.
// To add mass later: store mass per body and divide here.
//
// Tracks total displacement per element so rewind can restore original positions.
// All per-frame updates are batched into a single callback to avoid stale state.

import { useRef, useCallback, useEffect } from 'react';
import type { Vector2 } from './TransformOperation';
import { vec2Add, vec2Scale, ZERO_VECTOR } from './TransformOperation';

interface PhysicsBody {
  velocity: Vector2;
  /** Cumulative displacement since this body was created */
  totalDisplacement: Vector2;
  // Future: mass, acceleration, friction, etc.
}

interface UseTransformEngineOptions {
  /** Called once per frame with all element displacements batched together. */
  onBatchTranslate: (displacements: Map<string, Vector2>) => void;
}

const DEFAULT_MASS = 1;

export function useTransformEngine({ onBatchTranslate }: UseTransformEngineOptions) {
  const bodiesRef = useRef<Map<string, PhysicsBody>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const onBatchTranslateRef = useRef(onBatchTranslate);

  useEffect(() => {
    onBatchTranslateRef.current = onBatchTranslate;
  }, [onBatchTranslate]);

  const scheduleLoop = useCallback(() => {
    if (rafIdRef.current !== null) return;
    lastTimeRef.current = null;

    const tick = (now: number) => {
      const dt = lastTimeRef.current !== null
        ? (now - lastTimeRef.current) / 1000
        : 0;
      lastTimeRef.current = now;

      const bodies = bodiesRef.current;
      const batch = new Map<string, Vector2>();

      for (const [elementId, body] of bodies) {
        const displacement = vec2Scale(body.velocity, dt);
        if (displacement.x !== 0 || displacement.y !== 0) {
          body.totalDisplacement = vec2Add(body.totalDisplacement, displacement);
          batch.set(elementId, displacement);
        }
      }

      if (batch.size > 0) {
        onBatchTranslateRef.current(batch);
      }

      if (bodies.size > 0) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
        lastTimeRef.current = null;
      }
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * Apply a force vector to an element as an instantaneous impulse.
   * With mass=1, this directly adds to velocity: dv = force / mass.
   */
  const applyForce = useCallback((elementId: string, force: Vector2) => {
    const bodies = bodiesRef.current;
    const body = bodies.get(elementId);
    const dv = vec2Scale(force, 1 / DEFAULT_MASS);

    if (body) {
      body.velocity = vec2Add(body.velocity, dv);
    } else {
      bodies.set(elementId, {
        velocity: { ...dv },
        totalDisplacement: { ...ZERO_VECTOR },
      });
    }
    scheduleLoop();
  }, [scheduleLoop]);

  /** Stop all velocity on an element. */
  const stopElement = useCallback((elementId: string) => {
    bodiesRef.current.delete(elementId);
  }, []);

  /** Stop all physics bodies. */
  const stopAll = useCallback(() => {
    bodiesRef.current.clear();
  }, []);

  /**
   * Rewind all elements to their original positions by applying the
   * negative of their accumulated displacement, then clear all bodies.
   */
  const rewind = useCallback(() => {
    const bodies = bodiesRef.current;
    const batch = new Map<string, Vector2>();

    for (const [elementId, body] of bodies) {
      const reversal = vec2Scale(body.totalDisplacement, -1);
      if (reversal.x !== 0 || reversal.y !== 0) {
        batch.set(elementId, reversal);
      }
    }

    if (batch.size > 0) {
      onBatchTranslateRef.current(batch);
    }
    bodies.clear();
  }, []);

  /** Get current velocity of an element (or zero). */
  const getVelocity = useCallback((elementId: string): Vector2 => {
    return bodiesRef.current.get(elementId)?.velocity ?? ZERO_VECTOR;
  }, []);

  /** Whether any element has active physics. */
  const hasActiveBodies = useCallback(() => {
    return bodiesRef.current.size > 0;
  }, []);

  return { applyForce, stopElement, stopAll, rewind, getVelocity, hasActiveBodies };
}
