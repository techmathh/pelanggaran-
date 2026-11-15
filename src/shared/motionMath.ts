export interface TiltAngles {
  rotateX: number;
  rotateY: number;
  glareX: number;
  glareY: number;
}

/**
 * Computes clamped CSS 3D perspective tilt angles and normalized glare coordinates
 * from normalized pointer coordinates (-1..1 around card center).
 */
export function calculateTiltTransform(
  normX: number,
  normY: number,
  maxTiltDeg = 7
): TiltAngles {
  const clampedX = Math.max(-1, Math.min(1, Number.isFinite(normX) ? normX : 0));
  const clampedY = Math.max(-1, Math.min(1, Number.isFinite(normY) ? normY : 0));
  const safeMax = Math.max(0, Math.min(25, Number.isFinite(maxTiltDeg) ? maxTiltDeg : 7));

  // Moving pointer right (+X) rotates card around Y positively; moving pointer down (+Y) pitches X negatively
  const rotateY = Number((clampedX * safeMax).toFixed(3));
  const rotateX = Number((-clampedY * safeMax).toFixed(3));
  const glareX = Number((((clampedX + 1) / 2) * 100).toFixed(2));
  const glareY = Number((((clampedY + 1) / 2) * 100).toFixed(2));

  return { rotateX, rotateY, glareX, glareY };
}

/**
 * Smooth cubic ease-out curve for animated KPI counters and progress transitions.
 */
export function easeOutCubic(progress: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return 1 - Math.pow(1 - t, 3);
}
