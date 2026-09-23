import type { ReactNode } from "react";

export interface ShareRowProps {
  name: string;
  input: ReactNode;
  action?: ReactNode;
}

export function ShareRow({ name, input, action }: ShareRowProps) {
  return (
    <div className="grid grid-cols-[1fr_110px_70px] items-center gap-2.5 rounded-[10px] border border-border px-3 py-2.5">
      <span className="font-semibold text-[13.4px]">{name}</span>
      {input}
      {action}
    </div>
  );
}

export function ShareList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2.5">{children}</div>;
}
