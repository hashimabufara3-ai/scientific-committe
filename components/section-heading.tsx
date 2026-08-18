type SectionHeadingProps = {
  kicker?: string;
  title: string;
  subtitle?: string;
  align?: "start" | "center";
  as?: "h1" | "h2";
  id?: string;
};

export default function SectionHeading({
  kicker,
  title,
  subtitle,
  align = "start",
  as: Tag = "h2",
  id,
}: SectionHeadingProps) {
  const alignClass =
    align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl";

  return (
    <div className={alignClass}>
      {kicker && (
        <p className="inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-accent">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 border border-accent/80"
          />
          {kicker}
        </p>
      )}
      <Tag
        id={id}
        className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
      >
        {title}
      </Tag>
      {subtitle && (
        <p className="mt-4 text-base leading-relaxed text-muted">{subtitle}</p>
      )}
    </div>
  );
}
