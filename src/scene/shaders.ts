import { AdditiveBlending, Color, ShaderMaterial } from "three";
import { useSiteStore } from "../state/store";
import type { RevealRef } from "./registry";
import { sceneRandom, uTime } from "./registry";

const LINE_VERTEX = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uPhase;
  uniform float uBreath;
  uniform float uReveal;
  uniform float uBoost;
  void main() {
    float breath = 1.0 + uBreath * sin(uTime * 0.55 + uPhase);
    float alpha = uOpacity * breath * uReveal * uBoost;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

type LineMaterialOptions = {
  color: string;
  opacity: number;
  breath?: number;
  reveal?: RevealRef;
  /** Shared brightness uniform (highlight lift × proximity fade). */
  boost?: { value: number };
};

/** Additive hairline material: everything in the scene is drawn with light. */
export function makeLineMaterial(options: LineMaterialOptions): ShaderMaterial {
  // WebGL lines are always 1px, so "bolder" on small screens can only come
  // from brightness: additive blending makes higher opacity read as weight.
  const opacityBoost = useSiteStore.getState().isMobile ? 1.4 : 1;
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(options.color) },
      uOpacity: { value: Math.min(1, options.opacity * opacityBoost) },
      uTime,
      uPhase: { value: sceneRandom() * Math.PI * 2 },
      uBreath: { value: options.breath ?? 0.12 },
      uReveal: options.reveal ?? { value: 1 },
      uBoost: options.boost ?? { value: 1 },
    },
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

const TRAIL_VERTEX = /* glsl */ `
  attribute float aAngle;
  varying float vAngle;
  void main() {
    vAngle = aAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAGMENT = /* glsl */ `
  const float TAU = 6.2831853;
  uniform vec3 uColor;
  uniform float uBase;
  uniform float uGlow;
  uniform float uMoonAngle;
  uniform float uReveal;
  varying float vAngle;
  void main() {
    float behind = mod(uMoonAngle - vAngle, TAU);
    float ahead = mod(vAngle - uMoonAngle, TAU);
    float trail = exp(-behind * 2.4);
    float head = exp(-ahead * 16.0);
    float alpha = (uBase + uGlow * (trail + head)) * uReveal;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/**
 * Moon-orbit material: a dim base circle plus a bright arc of light the moon
 * drags behind itself. `uMoonAngle` follows the moon's orbital angle.
 */
export function makeTrailMaterial(color: string, reveal: RevealRef): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      // Matches the planet orbit rings as seen in a focused view.
      uBase: { value: 0.3 },
      uGlow: { value: 0.9 },
      uMoonAngle: { value: 0 },
      uReveal: reveal,
    },
    vertexShader: TRAIL_VERTEX,
    fragmentShader: TRAIL_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

const FRESNEL_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRESNEL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.0);
    float alpha = rim * uIntensity;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/** Soft luminous limb glow inside each grid sphere. */
export function makeFresnelMaterial(color: string, intensity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uIntensity: { value: intensity },
    },
    vertexShader: FRESNEL_VERTEX,
    fragmentShader: FRESNEL_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

const MOON_CORE_VERTEX = /* glsl */ `
  uniform float uSize;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Clamp so the glow never balloons when the camera gets close.
    gl_PointSize = min(uSize * (160.0 / -mvPosition.z), 52.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const MOON_CORE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uReveal;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float glow = exp(-d * 3.4) * 0.85;
    float core = smoothstep(0.22, 0.0, d) * 1.7;
    float alpha = (glow + core) * uReveal;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/** The moon itself reads as a bright traveling point of light. */
export function makeMoonCoreMaterial(reveal: RevealRef, size: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color("#eafaff") },
      uReveal: reveal,
      uSize: { value: size },
    },
    vertexShader: MOON_CORE_VERTEX,
    fragmentShader: MOON_CORE_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

const STAR_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uPixelRatio;
  varying float vSeed;
  void main() {
    vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (1.4 + aSeed * 2.2) * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying float vSeed;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float disc = smoothstep(1.0, 0.25, d);
    float twinkle = 1.0 - uAmp * (0.5 + 0.5 * sin(uTime * (0.4 + vSeed * 1.3) + vSeed * 40.0));
    float alpha = disc * twinkle * (0.25 + 0.55 * fract(vSeed * 7.31));
    gl_FragColor = vec4(vec3(alpha), alpha);
  }
`;

export function makeStarMaterial(pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime,
      uAmp: { value: 0.45 },
      uPixelRatio: { value: pixelRatio },
    },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}
