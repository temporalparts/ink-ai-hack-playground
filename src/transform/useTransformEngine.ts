// React hook for a physics-based transform engine.
//
// Each element can have a velocity vector. A rAF loop applies velocity * dt
// each frame to move elements continuously.
//
// Forces are applied as instantaneous impulses: dv = force / mass.
// Physics properties (mass, pinned, collidable) are stored separately from
// transient state so they persist across rewind.
//
// Tracks total displacement per element so rewind can restore original positions.
// All per-frame updates are batched into a single callback to avoid stale state.

import { useRef, useCallback, useEffect, useState } from 'react';
import type { Vector2 } from './TransformOperation';
import { vec2Add, vec2Scale, ZERO_VECTOR } from './TransformOperation';

interface PhysicsBody {
  velocity: Vector2;
  /** Cumulative displacement since this body was created */
  totalDisplacement: Vector2;
}

/** Persistent physics properties for an element. Survives rewind. */
export interface PhysicsProperties {
  mass: number;
  /** If true, forces have no effect — element is immovable. */
  pinned: boolean;
  /** If true, this element participates in collision detection. */
  collidable: boolean;
}

interface UseTransformEngineOptions {
  /** Called once per frame with all element displacements batched together. */
  onBatchTranslate: (displacements: Map<string, Vector2>) => void;
}

export const DEFAULT_MASS = 1;

const DEFAULT_PROPERTIES: PhysicsProperties = {
  mass: DEFAULT_MASS,
  pinned: false,
  collidable: false,
};

export function useTransformEngine({ onBatchTranslate }: UseTransformEngineOptions) {
  const bodiesRef = useRef<Map<string, PhysicsBody>>(new Map());
  /** Per-element physics properties — persist across rewind. */
  const propsRef = useRef<Map<string, PhysicsProperties>>(new Map());
  /** Bumped when physics properties change, so React consumers re-render. */
  const [propsVersion, setPropsVersion] = useState(0);
  const bumpVersion = () => setPropsVersion(v => v + 1);
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const onBatchTranslateRef = useRef(onBatchTranslate);

  useEffect(() => {
    onBatchTranslateRef.current = onBatchTranslate;
  }, [onBatchTranslate]);

  const getProps = (elementId: string): PhysicsProperties => {
    return propsRef.current.get(elementId) ?? DEFAULT_PROPERTIES;
  };

  const ensureProps = (elementId: string): PhysicsProperties => {
    let p = propsRef.current.get(elementId);
    if (!p) {
      p = { ...DEFAULT_PROPERTIES };
      propsRef.current.set(elementId, p);
    }
    return p;
  };

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
   * dv = force / mass. Heavier elements accelerate less.
   * Pinned elements ignore forces entirely.
   */
  const applyForce = useCallback((elementId: string, force: Vector2) => {
    const props = getProps(elementId);
    if (props.pinned) return;

    const bodies = bodiesRef.current;
    const body = bodies.get(elementId);
    const dv = vec2Scale(force, 1 / props.mass);

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

  /**
   * Add velocity directly, bypassing mass. Works on any element
   * regardless of mass or pinned state.
   */
  const addVelocity = useCallback((elementId: string, dv: Vector2) => {
    const bodies = bodiesRef.current;
    const body = bodies.get(elementId);

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

  /** Set mass for an element. Persists across rewind. */
  const setMass = useCallback((elementId: string, mass: number) => {
    if (mass <= 0) return;
    const p = ensureProps(elementId);
    p.mass = mass;
    bumpVersion();
  }, []);

  /** Get mass for an element. Returns DEFAULT_MASS if not set. */
  const getMass = useCallback((elementId: string): number => {
    return getProps(elementId).mass;
  }, []);

  /** Pin an element (infinite mass — immune to forces). */
  const setPinned = useCallback((elementId: string, pinned: boolean) => {
    const p = ensureProps(elementId);
    p.pinned = pinned;
    if (pinned) {
      bodiesRef.current.delete(elementId);
    }
    bumpVersion();
  }, []);

  /** Check if an element is pinned. */
  const isPinned = useCallback((elementId: string): boolean => {
    return getProps(elementId).pinned;
  }, []);

  /** Set whether an element participates in collision detection. */
  const setCollidable = useCallback((elementId: string, collidable: boolean) => {
    const p = ensureProps(elementId);
    p.collidable = collidable;
    bumpVersion();
  }, []);

  /** Check if an element is collidable. */
  const isCollidable = useCallback((elementId: string): boolean => {
    return getProps(elementId).collidable;
  }, []);

  /** Get all physics properties for an element. */
  const getPhysicsProperties = useCallback((elementId: string): PhysicsProperties => {
    return { ...getProps(elementId) };
  }, [propsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Stop all velocity on an element. Properties are preserved. */
  const stopElement = useCallback((elementId: string) => {
    bodiesRef.current.delete(elementId);
  }, []);

  /** Stop all physics bodies. Properties are preserved. */
  const stopAll = useCallback(() => {
    bodiesRef.current.clear();
  }, []);

  /**
   * Rewind all elements to their original positions by applying the
   * negative of their accumulated displacement, then clear bodies.
   * Physics properties (mass, pinned, collidable) are preserved.
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

  return {
    applyForce, addVelocity,
    setMass, getMass,
    setPinned, isPinned,
    setCollidable, isCollidable,
    getPhysicsProperties,
    stopElement, stopAll, rewind,
    getVelocity, hasActiveBodies,
  };
}
