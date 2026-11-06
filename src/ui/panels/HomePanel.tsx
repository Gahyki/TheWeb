import { useProfileAge } from "../../hooks/useProfileAge";
import { profileHighlights } from "../../data/siteContent";
import { Eyebrow, Reveal } from "../Reveal";

export function HomePanel() {
  const age = useProfileAge();

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <Reveal i={0}>
        <Eyebrow>Home</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <h1 className="text-4xl font-extralight tracking-wide text-white sm:text-5xl">Jason Kim</h1>
      </Reveal>
      <Reveal i={2}>
        <p className="max-w-md text-sm font-light leading-relaxed text-white/70">
          Software engineer in Vancouver, Canada — currently at AWS CloudFront on the API team.
        </p>
      </Reveal>
      <Reveal i={3}>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.25em] text-cyan-100/50">
          {profileHighlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
          {age !== null && <li aria-live="polite">{age} years old</li>}
        </ul>
      </Reveal>
      <Reveal i={4}>
        <p className="font-mono text-[11px] tracking-[0.2em] text-cyan-100/60">
          49.2827° N · 123.1207° W — Vancouver
        </p>
      </Reveal>
      <Reveal i={5}>
        <p className="text-xs font-light tracking-wide text-white/40">
          Navigate the system — each body is a page.
        </p>
      </Reveal>
    </div>
  );
}
