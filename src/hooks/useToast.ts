import { useState, useCallback } from "react";
import type { ToastItem } from "@/types/workspace";

export function useToast(autoDismissMs: number = 3500) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (message: string, type: "success" | "error" | "info") => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, autoDismissMs);
    },
    [autoDismissMs]
  );

  return {
    toasts,
    showToast,
  };
}
export type UseToastReturn = ReturnType<typeof useToast>;
