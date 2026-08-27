import { cn } from "@/lib/utils";

const NOTICE_CLASS =
  "flex max-w-[min(86%,44rem)] flex-col gap-0.5 self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-text-tertiary/60";

interface AgentActivityNoticeProps {
  label: string;
  pending?: boolean;
}

/** Compact transient status line — same visual language as agent-delivery notices. */
export function AgentActivityNotice({ label, pending = false }: AgentActivityNoticeProps) {
  return (
    <article className="flex w-full justify-center">
      <div
        className={NOTICE_CLASS}
        data-slot="mobile-agent-activity-notice"
        role="status"
        aria-live="polite"
      >
        <span
          className={cn(
            "flex items-center justify-center gap-1.5 text-center",
            pending && "shimmer",
          )}
        >
          {pending ? (
            <span
              className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current"
              aria-hidden
            />
          ) : null}
          <span className="wrap-anywhere">{label}</span>
        </span>
      </div>
    </article>
  );
}
