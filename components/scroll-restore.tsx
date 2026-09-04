"use client";

import { useLayoutEffect } from "react";

/* Global scroll-restoration behavior.

   On a full page load (fresh browser reload/hydration), force the window back
   to the top (0,0) instead of letting the browser restore the previous scroll
   position.

   It lives in the root layout as a Client Component so it mounts exactly once
   per full page load and never remounts on Next.js client-side navigation
   (the [lang] layout is reused across route changes). Therefore it does not
   interfere with per-route scroll restoration, anchor links (#main-content),
   dialogs/modals, or in-page scrolling.

   It renders nothing and only touches `window` inside useLayoutEffect (which
   never runs on the server), so it is SSR-safe. `behavior: "instant"` forces
   the jump to be immediate even though globals.css sets
   `html { scroll-behavior: smooth }`, which would otherwise animate the
   scroll from mid-page to the top on every reload. */
export function ScrollRestore() {
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  return null;
}
