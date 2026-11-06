import { Eyebrow, Reveal } from "../Reveal";

export function ThinkingPanel() {
  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <Reveal i={0}>
        <Eyebrow>How I Think</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <h2 className="text-3xl font-extralight tracking-wide text-white">A point of view</h2>
      </Reveal>
      <Reveal i={2}>
        <p className="max-w-md text-sm font-light leading-relaxed text-white/70">
          I’m interested in how systems fit together, and in the ideas that make useful software
          simpler and more dependable.
        </p>
      </Reveal>
      <Reveal i={3}>
        <p className="max-w-md text-sm font-light leading-relaxed text-white/50">
          My career and studies have taken me from Montreal to Vancouver. I speak English, French,
          and Korean.
        </p>
      </Reveal>
      <Reveal i={4}>
        <p className="max-w-md text-sm font-light leading-relaxed text-white/50">
          Outside of work, I enjoy exploring open-source software and interesting technology. This
          site is a simple place to share a little about me.
        </p>
      </Reveal>
      <Reveal i={5}>
        <p className="text-xs font-light tracking-wide text-white/40">
          A practice of asking better questions.
        </p>
      </Reveal>
    </div>
  );
}
