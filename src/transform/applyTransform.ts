// Pure functions for applying transforms to elements

import type { Element } from '../types';

/**
 * Translate an element by (dx, dy).
 * - Stroke elements: translate all input points
 * - Transformable elements: update transform matrix translation
 */
export function translateElement(element: Element, dx: number, dy: number): Element {
  if (element.type === 'stroke') {
    return {
      ...element,
      strokes: element.strokes.map(stroke => ({
        ...stroke,
        inputs: {
          ...stroke.inputs,
          inputs: stroke.inputs.inputs.map(input => ({
            ...input,
            x: input.x + dx,
            y: input.y + dy,
          })),
        },
      })),
    };
  } else {
    const values = [...element.transform.values] as [number, number, number, number, number, number, number, number, number];
    values[6] += dx;
    values[7] += dy;
    return {
      ...element,
      transform: { values },
    };
  }
}
