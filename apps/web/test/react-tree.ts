import type { ReactElement, ReactNode } from "react";

/**
 * Every element (host or component) anywhere in an unrendered JSX tree
 * (`element.props.children` walked directly, no DOM/React reconciler
 * involved) whose `className` contains the given substring -- for
 * asserting on responsive grid wrapper classes from a page component's
 * plain return value (e.g. `await DashboardHomePage()`). Shared by
 * `home/page.test.tsx` and `reports/page.test.tsx` (previously duplicated
 * verbatim in both, review finding, spec-mobile-responsive-phase1-nav-foundation).
 */
export function findAllByClassName(node: ReactNode, substring: string, out: ReactElement[] = []): ReactElement[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      findAllByClassName(child, substring, out);
    }
    return out;
  }
  const element = node as ReactElement<{ className?: string; children?: ReactNode }>;
  if (typeof element.props?.className === "string" && element.props.className.includes(substring)) {
    out.push(element);
  }
  findAllByClassName(element.props?.children, substring, out);
  return out;
}
