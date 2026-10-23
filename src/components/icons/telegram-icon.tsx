import { cn } from "@/lib/utils";

/** A restrained line version of the Telegram plane, drawn to match the Lucide set. */
export function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      <path
        d="M21.1 4.35 3.42 10.9c-.8.3-.8 1.44 0 1.74l4.26 1.55 1.66 4.86c.22.66 1.08.8 1.51.24l2.17-2.78 4.23 3.1c.58.43 1.41.11 1.57-.6l2.9-13.5c.18-.84-.64-1.53-1.46-1.2Z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <path
        d="m7.68 12.2 9.88-6.67-7.86 8"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
