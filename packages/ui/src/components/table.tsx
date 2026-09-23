import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Composable table primitives matching DESIGN.md's data-table pattern:
 * right-aligned numeric columns, first column left-aligned, one optional
 * sub-row indent level via `subRow` on Table.Row. Each story composes its
 * own columns -- there is no single generic "columns" prop, since the
 * mockup's tables (Add Money, Withdraw, Projects, Partner Shares) all
 * differ in shape.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("nb-table", className)} {...props} />
    </div>
  );
}

export function TableRow({
  subRow,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { subRow?: boolean }) {
  return <tr className={cn(subRow && "nb-sub-row", className)} {...props} />;
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={className} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={className} {...props} />;
}
