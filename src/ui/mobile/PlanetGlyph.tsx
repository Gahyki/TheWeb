import { BODY_MAP } from "../../scene/config";
import type { BodyId } from "../../state/store";

/** Tab icon: the planet as a tiny wireframe in its own tint. */
export function PlanetGlyph({ id, active }: { id: BodyId; active: boolean }) {
  const color = BODY_MAP[id].color;
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      className="transition-[opacity,filter] duration-300"
      style={{
        opacity: active ? 1 : 0.6,
        filter: active ? `drop-shadow(0 0 4px ${color})` : "none",
      }}
    >
      <g fill="none" stroke={color} strokeWidth="1">
        <circle cx="12" cy="12" r={id === "sun" ? 7 : 5.5} />
        <ellipse cx="12" cy="12" rx={id === "sun" ? 7 : 5.5} ry="2.2" opacity="0.6" />
        <line x1="12" y1={id === "sun" ? 5 : 6.5} x2="12" y2={id === "sun" ? 19 : 17.5} opacity="0.6" />
        {id === "saturn" && <ellipse cx="12" cy="12" rx="10.5" ry="3" transform="rotate(-18 12 12)" />}
        {id === "earth" && <circle cx="18.5" cy="8" r="1" fill={color} stroke="none" />}
      </g>
    </svg>
  );
}

/** Concentric orbits: the "back to the system" mark. */
export function SystemGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="12" cy="12" r="6" opacity="0.7" />
        <circle cx="12" cy="12" r="9.5" opacity="0.45" />
        <circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
