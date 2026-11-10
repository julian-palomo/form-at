import { type ReactNode, useEffect, useRef } from "react";

// The ticket's QR filling the screen, white edge to edge, for the scanner at
// the door of a dark club: the card's QR is 224px on a dimmed phone, this one
// is the width of the screen on a white background. A native <dialog> in the
// top layer, so it escapes the page's own stacking and any transform the
// swipe navigation leaves on the page. The whole surface is one button, so a
// tap anywhere, Enter, Space or Escape closes it. The contents mount only
// while open: a closed dialog holds no second copy of the QR or the label.
export function TicketQrFullscreen({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The card's tag, e.g. "ticket 1 of 2". */
  label: string;
  /** The QR itself, the same node the card draws. */
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label="ticket QR code, full screen"
      // Escape fires `cancel`; the state follows so the dialog can reopen.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none bg-white p-0 backdrop:bg-white"
    >
      {open && (
        <button
          type="button"
          onClick={onClose}
          className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-6 px-6"
        >
          <span className="block w-full max-w-sm aspect-square bg-white">{children}</span>
          <span className="font-mono text-sm tracking-widest text-black">
            {label} · tap to close
          </span>
        </button>
      )}
    </dialog>
  );
}
