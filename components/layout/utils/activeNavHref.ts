export type NavHrefItem = {
  href: string;
};

/**
 * Pick the sidebar nav href that best matches the current pathname using
 * longest-prefix rules. Root (`/`) matches only exactly.
 */
export const pickActiveNavHref = (
  pathname: string,
  items: readonly NavHrefItem[],
): string | null => {
  let best: string | null = null;

  for (const { href } of items) {
    const matches =
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(`${href}/`);

    if (!matches) continue;
    if (best === null || href.length > best.length) {
      best = href;
    }
  }

  return best;
};
