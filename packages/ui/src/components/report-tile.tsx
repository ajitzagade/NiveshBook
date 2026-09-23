import type { ReactNode } from "react";

export interface ReportTileProps {
  icon: ReactNode;
  iconColor: string;
  name: string;
  description: string;
}

export function ReportTile({ icon, iconColor, name, description }: ReportTileProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
      <span
        className="flex h-[30px] w-[30px] items-center justify-center rounded-el text-[14px] text-white"
        style={{ background: iconColor }}
      >
        {icon}
      </span>
      <span className="text-[13px] font-bold">{name}</span>
      <span className="text-[11.6px] text-ink-faint">{description}</span>
    </div>
  );
}
