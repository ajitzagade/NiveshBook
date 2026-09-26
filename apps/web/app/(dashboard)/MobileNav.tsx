"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger, Logo } from "@niveshbook/ui";
import { SidebarShell } from "./SidebarShell";
import type { SidebarNavItem } from "./SidebarNav";

/**
 * The below-860px persistent top bar (logo + hamburger) and the off-canvas
 * drawer it opens (spec-mobile-responsive-phase1-nav-foundation, Decision
 * #1). `layout.tsx`'s own `<aside>` is untouched at >=860px and simply
 * hidden below it (`max-[860px]:hidden`) instead of restacking in-flow
 * above page content -- that in-flow stack was the actual bug this spec
 * exists to fix, so the fix is "stop rendering it there," not "restyle it."
 *
 * This mounts a SECOND `SidebarShell` instance rather than relocating the
 * existing one -- the simplest way to get byte-identical `>=860px` output
 * (the desktop `<aside>` in `layout.tsx` is literally untouched JSX) while
 * still giving mobile a real off-canvas panel. This costs nothing extra on
 * page load: Radix Dialog's `Content` (and everything inside it, including
 * this second `SidebarShell`'s own project fetch/effects) isn't mounted
 * into the DOM until the drawer is actually opened for the first time.
 */
export function MobileNav({ items, appName }: { items: readonly SidebarNavItem[]; appName: string }) {
  const [open, setOpen] = useState(false);

  // Review finding: a device rotation/foldable/resize that crosses back
  // into desktop width (>=860px, this shell's one existing breakpoint)
  // while the drawer is open left the portaled overlay/panel mounted --
  // focus-trapped and scroll-locked on top of the newly-revealed desktop
  // sidebar, since only the hamburger/top bar (CSS-hidden) reacted to the
  // width change. Tailwind's `max-[860px]:` variant is exclusive
  // (`width < 860px`), so "desktop" begins exactly at 860px -- this
  // listener mirrors that boundary precisely.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 860px)");
    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return (
    <div className="hidden items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3 max-[860px]:flex">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[15px] font-bold tracking-tight text-ink">{appName}</span>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <button
            type="button"
            aria-label="Open navigation menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-el text-ink hover:bg-surface-alt"
          >
            <Menu size={20} />
          </button>
        </DrawerTrigger>
        <DrawerContent title="Navigation">
          <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-0.5">
            <div className="flex items-center gap-2">
              <Logo />
              <span className="text-[15px] font-bold tracking-tight text-ink">{appName}</span>
            </div>
            {/* Review finding: backdrop-tap/Escape were the only close
                affordances -- Escape doesn't exist on touch devices, so an
                explicit close button is needed inside the panel itself.
                `DrawerClose` (a bare Radix `Dialog.Close` re-export) needs
                no `onClick` of its own -- it closes via Radix's own
                mechanism, consistent with the hamburger trigger's styling. */}
            <DrawerClose asChild>
              <button
                type="button"
                aria-label="Close navigation menu"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-el text-ink hover:bg-surface-alt"
              >
                <X size={18} />
              </button>
            </DrawerClose>
          </div>
          {/* Closes the drawer on nav-item selection, Project switch, or
              "All Investments" (Decision #2) -- backdrop tap/Escape close
              via Radix Dialog's own default behavior, no callback needed. */}
          <SidebarShell items={items} onNavigate={() => setOpen(false)} />
        </DrawerContent>
      </Drawer>
    </div>
  );
}
