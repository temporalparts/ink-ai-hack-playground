// Arrow element creator — detects a single hand-drawn arrow stroke

import type { Stroke, Offset } from '../../types';
import type { CreationContext, CreationResult } from '../registry/ElementPlugin';
import { generateId } from '../../types/primitives';
import { debugLog } from '../../debug/DebugLogger';
import type { ArrowElement } from './types';

const MIN_ARROW_LENGTH = 50;
const MAX_ARROW_LENGTH = 2000;
const MIN_POINTS = 5;
const MAX_STROKES = 1;

// Look at last 20% of points for arrowhead divergence
const ARROWHEAD_PORTION = 0.20;
const MIN_ARROWHEAD_POINTS = 3;
const ARROWHEAD_ANGLE_THRESHOLD = Math.PI / 6;

function dist(a: Offset, b: Offset): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function segmentAngle(a: Offset, b: Offset): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Score how arrow-like the end of the stroke is.
 * Returns a confidence in [0, 1].
 */
function arrowheadConfidence(points: Offset[]): number {
  if (points.length < 5) return 0;

  const mainDir = segmentAngle(points[0], points[points.length - 1]);
  const numHead = Math.max(MIN_ARROWHEAD_POINTS, Math.floor(points.length * ARROWHEAD_PORTION));
  const startIdx = points.length - numHead;

  let diverged = 0;
  let totalDivergence = 0;

  for (let i = startIdx; i < points.length - 1; i++) {
    const diff = Math.abs(normalizeAngle(segmentAngle(points[i], points[i + 1]) - mainDir));
    if (diff > ARROWHEAD_ANGLE_THRESHOLD) {
      diverged++;
      totalDivergence += diff;
    }
  }

  if (diverged < 2) return 0;
  return Math.min(1, totalDivergence / (Math.PI / 2));
}

/**
 * Score how straight (linear) the stroke is.
 * 1 = perfectly straight, 0 = very curved.
 */
function linearityScore(points: Offset[]): number {
  if (points.length < 2) return 1;
  const start = points[0];
  const end = points[points.length - 1];
  const totalLen = dist(start, end);
  if (totalLen < 1) return 0;

  let maxDeviation = 0;
  for (const p of points) {
    // Perpendicular distance from line start->end
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const d = Math.abs(dy * p.x - dx * p.y + end.x * start.y - end.y * start.x) / totalLen;
    maxDeviation = Math.max(maxDeviation, d);
  }

  return Math.max(0, 1 - maxDeviation / totalLen);
}

function classifyDirection8(angle: number): string {
  const tau = 2 * Math.PI;
  const normalized = ((angle % tau) + tau) % tau;
  const eighth = Math.PI / 8;
  const labels = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  const index = Math.floor((normalized + eighth) % tau / (Math.PI / 4));
  return labels[index % 8];
}

export function canCreate(strokes: Stroke[]): boolean {
  if (strokes.length !== MAX_STROKES) return false;
  const inputs = strokes[0].inputs.inputs;
  if (inputs.length < MIN_POINTS) return false;
  const first = inputs[0];
  const last = inputs[inputs.length - 1];
  const length = dist({ x: first.x, y: first.y }, { x: last.x, y: last.y });
  return length >= MIN_ARROW_LENGTH && length <= MAX_ARROW_LENGTH;
}

export async function createFromInk(
  strokes: Stroke[],
  _context: CreationContext,
): Promise<CreationResult | null> {
  if (!canCreate(strokes)) return null;

  const stroke = strokes[0];
  const inputs = stroke.inputs.inputs;
  const points: Offset[] = inputs.map(i => ({ x: i.x, y: i.y }));

  const tail = points[0];
  const head = points[points.length - 1];
  const length = dist(tail, head);

  debugLog.info('[Arrow] Analyzing stroke', { points: points.length, length: length.toFixed(0) });

  const arrowConf = arrowheadConfidence(points);
  const linearity = linearityScore(points);

  debugLog.info('[Arrow] Scores', {
    arrowheadConfidence: arrowConf.toFixed(2),
    linearity: linearity.toFixed(2),
  });

  // Require either a visible arrowhead OR a fairly straight stroke
  if (arrowConf < 0.1 && linearity < 0.6) {
    debugLog.info('[Arrow] REJECTED - no arrowhead and not straight enough');
    return null;
  }

  // Overall confidence: reward arrowhead presence and linearity
  const confidence = Math.min(0.95, 0.5 + arrowConf * 0.35 + linearity * 0.15);

  debugLog.info('[Arrow] ACCEPTED', { confidence: confidence.toFixed(2) });

  // Store tail in transform translation, head in local coords
  const transform = {
    values: [1, 0, 0, 0, 1, 0, tail.x, tail.y, 1] as [
      number, number, number, number, number, number, number, number, number
    ],
  };

  // Compute properties directly from the raw stroke geometry
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const angleRadians = Math.atan2(dy, dx);
  const angleDegrees = angleRadians * (180 / Math.PI);
  const speed = Math.max(0, Math.min(1, (length - MIN_ARROW_LENGTH) / (MAX_ARROW_LENGTH - MIN_ARROW_LENGTH)));
  const direction = classifyDirection8(angleRadians);

  const element: ArrowElement = {
    type: 'arrow',
    id: generateId(),
    transform,
    tail: { x: 0, y: 0 },
    head: { x: dx, y: dy },
    color: stroke.brush.color,
    strokeWidth: Math.max(2, stroke.brush.size * 0.5),
    length,
    angleRadians,
    angleDegrees,
    direction,
    speed,
    sourceStrokes: strokes,
  };

  return {
    elements: [element],
    consumedStrokes: strokes,
    confidence,
  };
}
