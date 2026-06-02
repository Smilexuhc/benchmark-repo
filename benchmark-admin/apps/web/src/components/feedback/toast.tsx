import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { create } from 'zustand';

// Sonner's toast region is aria-live="polite", which is the right default for
// success/info/warning. Errors should announce immediately — we mirror the most
// recent error message into an off-screen role="alert" region so assistive tech
// interrupts and reads it without depending on sonner internals.
const useErrorAnnouncementStore = create<{
  message: string;
  bump: number;
  announce: (message: string) => void;
}>((set) => ({
  message: '',
  bump: 0,
  announce: (message) => set((s) => ({ message, bump: s.bump + 1 })),
}));

type Message = Parameters<typeof sonnerToast.success>[0];
type Options = Parameters<typeof sonnerToast.success>[1];

function messageToString(message: Message): string {
  if (typeof message === 'string') return message;
  if (typeof message === 'number') return String(message);
  return '';
}

export const toast = {
  success: (message: Message, options?: Options) => sonnerToast.success(message, options),
  info: (message: Message, options?: Options) => sonnerToast.info(message, options),
  warning: (message: Message, options?: Options) => sonnerToast.warning(message, options),
  error: (message: Message, options?: Options) => {
    useErrorAnnouncementStore.getState().announce(messageToString(message));
    return sonnerToast.error(message, options);
  },
  dismiss: (id?: number | string) => sonnerToast.dismiss(id),
};

export function Toaster() {
  const message = useErrorAnnouncementStore((s) => s.message);
  // bump forces React to re-render the announcement node even when the message
  // text repeats, so AT re-announces the same error on a second trigger.
  const bump = useErrorAnnouncementStore((s) => s.bump);

  return (
    <>
      <SonnerToaster
        position="top-right"
        richColors
        closeButton
        // Tailwind tokens — keep the toast skin aligned with the rest of the
        // admin theme so light/dark swaps continue to work via CSS variables.
        toastOptions={{
          classNames: {
            toast:
              'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-md',
            description: 'text-[hsl(var(--muted-foreground))]',
          },
        }}
      />
      <div
        key={bump}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {message}
      </div>
    </>
  );
}
