import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, ChevronDown, Menu, RefreshCw, Send } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { ListItem } from "@nous-research/ui/ui/components/list-item";
import { Spinner } from "@nous-research/ui/ui/components/spinner";

import { AuthWidget } from "@/components/AuthWidget";
import { Markdown } from "@/components/Markdown";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useProfileScope } from "@/contexts/useProfileScope";
import { api, authedFetch, type SessionInfo, type SessionMessage } from "@/lib/api";
import { GatewayClient } from "@/lib/gatewayClient";
import {
  latestMessageId,
  mergeSessionMessages,
  parseSessionStreamEvent,
  sessionDisplayLabel,
  sessionStreamCursor,
  sessionTitle,
  shouldCollapseMessage,
  type SessionStreamEvent,
} from "@/lib/mobile-session-sync";
import { cn, timeAgo } from "@/lib/utils";

const SESSION_LIMIT = 30;
const STREAM_RETRY_BASE_MS = 1_000;
const STREAM_RETRY_MAX_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function streamRetryDelay(attempt: number): number {
  return Math.min(STREAM_RETRY_BASE_MS * 2 ** Math.min(attempt, 4), STREAM_RETRY_MAX_MS);
}

async function* readSessionEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SessionStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex >= 0) {
        const block = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        const event = parseSessionStreamEvent(data);
        if (event) {
          yield event;
        }
        splitIndex = buffer.indexOf("\n\n");
      }

      if (done) {
        break;
      }
    }

    const tail = buffer.trim();
    if (tail) {
      for (const block of tail.split(/\n\n+/)) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        const event = parseSessionStreamEvent(data);
        if (event) {
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function SessionBadge({
  active,
  session,
  onClick,
}: {
  active: boolean;
  session: SessionInfo;
  onClick: () => void;
}) {
  const label = sessionTitle(session);
  return (
    <ListItem
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left",
        active
          ? "border border-primary/30 bg-primary/10 text-foreground"
          : "border border-transparent bg-muted/20 text-text-secondary hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <span className="w-full truncate text-sm font-medium">{label}</span>
      <span className="flex w-full items-center gap-1.5 text-[0.7rem] text-text-tertiary">
        <span>{timeAgo(session.last_active)}</span>
        {session.message_count > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{session.message_count} msgs</span>
          </>
        )}
      </span>
    </ListItem>
  );
}

function ToolCallBlock({
  toolCall,
}: {
  toolCall: { id: string; function: { name: string; arguments: string } };
}) {
  const [open, setOpen] = useState(false);
  let args = toolCall.function.arguments;
  try {
    args = JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    /* keep raw */
  }

  return (
    <div className="mt-2 overflow-hidden border border-warning/20 bg-warning/5 rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-warning hover:bg-warning/10"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
        <span className="font-mono-ui font-medium">{toolCall.function.name}</span>
        <span className="ml-auto truncate text-warning/50">{toolCall.id}</span>
      </button>
      {open && (
        <pre className="border-t border-warning/20 px-3 py-2 text-xs leading-relaxed text-warning/90 whitespace-pre-wrap break-words font-mono overflow-x-auto">
          {args}
        </pre>
      )}
    </div>
  );
}

function MobileMessageBubble({ message }: { message: SessionMessage }) {
  if (message.display_kind === "hidden") {
    return null;
  }

  const collapseBody = shouldCollapseMessage(message);
  const roleTone =
    message.role === "user"
      ? "border-primary/25 bg-primary/10"
      : message.role === "assistant"
        ? "border-success/20 bg-success/10"
        : message.role === "tool"
          ? "border-warning/20 bg-warning/10"
          : "border-border bg-muted/20";

  const body = message.content?.trim() ?? "";
  const bodyPreview = body.length > 900 ? `${body.slice(0, 900).trim()}…` : body;

  return (
    <article className={cn("rounded-2xl border p-3 shadow-sm", roleTone)}>
      <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-text-tertiary">
        <span>
          {message.role}
          {message.tool_name ? ` · ${message.tool_name}` : ""}
        </span>
        {message.timestamp ? <span>{timeAgo(message.timestamp)}</span> : null}
      </div>

      {body ? (
        collapseBody ? (
          <details className="group">
            <summary className="cursor-pointer list-none rounded-xl border border-current/10 bg-background/60 px-3 py-2 text-sm text-foreground/90">
              <span className="inline-flex items-center gap-2">
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                <span>Show message</span>
                <span className="max-w-[12rem] truncate text-xs text-text-tertiary">{bodyPreview}</span>
              </span>
            </summary>
            <div className="pt-3">
              <Markdown content={body} />
            </div>
          </details>
        ) : (
          <Markdown content={body} />
        )
      ) : (
        <div className="text-sm text-text-tertiary">No text content.</div>
      )}

      {message.tool_calls && message.tool_calls.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {message.tool_calls.map((toolCall) => (
            <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}

      {message.display_metadata && message.display_kind && message.display_kind !== "hidden" && (
        <div className="mt-3 rounded-xl border border-current/10 bg-background/60 px-3 py-2 text-xs text-text-tertiary">
          {message.display_kind}
        </div>
      )}
    </article>
  );
}

async function sendSessionPrompt(
  storedSessionId: string,
  text: string,
  profile?: string,
): Promise<void> {
  const gateway = new GatewayClient();
  try {
    await gateway.connect();
    const resumed = await gateway.request<{ session_id: string }>("session.resume", {
      session_id: storedSessionId,
      omit_messages: true,
      defer_history: true,
      ...(profile ? { profile } : {}),
    });
    await gateway.request("prompt.submit", {
      session_id: resumed.session_id,
      text,
    });
  } finally {
    gateway.close();
  }
}

export default function MobileMirrorPage() {
  const { profile, currentProfile } = useProfileScope();
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionParam = searchParams.get("session") ?? "";
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(sessionParam);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "live" | "reconnecting" | "error">("idle");
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sendBusy, setSendBusy] = useState(false);

  const selectedSessionRef = useRef(selectedSessionId);
  const cursorRef = useRef(0);
  const statusAbortRef = useRef<AbortController | null>(null);
  const streamRunRef = useRef(0);
  const documentTitleRef = useRef(document.title);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const statusText = useMemo(() => {
    if (!selectedSessionId) return "Pick a session to begin";
    if (messagesLoading) return "Loading transcript…";
    if (streamStatus === "connecting") return "Connecting live feed…";
    if (streamStatus === "reconnecting") return "Reconnecting…";
    if (streamStatus === "live") return "Live sync";
    if (streamStatus === "error") return streamNote ?? "Live sync unavailable";
    return "Ready";
  }, [messagesLoading, selectedSessionId, streamNote, streamStatus]);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(null);

    api
      .getSessions(SESSION_LIMIT, 0, profile || "", "recent")
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
        if (!sessionParam && !selectedSessionRef.current) {
          const first = res.sessions[0]?.id ?? "";
          if (first) {
            setSelectedSessionId(first);
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.set("session", first);
              return next;
            }, { replace: true });
          }
        }
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setSessionsError(error.message || "failed to load sessions");
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile, sessionParam, setSearchParams]);

  useEffect(() => {
    if (!sessionParam || sessionParam === selectedSessionId) return;
    setSelectedSessionId(sessionParam);
  }, [selectedSessionId, sessionParam]);

  useEffect(() => {
    let cancelled = false;
    const sessionId = selectedSessionId.trim();

    if (!sessionId) {
      setMessages([]);
      setMessagesLoading(false);
      setStreamStatus("idle");
      setStreamNote(null);
      cursorRef.current = 0;
      return;
    }

    const controller = new AbortController();
    statusAbortRef.current?.abort();
    statusAbortRef.current = controller;
    const runId = ++streamRunRef.current;

    setMessagesLoading(true);
    setStreamNote(null);
    setStreamStatus("connecting");
    cursorRef.current = 0;
    setMessages([]);

    const loadInitial = async () => {
      const response = await api.getSessionMessages(sessionId, profile || "");
      if (cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;

      const resolvedSessionId = response.session_id || sessionId;
      if (resolvedSessionId !== selectedSessionRef.current) {
        setSelectedSessionId(resolvedSessionId);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("session", resolvedSessionId);
          return next;
        }, { replace: true });
      }

      const initialMessages = response.messages ?? [];
      setMessages(initialMessages);
      cursorRef.current = latestMessageId(initialMessages);
      setMessagesLoading(false);
      setStreamStatus("live");
      return resolvedSessionId;
    };

    const syncDelta = async (resolvedSessionId: string, afterId: number) => {
      const next = await api.getSessionMessagesSince(
        resolvedSessionId,
        afterId,
        profile || "",
      );
      if (cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;
      const incoming = next.messages ?? [];
      if (incoming.length === 0) {
        const revision = next.latest_message_id ?? next.revision ?? afterId;
        if (revision > cursorRef.current) {
          cursorRef.current = revision;
        }
        return;
      }
      setMessages((prev) => {
        const merged = mergeSessionMessages(prev, incoming);
        cursorRef.current = latestMessageId(merged);
        return merged;
      });
    };

    const catchUpFromEvent = async (event: SessionStreamEvent, resolvedSessionId: string) => {
      const watermark = sessionStreamCursor(event, cursorRef.current);
      if (watermark <= cursorRef.current) {
        return;
      }
      await syncDelta(resolvedSessionId, cursorRef.current);
    };

    const runStream = async (resolvedSessionId: string) => {
      let attempt = 0;
      while (!controller.signal.aborted && streamRunRef.current === runId) {
        const streamUrl = api.getSessionEventsUrl(
          resolvedSessionId,
          profile || "",
          cursorRef.current,
        );
        try {
          setStreamStatus(attempt === 0 ? "connecting" : "reconnecting");
          const response = await authedFetch(streamUrl, {
            method: "GET",
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`stream unavailable (${response.status})`);
          }

          setStreamStatus("live");
          for await (const event of readSessionEventStream(response.body)) {
            if (controller.signal.aborted || streamRunRef.current !== runId) return;
            if (event.type === "hello") {
              await catchUpFromEvent(event, resolvedSessionId);
              continue;
            }
            if (event.type === "message.appended") {
              await catchUpFromEvent(event, resolvedSessionId);
            }
          }

          if (controller.signal.aborted || streamRunRef.current !== runId) return;
          attempt = 0;
        } catch (error) {
          if (controller.signal.aborted || streamRunRef.current !== runId) return;
          const message = error instanceof Error ? error.message : String(error);
          setStreamNote(message);
          setStreamStatus("reconnecting");
          const delay = streamRetryDelay(attempt++);
          await sleep(delay);
        }
      }
    };

    void loadInitial()
      .then((resolved) => {
        if (!resolved || cancelled || controller.signal.aborted || streamRunRef.current !== runId) {
          return;
        }
        void runStream(resolved);
      })
      .catch((error: Error) => {
        if (cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;
        setMessagesLoading(false);
        setStreamStatus("error");
        setStreamNote(error.message || "failed to load session");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [profile, selectedSessionId, setSearchParams]);

  useEffect(() => {
    const title = activeSession ? `${sessionDisplayLabel(activeSession)} · Hermes Mobile` : "Hermes Mobile";
    document.title = title;
    return () => {
      document.title = documentTitleRef.current;
    };
  }, [activeSession]);

  const pickSession = useCallback(
    (id: string) => {
      setSelectedSessionId(id);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("session", id);
        return next;
      }, { replace: false });
      setRailOpen(false);
    },
    [setSearchParams],
  );

  const reloadSessions = useCallback(() => {
    setSessionsLoading(true);
    setSessionsError(null);
    api
      .getSessions(SESSION_LIMIT, 0, profile || "", "recent")
      .then((res) => setSessions(res.sessions))
      .catch((error: Error) => setSessionsError(error.message || "failed to load sessions"))
      .finally(() => setSessionsLoading(false));
  }, [profile]);

  const submitComposer = useCallback(async () => {
    const text = composer.trim();
    if (!text || !selectedSessionId || sendBusy) return;
    setSendBusy(true);
    try {
      setComposer("");
      await sendSessionPrompt(selectedSessionId, text, profile || undefined);
    } catch (error) {
      setStreamNote(error instanceof Error ? error.message : String(error));
      setStreamStatus("error");
    } finally {
      setSendBusy(false);
    }
  }, [composer, profile, sendBusy, selectedSessionId]);

  const sendDisabled = !composer.trim() || !selectedSessionId || sendBusy;

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background-base text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b border-current/10 px-3 py-2">
        <Button
          ghost
          size="icon"
          onClick={() => setRailOpen((next) => !next)}
          aria-label={railOpen ? "Close sessions" : "Open sessions"}
        >
          <Menu />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {sessionDisplayLabel(activeSession)}
          </div>
          <div className="truncate text-[0.7rem] text-text-tertiary">{statusText}</div>
        </div>

        <Button
          ghost
          size="icon"
          onClick={reloadSessions}
          aria-label="Refresh sessions"
          title="Refresh sessions"
        >
          <RefreshCw className={cn(sessionsLoading && "animate-spin")} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 w-[min(88vw,20rem)] border-r border-current/10 bg-background-base transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-80 lg:translate-x-0",
            railOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          )}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-current/10 px-3 py-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Sessions</div>
                <div className="truncate text-sm text-text-secondary">
                  {currentProfile === profile || !profile ? currentProfile || "default" : profile}
                </div>
              </div>
              <Button ghost size="icon" onClick={reloadSessions} aria-label="Refresh sessions">
                <RefreshCw className={cn(sessionsLoading && "animate-spin")} />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {sessionsError ? (
                <div className="flex flex-col gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{sessionsError}</span>
                  </div>
                  <Button outlined size="sm" onClick={reloadSessions} prefix={<RefreshCw />}>
                    Retry
                  </Button>
                </div>
              ) : sessionsLoading && sessions.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-tertiary">
                  <Spinner /> Loading sessions…
                </div>
              ) : sessions.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-text-tertiary">
                  No sessions found for this profile.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {sessions.map((session) => (
                    <SessionBadge
                      key={session.id}
                      session={session}
                      active={session.id === selectedSessionId}
                      onClick={() => pickSession(session.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-current/10 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <ProfileSwitcher />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[0.7rem] text-text-tertiary">
                <span>{streamStatus === "live" ? "Connected" : statusText}</span>
                <span>{messages.length} messages</span>
              </div>
              <AuthWidget className="mt-2" />
            </div>
          </div>
        </aside>

        {railOpen && (
          <button
            type="button"
            aria-label="Close sessions overlay"
            onClick={() => setRailOpen(false)}
            className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          />
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {messagesLoading && messages.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-text-tertiary">
                <Spinner /> Loading transcript…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-tertiary">
                Open a session to see messages. New messages will appear live without reload.
              </div>
            ) : (
              <div className="flex flex-col gap-3 pb-4">
                {messages.map((message) => (
                  <MobileMessageBubble
                    key={
                      message.id ??
                      `${message.role}-${message.timestamp ?? ""}-${message.tool_call_id ?? ""}`
                    }
                    message={message}
                  />
                ))}
              </div>
            )}
          </div>

          <form
            className="shrink-0 border-t border-current/10 bg-background-base px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitComposer();
            }}
          >
            {streamNote && streamStatus === "error" && (
              <div className="mb-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {streamNote}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitComposer();
                  }
                }}
                rows={2}
                placeholder={selectedSessionId ? "Send a message…" : "Select a session first"}
                className={cn(
                  "min-h-[3.5rem] flex-1 resize-none rounded-2xl border border-current/10 bg-muted/20 px-3 py-2 text-sm outline-none transition focus:border-primary/40 focus:bg-background",
                  !selectedSessionId && "opacity-60",
                )}
                disabled={!selectedSessionId || sendBusy}
              />
              <Button type="submit" disabled={sendDisabled} className="self-end rounded-2xl px-4">
                {sendBusy ? <Spinner /> : <Send className="h-4 w-4" />}
                <span className="hidden sm:inline">Send</span>
              </Button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
