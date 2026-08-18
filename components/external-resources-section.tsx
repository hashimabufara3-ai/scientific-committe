import { ArrowRightIcon } from "./icons";

type ExternalResource = {
  id: string;
  title: string;
  url: string;
  type: string;
};

type ExternalResourcesSectionProps = {
  resources: ExternalResource[];
  strings: {
    title: string;
    watch: string;
  };
};

export default function ExternalResourcesSection({
  resources,
  strings,
}: ExternalResourcesSectionProps) {
  if (resources.length === 0) return null;

  return (
    <section className="mt-20" aria-label={strings.title}>
      <div className="mt-8 space-y-4">
        {resources.map((resource) => (
          <a
            key={resource.id}
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-accent/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-foreground">
                  {resource.title}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  {resource.type === "youtube" ? "YouTube" : resource.type}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                {strings.watch}
                <ArrowRightIcon className="h-4 w-4 rtl-flip" />
              </span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
