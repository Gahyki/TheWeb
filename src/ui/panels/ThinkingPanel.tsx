import { thinking } from "../../data/siteContent";
import { Eyebrow, Reveal } from "../Reveal";

export function ThinkingPanel() {
  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <Reveal i={0}>
        <Eyebrow>How I Think</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <h2 className="text-3xl font-extralight tracking-wide text-white">{thinking.title}</h2>
      </Reveal>
      {thinking.paragraphs.map((paragraph, index) => (
        <Reveal i={2 + index} key={paragraph}>
          <p
            className={`max-w-md text-sm font-light leading-relaxed ${
              index === 0 ? "text-white/70" : "text-white/50"
            }`}
          >
            {paragraph}
          </p>
        </Reveal>
      ))}
      <Reveal i={5}>
        <p className="text-xs font-light tracking-wide text-white/40">{thinking.closing}</p>
      </Reveal>
    </div>
  );
}
