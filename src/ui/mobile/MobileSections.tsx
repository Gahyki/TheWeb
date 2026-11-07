import type { ReactNode } from "react";
import { publicContactEmail } from "../../data/contact";
import { experience, thinking } from "../../data/siteContent";
import { useGithubSnapshot } from "../../hooks/useGithubSnapshot";
import type { BodyId } from "../../state/store";
import type { ContributionCalendar, FeaturedRepo } from "../github";
import { FALLBACK_REPOS } from "../github";
import { ContactForm } from "../panels/ContactPanel";
import { Eyebrow, Reveal } from "../Reveal";

const WEEKS_SHOWN = 26;

/** Opens the section's sheet: the "…more" of a long reel caption. */
function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 items-center gap-2 self-start rounded-full border border-white/20 px-5 text-xs uppercase tracking-[0.25em] text-white/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 active:bg-white/10"
    >
      {label}
      <span aria-hidden="true">↑</span>
    </button>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <h2 className="text-2xl font-extralight leading-tight tracking-wide text-white">{children}</h2>;
}

/** Days since the most recent contribution; weeks end on today. */
function lastActiveDaysAgo(calendar: ContributionCalendar): number | null {
  const days = calendar.weeks.flat();
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i] > 0) {
      return days.length - 1 - i;
    }
  }
  return null;
}

function relativeDay(daysAgo: number): string {
  if (daysAgo === 0) {
    return "today";
  }
  if (daysAgo === 1) {
    return "yesterday";
  }
  return daysAgo < 14 ? `${daysAgo} days ago` : `${Math.round(daysAgo / 7)} weeks ago`;
}

/** One bar per week: readable at phone size where 182 day-dots are not. */
function WeeklyBars({ calendar }: { calendar: ContributionCalendar }) {
  const weeks = calendar.weeks.slice(-WEEKS_SHOWN).map((week) => week.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...weeks);
  const shownTotal = weeks.reduce((a, b) => a + b, 0);
  return (
    <div
      role="img"
      aria-label={`${shownTotal} contributions in the last ${WEEKS_SHOWN} weeks`}
      className="flex h-12 items-end gap-[3px]"
    >
      {weeks.map((count, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekly series
          key={index}
          className="flex-1 rounded-[1px]"
          style={{
            height: count === 0 ? 2 : `${Math.max(12, (count / max) * 100)}%`,
            backgroundColor: `rgba(191, 234, 255, ${count === 0 ? 0.12 : 0.35 + 0.55 * (count / max)})`,
          }}
        />
      ))}
    </div>
  );
}

function RepoRow({ repo }: { repo: FeaturedRepo }) {
  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 py-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 active:bg-white/5"
    >
      <span className="min-w-0">
        <span className="block font-mono text-sm uppercase tracking-[0.15em] text-white">{repo.name}</span>
        {repo.description && (
          <span className="mt-0.5 block truncate text-sm font-light text-white/55">{repo.description}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-3 text-xs text-cyan-100/60">
        {repo.language}
        <span aria-hidden="true" className="text-lg text-white/40">
          ›
        </span>
      </span>
    </a>
  );
}

/** What each reel shows over its planet: a short, scannable caption. */
export function MobileOverlay({ id, onMore }: { id: BodyId; onMore: () => void }) {
  switch (id) {
    case "earth":
      return <HomeOverlay />;
    case "saturn":
      return <ExperienceOverlay onMore={onMore} />;
    case "jupiter":
      return <ThinkingOverlay onMore={onMore} />;
    case "mars":
      return <GithubOverlay onMore={onMore} />;
    case "sun":
      return <ContactOverlay onMore={onMore} />;
  }
}

/**
 * Home leads with what matters most: the role and where it is held right
 * now, then location as a caption. Languages and education live in How I
 * Think and Experience.
 */
function HomeOverlay() {
  const current = experience[0];
  return (
    <div className="flex flex-col gap-5">
      <Reveal i={0}>
        <h1 className="text-[30px] font-extralight leading-tight tracking-wide text-white">Jason Kim</h1>
      </Reveal>
      <Reveal i={1}>
        <p className="text-xl font-light leading-tight text-white">Software engineer</p>
      </Reveal>
      <Reveal i={2}>
        <div className="flex flex-col gap-1 border-l border-cyan-100/40 pl-4">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-cyan-100/60">
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-200/60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-200" />
            </span>
            Currently
          </p>
          <p className="text-[17px] font-light text-white">{current.organization}</p>
          <p className="text-sm font-light text-white/70">
            CloudFront · API team · since {current.dates.split("—")[0].trim()}
          </p>
        </div>
      </Reveal>
      <Reveal i={3}>
        <p className="whitespace-nowrap font-mono text-xs tracking-[0.1em] text-cyan-100/55">Vancouver · 49.28° N 123.12° W</p>
      </Reveal>
    </div>
  );
}

function ExperienceOverlay({ onMore }: { onMore: () => void }) {
  const current = experience[0];
  return (
    <div className="flex flex-col gap-4">
      <Reveal i={0}>
        <Eyebrow>Experience</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <Title>Experience &amp; education</Title>
      </Reveal>
      <Reveal i={2}>
        <div className="border-l border-cyan-100/30 pl-4">
          <p className="text-base font-light text-white">{current.organization}</p>
          <p className="text-sm font-light text-white/70">
            {current.title} · {current.location}
          </p>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.15em] text-cyan-100/60">
            {current.dates}
          </p>
        </div>
      </Reveal>
      <Reveal i={3}>
        <MoreButton label={`All ${experience.length} entries`} onClick={onMore} />
      </Reveal>
    </div>
  );
}

function ThinkingOverlay({ onMore }: { onMore: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Reveal i={0}>
        <Eyebrow>How I Think</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <Title>{thinking.title}</Title>
      </Reveal>
      <Reveal i={2}>
        <p className="text-base font-light leading-relaxed text-white/75">{thinking.paragraphs[0]}</p>
      </Reveal>
      <Reveal i={3}>
        <MoreButton label="Read more" onClick={onMore} />
      </Reveal>
    </div>
  );
}

function GithubOverlay({ onMore }: { onMore: () => void }) {
  const { snapshot } = useGithubSnapshot();
  const calendar = snapshot?.contributions ?? null;
  const repos = snapshot && snapshot.repos.length > 0 ? snapshot.repos : FALLBACK_REPOS;
  const daysAgo = calendar ? lastActiveDaysAgo(calendar) : null;
  return (
    <div className="flex flex-col gap-4">
      <Reveal i={0}>
        <Eyebrow>GitHub</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <Title>Open source</Title>
      </Reveal>
      {calendar && (
        <Reveal i={2}>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-light text-white/75">
              {calendar.total} contributions this year
              {daysAgo !== null ? ` · last active ${relativeDay(daysAgo)}` : ""}
            </p>
            <WeeklyBars calendar={calendar} />
          </div>
        </Reveal>
      )}
      <Reveal i={3}>
        <MoreButton label={`${repos.length} repositories`} onClick={onMore} />
      </Reveal>
    </div>
  );
}

function ContactOverlay({ onMore }: { onMore: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Reveal i={0}>
        <Eyebrow>Contact</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <Title>Curiosity makes good company.</Title>
      </Reveal>
      <Reveal i={2}>
        <p className="text-base font-light leading-relaxed text-white/75">
          I'm always interested in thoughtful work, interesting problems, and ideas worth exploring.
        </p>
      </Reveal>
      <Reveal i={3}>
        <button
          type="button"
          onClick={onMore}
          className="h-12 w-full rounded-full border border-white/30 bg-white/5 text-xs uppercase tracking-[0.3em] text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 active:bg-white/15"
        >
          Send a message
        </button>
      </Reveal>
    </div>
  );
}

/** Sheet titles; Home fits its overlay and has no sheet. */
export const SHEET_TITLES: Partial<Record<BodyId, string>> = {
  saturn: "Experience",
  jupiter: "How I Think",
  mars: "GitHub",
  sun: "Contact",
};

/** The full content behind each overlay's "more". */
export function SheetContent({ id }: { id: BodyId }) {
  switch (id) {
    case "saturn":
      return (
        <ol className="relative ml-1 flex flex-col gap-6 border-l border-white/15 py-2 pl-5">
          {experience.map((entry) => (
            <li key={entry.organization} className="relative">
              <span
                aria-hidden="true"
                className="absolute top-2 -left-[25px] h-2 w-2 rounded-full border border-cyan-100/60 bg-black"
              />
              <p className="text-base font-light text-white">{entry.organization}</p>
              <p className="text-sm font-light text-white/70">
                {entry.title} · {entry.location}
              </p>
              <p className="mt-1 font-mono text-xs uppercase tracking-[0.15em] text-cyan-100/60">
                {entry.dates}
              </p>
            </li>
          ))}
        </ol>
      );
    case "jupiter":
      return (
        <div className="flex flex-col gap-5">
          {thinking.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-base font-light leading-relaxed text-white/80">
              {paragraph}
            </p>
          ))}
          <blockquote className="border-l border-cyan-100/40 pl-4 text-lg font-extralight italic text-cyan-50/90">
            {thinking.closing}
          </blockquote>
        </div>
      );
    case "mars":
      return <GithubSheet />;
    case "sun":
      return (
        <div className="flex flex-col gap-5">
          <ContactForm large />
          {publicContactEmail && (
            <p className="text-sm font-light text-white/50">
              Prefer email?{" "}
              <a href={`mailto:${publicContactEmail}`} className="text-cyan-100/80 underline-offset-4 hover:underline">
                {publicContactEmail}
              </a>
            </p>
          )}
        </div>
      );
    default:
      return null;
  }
}

function GithubSheet() {
  const { snapshot, failed } = useGithubSnapshot();
  const repos = snapshot && snapshot.repos.length > 0 ? snapshot.repos : FALLBACK_REPOS;
  return (
    <div className="flex flex-col">
      {repos.map((repo) => (
        <RepoRow key={repo.name} repo={repo} />
      ))}
      <a
        href="https://github.com/Gahyki"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex h-12 items-center justify-center rounded-full border border-white/15 text-xs uppercase tracking-[0.3em] text-cyan-100/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 active:bg-white/10"
      >
        github.com/Gahyki →{failed ? " (live data unavailable)" : ""}
      </a>
    </div>
  );
}
