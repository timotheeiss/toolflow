import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type AsyncState<T> =
  { status: "loading" } | { status: "error"; error: Error } | { status: "success"; data: T };

export function useAsync<T>(loader: () => Promise<T>): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void loader().then(
      (data) => {
        if (active) setState({ status: "success", data });
      },
      (error: unknown) => {
        if (active) setState({ status: "error", error: toError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [loader, version]);

  return { ...state, reload };
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error("An unexpected error occurred.");
}

export function formString(form: FormData, name: string, fallback = ""): string {
  const value = form.get(name);
  return typeof value === "string" ? value : fallback;
}

export function useModalDialog(
  open: boolean,
  onClose: () => void,
  returnFocus: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement | null> {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "a[href]",
    ].join(",");
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>(focusableSelector));
    if (!element.contains(document.activeElement)) focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener("keydown", handleKeyDown);
    return () => {
      element.removeEventListener("keydown", handleKeyDown);
      returnFocus.current?.focus();
    };
  }, [open, returnFocus]);

  return dialog;
}
