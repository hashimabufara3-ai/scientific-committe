import { redirect } from "next/navigation";

/* Legacy route: /[lang]/admin was renamed to /[lang]/management to match the
   existing "Management" UI label. This page preserves old bookmarks by
   redirecting to the renamed route. Authorization for the management route is
   enforced server-side at app/[lang]/management/page.tsx (requireRole), so no
   auth logic lives here. */
export default async function AdminRedirect({
  params,
}: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  redirect(`/${lang}/management`);
}
