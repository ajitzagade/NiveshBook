import { Toaster as SonnerToaster } from "sonner";

export { toast } from "sonner";

/**
 * Mount once, in the root layout. Four types carry real product meaning
 * (EXPERIENCE.md: explicit plain-language confirmations, never a bare
 * "Success") -- success/error/info/warning, styled from DESIGN.md's status
 * colors via .nb-toast-* in tokens.css. Use `toast.success(...)`,
 * `toast.error(...)`, `toast.info(...)`, `toast.warning(...)` from the
 * re-exported `toast`.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: "nb-toast",
          success: "nb-toast-success",
          error: "nb-toast-error",
          info: "nb-toast-info",
          warning: "nb-toast-warning",
        },
      }}
    />
  );
}
