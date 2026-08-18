export function isSummaryLink(anchor: HTMLAnchorElement, lang: string): boolean {
  const href = anchor.getAttribute("href") ?? "";
  const pattern = new RegExp(`^/${lang}/resources/[^/]+/[^/]+$`);
  return pattern.test(href);
}
