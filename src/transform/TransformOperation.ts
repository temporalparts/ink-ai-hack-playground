// Transform operation descriptors and physics types

export type TransformType = 'translate' | 'rotate' | 'scale';

export interface TranslateParams {
  dx: number;
  dy: number;
}

export type TransformParams = TranslateParams; // union with RotateParams, ScaleParams later

export interface TransformOperation {
  id: string;
  elementIds: string[];
  type: TransformType;
  params: TransformParams;
  durationMs: number;
  easing: (t: number) => number;
}

/** Velocity added per click of a movement button, in pixels/second */
export const MOVE_SPEED = 100;

export interface Velocity {
  vx: number;
  vy: number;
}

let nextOpId = 0;

export function createTranslateOperation(
  elementIds: string[],
  dx: number,
  dy: number,
): TransformOperation {
  return {
    id: `transform-${nextOpId++}`,
    elementIds,
    type: 'translate',
    params: { dx, dy },
    durationMs: 200,
    easing: (t: number) => 1 - Math.pow(1 - t, 3),
  };
}
