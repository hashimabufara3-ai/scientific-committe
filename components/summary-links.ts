export function isSummaryLink(anchor: HTMLAnchorElement, lang: string): boolean {
  const href = anchor.getAttribute("href") ?? "";
  const pattern = new RegExp(`^/${lang}/summaries/[^/]+/[^/]+$`);
  return pattern.test(href);
}
