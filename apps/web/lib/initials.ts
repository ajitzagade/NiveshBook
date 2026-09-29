/**
 * Up to 2 uppercase initials from a person's own recorded name (e.g.
 * "Asha Kulkarni" -> "AK", "Bala" -> "B") -- shared by every page that
 * renders a person avatar (`home/page.tsx`'s `ProjectPreviewCard` avatar,
 * originally; `PersonCard`'s own avatar slot, 2026-09-29). Pulled out of
 * `home/page.tsx` into its own file once a second page needed it, rather
 * than importing a page-local export across route groups.
 */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
