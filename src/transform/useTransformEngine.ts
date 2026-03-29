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
import type { BoundingBox } from '../types/primitives';

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
  /** Returns current bounding box for an element. Needed for collision detection. */
  getBounds?: (elementId: string) => BoundingBox | null;
}

export const DEFAULT_MASS = 1;

const DEFAULT_PROPERTIES: PhysicsProperties = {
  mass: DEFAULT_MASS,
  pinned: false,
  collidable: false,
};

export function useTransformEngine({ onBatchTranslate, getBounds }: UseTransformEngineOptions) {
  const bodiesRef = useRef<Map<string, PhysicsBody>>(new Map());
  /** Per-element physics properties — persist across rewind. */
  const propsRef = useRef<Map<string, PhysicsProperties>>(new Map());
  /** Bumped when physics properties change, so React consumers re-render. */
  const [propsVersion, setPropsVersion] = useState(0);
  const bumpVersion = () => setPropsVersion(v => v + 1);
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const onBatchTranslateRef = useRef(onBatchTranslate);
  const getBoundsRef = useRef(getBounds);

  useEffect(() => {
    onBatchTranslateRef.current = onBatchTranslate;
  }, [onBatchTranslate]);

  useEffect(() => {
    getBoundsRef.current = getBounds;
  }, [getBounds]);

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

      // --- AABB collision detection between collidable bodies ---
      if (getBoundsRef.current) {
        const collidableIds: string[] = [];
        for (const [elementId] of bodies) {
          if (getProps(elementId).collidable) {
            collidableIds.push(elementId);
          }
        }

        for (let i = 0; i < collidableIds.length; i++) {
          for (let j = i + 1; j < collidableIds.length; j++) {
            const idA = collidableIds[i];
            const idB = collidableIds[j];
            const boundsA = getBoundsRef.current(idA);
            const boundsB = getBoundsRef.current(idB);
            if (!boundsA || !boundsB) continue;

            // Check AABB overlap
            if (boundsA.right < boundsB.left || boundsB.right < boundsA.left ||
                boundsA.bottom < boundsB.top || boundsB.bottom < boundsA.top) {
              continue; // No overlap
            }

            // Compute overlap on each axis
            const overlapX = Math.min(boundsA.right - boundsB.left, boundsB.right - boundsA.left);
            const overlapY = Math.min(boundsA.bottom - boundsB.top, boundsB.bottom - boundsA.top);

            const bodyA = bodies.get(idA)!;
            const bodyB = bodies.get(idB)!;
            const propsA = getProps(idA);
            const propsB = getProps(idB);
            const massA = propsA.pinned ? Infinity : propsA.mass;
            const massB = propsB.pinned ? Infinity : propsB.mass;

            // Resolve along the axis of least penetration
            if (overlapX < overlapY) {
              // Separate along X
              const centerAx = (boundsA.left + boundsA.right) / 2;
              const centerBx = (boundsB.left + boundsB.right) / 2;
              const sign = centerAx < centerBx ? -1 : 1;

              if (massA === Infinity && massB === Infinity) {
                // Both infinite — split equally
                const sep: Vector2 = { x: sign * overlapX / 2, y: 0 };
                bodyA.totalDisplacement = vec2Add(bodyA.totalDisplacement, sep);
                bodyB.totalDisplacement = vec2Add(bodyB.totalDisplacement, { x: -sep.x, y: 0 });
                onBatchTranslateRef.current(new Map([[idA, sep], [idB, { x: -sep.x, y: 0 }]]));
              } else if (massA === Infinity) {
                const sep: Vector2 = { x: -sign * overlapX, y: 0 };
                bodyB.totalDisplacement = vec2Add(bodyB.totalDisplacement, sep);
                onBatchTranslateRef.current(new Map([[idB, sep]]));
              } else if (massB === Infinity) {
                const sep: Vector2 = { x: sign * overlapX, y: 0 };
                bodyA.totalDisplacement = vec2Add(bodyA.totalDisplacement, sep);
                onBatchTranslateRef.current(new Map([[idA, sep]]));
              } else {
                const totalMass = massA + massB;
                const sepA: Vector2 = { x: sign * overlapX * (massB / totalMass), y: 0 };
                const sepB: Vector2 = { x: -sign * overlapX * (massA / totalMass), y: 0 };
                bodyA.totalDisplacement = vec2Add(bodyA.totalDisplacement, sepA);
                bodyB.totalDisplacement = vec2Add(bodyB.totalDisplacement, sepB);
                onBatchTranslateRef.current(new Map([[idA, sepA], [idB, sepB]]));
              }

              // Swap X velocities (1D elastic collision)
              if (massA === Infinity) {
                bodyB.velocity = { x: -bodyB.velocity.x, y: bodyB.velocity.y };
              } else if (massB === Infinity) {
                bodyA.velocity = { x: -bodyA.velocity.x, y: bodyA.velocity.y };
              } else {
                const totalMass = massA + massB;
                const newVxA = ((massA - massB) / totalMass) * bodyA.velocity.x + (2 * massB / totalMass) * bodyB.velocity.x;
                const newVxB = (2 * massA / totalMass) * bodyA.velocity.x + ((massB - massA) / totalMass) * bodyB.velocity.x;
                bodyA.velocity = { x: newVxA, y: bodyA.velocity.y };
                bodyB.velocity = { x: newVxB, y: bodyB.velocity.y };
              }
            } else {
              // Separate along Y
              const centerAy = (boundsA.top + boundsA.bottom) / 2;
              const centerBy = (boundsB.top + boundsB.bottom) / 2;
              const sign = centerAy < centerBy ? -1 : 1;

              if (massA === Infinity && massB === Infinity) {
                const sep: Vector2 = { x: 0, y: sign * overlapY / 2 };
                bodyA.totalDisplacement = vec2Add(bodyA.totalDisplacement, sep);
                bodyB.totalDisplacement = vec2Add(bodyB.totalDisplacement, { x: 0, y: -sep.y });
                onBatchTranslateRef.current(new Map([[idA, sep], [idB, { x: 0, y: -sep.y }]]));
              } else if (massA === Infinity) {
                const sep: Vector2 = { x: 0, y: -sign * overlapY };
                bodyB.totalDisplacement = vec2Add(bodyB.totalDisplacement, sep);
                onBatchTranslateRef.current(new Map([[idB, sep]]));
              } else if (massB === Infinity) {
                const sep: Vector2 = { x: 0, y: sign * overlapY };
                bodyA.totalDisplacement = vec2Add(bodyA.totalDisplacement, sep);
                onBatchTranslateRef.current(new Map([[idA, sep]]));
              } else {
                const totalMass = massA + massB;
                const sepA: Vector2 = { x: 0, y: sign * overlapY * (massB / totalMass) };
                const sepB: Vector2 = { x: 0, y: -sign * overlapY * (massA / totalMass) };
                bodyA.totalDisplacement = vec2Add(bodyA.totalDisplacement, sepA);
                bodyB.totalDisplacement = vec2Add(bodyB.totalDisplacement, sepB);
                onBatchTranslateRef.current(new Map([[idA, sepA], [idB, sepB]]));
              }

              // Swap Y velocities (1D elastic collision)
              if (massA === Infinity) {
                bodyB.velocity = { x: bodyB.velocity.x, y: -bodyB.velocity.y };
              } else if (massB === Infinity) {
                bodyA.velocity = { x: bodyA.velocity.x, y: -bodyA.velocity.y };
              } else {
                const totalMass = massA + massB;
                const newVyA = ((massA - massB) / totalMass) * bodyA.velocity.y + (2 * massB / totalMass) * bodyB.velocity.y;
                const newVyB = (2 * massA / totalMass) * bodyA.velocity.y + ((massB - massA) / totalMass) * bodyB.velocity.y;
                bodyA.velocity = { x: bodyA.velocity.x, y: newVyA };
                bodyB.velocity = { x: bodyB.velocity.x, y: newVyB };
              }
            }
          }
        }
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

  /**
   * Load physics properties from a serialized record (e.g. from saved note).
   * Merges with existing properties.
   */
  const loadProperties = useCallback((record: Record<string, { mass?: number; pinned?: boolean; collidable?: boolean }>) => {
    for (const [elementId, stored] of Object.entries(record)) {
      const p = ensureProps(elementId);
      if (stored.mass !== undefined) p.mass = stored.mass;
      if (stored.pinned !== undefined) p.pinned = stored.pinned;
      if (stored.collidable !== undefined) p.collidable = stored.collidable;
    }
    bumpVersion();
  }, []);

  /**
   * Serialize all non-default physics properties to a plain record
   * suitable for JSON storage.
   */
  const serializeProperties = useCallback((): Record<string, { mass?: number; pinned?: boolean; collidable?: boolean }> => {
    const result: Record<string, { mass?: number; pinned?: boolean; collidable?: boolean }> = {};
    for (const [elementId, p] of propsRef.current) {
      const stored: { mass?: number; pinned?: boolean; collidable?: boolean } = {};
      if (p.mass !== DEFAULT_MASS) stored.mass = p.mass;
      if (p.pinned) stored.pinned = true;
      if (p.collidable) stored.collidable = true;
      if (Object.keys(stored).length > 0) {
        result[elementId] = stored;
      }
    }
    return result;
  }, []);

  return {
    applyForce, addVelocity,
    setMass, getMass,
    setPinned, isPinned,
    setCollidable, isCollidable,
    getPhysicsProperties,
    stopElement, stopAll, rewind,
    getVelocity, hasActiveBodies,
    loadProperties, serializeProperties,
  };
}
