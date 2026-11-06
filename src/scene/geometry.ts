import { BufferAttribute, BufferGeometry } from "three";

/**
 * A latitude/longitude grid sphere as one merged LineSegments geometry —
 * a single draw call per body, and it reads as drawn-with-light line work
 * rather than a faceted mesh.
 */
export function gridSphereGeometry(
  radius: number,
  meridians: number,
  parallels: number,
  segments = 48,
): BufferGeometry {
  const positions: number[] = [];

  const pushCirclePoint = (
    target: number[],
    theta: number,
    ringRadius: number,
    y: number,
    longitude: number,
  ) => {
    const x = Math.cos(theta) * ringRadius;
    const z = Math.sin(theta) * ringRadius;
    // Rotate the meridian circle around Y by `longitude`.
    target.push(
      x * Math.cos(longitude) - z * Math.sin(longitude),
      y,
      x * Math.sin(longitude) + z * Math.cos(longitude),
    );
  };

  // Meridians: full circles through the poles.
  for (let m = 0; m < meridians; m += 1) {
    const longitude = (m / meridians) * Math.PI;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      pushCirclePoint(positions, 0, Math.sin(a) * radius, Math.cos(a) * radius, longitude);
      pushCirclePoint(positions, 0, Math.sin(b) * radius, Math.cos(b) * radius, longitude);
    }
  }

  // Parallels: horizontal circles between the poles.
  for (let p = 1; p <= parallels; p += 1) {
    const latitude = -Math.PI / 2 + (p / (parallels + 1)) * Math.PI;
    const y = Math.sin(latitude) * radius;
    const ringRadius = Math.cos(latitude) * radius;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      positions.push(
        Math.cos(a) * ringRadius,
        y,
        Math.sin(a) * ringRadius,
        Math.cos(b) * ringRadius,
        y,
        Math.sin(b) * ringRadius,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

/**
 * A circle in the XZ plane for a LineLoop. With `withAngle`, each vertex
 * carries its polar angle so the moon-trail shader can light the arc
 * nearest the moon.
 */
export function circleGeometry(
  radius: number,
  segments = 128,
  withAngle = false,
): BufferGeometry {
  const positions = new Float32Array(segments * 3);
  const angles = withAngle ? new Float32Array(segments) : null;

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    if (angles) {
      angles[i] = angle;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  if (angles) {
    geometry.setAttribute("aAngle", new BufferAttribute(angles, 1));
  }
  return geometry;
}
