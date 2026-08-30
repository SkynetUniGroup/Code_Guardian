import { useEffect, type ReactNode } from 'react';

interface ModalOverlayProps {
  /** Whether the modal is visible. */
  open: boolean;

  /** Called when the user clicks the backdrop or presses Escape. */
  onClose: () => void;

  /** Modal body content. */
  children: ReactNode;

  /** Accessible title for the dialog element. */
  title: string;
}

/**
 * Reusable modal overlay component.
 *
 * Renders a full-screen semi-transparent backdrop and a centred dialog card.
 * Pressing Escape closes the modal. Focus is not trapped — for full
 * accessibility in production, consider replacing with @radix-ui/react-dialog.
 */
export function ModalOverlay({ open, onClose, children, title }: ModalOverlayProps) {
  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const handle_keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle_keydown);
    return () => document.removeEventListener('keydown', handle_keydown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog card */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-base font-semibold text-[#2a2a2a]">{title}</h2>
        {children}
      </div>
    </div>
  );
}
