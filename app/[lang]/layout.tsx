import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Arabic } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { getDictionary, hasLocale } from "./dictionaries";
import Nav from "../../components/nav";
import { Footer } from "../../components/footer";
import WorldBackdrop from "../../components/world-backdrop";
import { ScrollRestore } from "../../components/scroll-restore";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoArabic = Noto_Sans_Arabic({
  variable: "--font-noto-arabic",
  subsets: ["arabic"],
});

export function generateStaticParams() {
  return [{ lang: "en" }, { lang: "ar" }];
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);

  return {
    title: {
      default: dict.metadata.siteName,
      template: `%s · ${dict.metadata.siteName}`,
    },
    description: dict.metadata.description,
    keywords: dict.metadata.keywords,
    openGraph: {
      title: `${dict.metadata.siteName} — ${dict.metadata.university}`,
      description: dict.metadata.description,
      siteName: `${dict.metadata.university} · ${dict.metadata.campus}`,
      locale: lang === "ar" ? "ar_PS" : "en_US",
      type: "website",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0d12",
};

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const navLinks = [
    { href: `/${lang}`, label: dict.nav.home },
    { href: `/${lang}/about`, label: dict.nav.about },
    { href: `/${lang}/contact`, label: dict.nav.contact },
  ];

  return (
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${notoArabic.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
        >
          {dict.nav.skipToContent}
        </a>
        <div
          aria-hidden="true"
          className="site-grid"
        />
        <WorldBackdrop />
        <Nav
          dict={{
            ...dict.nav,
            siteName: dict.metadata.siteName,
            campus: dict.metadata.campus,
          }}
          lang={lang}
        />
        <div className="page-entrance flex flex-1 flex-col">{children}</div>
        <Footer
          dict={{
            ...dict.footer,
            siteName: dict.metadata.siteName,
            campus: dict.metadata.campus,
            links: navLinks,
            socials: dict.contactPage.socials,
          }}
          lang={lang}
        />
        <ScrollRestore />
      </body>
    </html>
  );
}
