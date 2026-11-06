import { experience } from "../../data/siteContent";
import { Eyebrow, Reveal } from "../Reveal";

export function ExperiencePanel() {
  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <Reveal i={0}>
        <Eyebrow>Experience</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <h2 className="text-3xl font-extralight tracking-wide text-white">
          Experience &amp; education
        </h2>
      </Reveal>
      <ol className="flex flex-col gap-3">
        {experience.map((entry, index) => (
          <li key={entry.organization}>
            <Reveal i={2 + index}>
              <div className="border border-white/10 bg-black/40 px-5 py-4 backdrop-blur-sm transition-colors duration-300 hover:border-white/25">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <h3 className="text-sm font-light tracking-wide text-white">
                    {entry.organization}
                  </h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-100/50">
                    {entry.dates}
                  </span>
                </div>
                <p className="mt-1 text-xs font-light text-white/60">
                  {entry.title} · {entry.location}
                </p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </div>
  );
}
