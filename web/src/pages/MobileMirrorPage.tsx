import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, ArrowLeft, Bot, RefreshCw, Search, Send } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";

import { AuthWidget } from "@/components/AuthWidget";
import { Markdown } from "@/components/Markdown";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useProfileScope } from "@/contexts/useProfileScope";
import { api, authedFetch, type SessionInfo, type SessionMessage } from "@/lib/api";
import {
  latestMessageId,
  mergeSessionMessages,
  parseSessionStreamEvent,
  sessionDisplayLabel,
  sessionInitials,
  sessionListTitle,
  sessionPreviewText,
  sessionStreamCursor,
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

function AgentHubRow({
  session,
  active,
  onClick,
}: {
  session: SessionInfo;
  active: boolean;
  onClick: () => void;
}) {
  const title = sessionListTitle(session);
  const preview = sessionPreviewText(session);
  const initials = sessionInitials(session);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 border-b border-current/5 px-4 py-3 text-left transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
        aria-hidden
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium text-foreground">
            {title}
          </span>
          <span className="shrink-0 text-[0.7rem] text-text-tertiary">
            {timeAgo(session.last_active)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm text-text-tertiary">{preview}</p>
          {session.is_active ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-label="Live" />
          ) : null}
        </div>
      </div>
    </button>
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
    <div className="mt-2 overflow-hidden rounded-2xl border border-warning/20 bg-warning/5">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-warning hover:bg-warning/10"
        aria-expanded={open}
      >
        <span className="font-mono-ui font-medium">{toolCall.function.name}</span>
        <span className="ml-auto truncate text-warning/50">{toolCall.id}</span>
      </button>
      {open && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-warning/20 px-3 py-2 font-mono text-xs leading-relaxed text-warning/90">
          {args}
        </pre>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: SessionMessage }) {
  if (message.display_kind === "hidden") {
    return null;
  }

  const collapseBody = shouldCollapseMessage(message);
  const body = message.content?.trim() ?? "";
  const bodyPreview = body.length > 900 ? `${body.slice(0, 900).trim()}…` : body;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <article
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : isAssistant ? "justify-start" : "justify-center",
      )}
    >
      <div
        className={cn(
          "max-w-[min(88%,30rem)] rounded-2xl border px-3 py-2 shadow-sm",
          isUser
            ? "rounded-br-md border-primary/20 bg-primary/12"
            : isAssistant
              ? "rounded-bl-md border-border bg-muted/35"
              : "w-full border-warning/20 bg-warning/8",
        )}
      >
        {!isUser && !isAssistant ? (
          <div className="mb-1 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-text-tertiary">
            {message.role}
            {message.tool_name ? ` · ${message.tool_name}` : ""}
          </div>
        ) : null}

        {body ? (
          collapseBody ? (
            <details className="group">
              <summary className="cursor-pointer list-none text-sm text-foreground/90">
                <span className="inline-flex items-center gap-2">
                  <span>Show {message.role} message</span>
                  <span className="max-w-[12rem] truncate text-xs text-text-tertiary">{bodyPreview}</span>
                </span>
              </summary>
              <div className="pt-2">
                <Markdown content={body} />
              </div>
            </details>
          ) : (
            <div className="text-sm leading-relaxed">
              <Markdown content={body} />
            </div>
          )
        ) : (
          <div className="text-sm text-text-tertiary">No text content.</div>
        )}

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {message.tool_calls.map((toolCall) => (
              <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {message.timestamp ? (
          <div
            className={cn(
              "mt-1 text-[0.65rem] text-text-tertiary",
              isUser ? "text-right" : "text-left",
            )}
          >
            {timeAgo(message.timestamp)}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function MobileMirrorPage() {
  const { profile, currentProfile } = useProfileScope();
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionParam = searchParams.get("session") ?? "";
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [hubQuery, setHubQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState(sessionParam);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "live" | "reconnecting" | "error">("idle");
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sendBusy, setSendBusy] = useState(false);

  const selectedSessionRef = useRef(selectedSessionId);
  const resolvedSessionIdRef = useRef("");
  const cursorRef = useRef(0);
  const statusAbortRef = useRef<AbortController | null>(null);
  const streamRunRef = useRef(0);
  const documentTitleRef = useRef(document.title);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const filteredSessions = useMemo(() => {
    const needle = hubQuery.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) => {
      const haystack = [
        sessionListTitle(session),
        sessionPreviewText(session),
        session.id,
        session.source ?? "",
        session.model ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [hubQuery, sessions]);

  const inChat = Boolean(selectedSessionId);

  const statusText = useMemo(() => {
    if (!selectedSessionId) return "Pick an agent to chat";
    if (messagesLoading) return "Loading messages…";
    if (streamStatus === "connecting") return "Connecting…";
    if (streamStatus === "reconnecting") return "Reconnecting…";
    if (streamStatus === "live") return "Live";
    if (streamStatus === "error") return streamNote ?? "Sync unavailable";
    return "Ready";
  }, [messagesLoading, selectedSessionId, streamNote, streamStatus]);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    if (!inChat || messagesLoading) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [inChat, messages, messagesLoading]);

  const applyMessageDelta = useCallback(
    async (sessionId: string, afterId: number, profileName: string) => {
      const next = await api.getSessionMessagesSince(sessionId, afterId, profileName);
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
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(null);

    api
      .getSessions(SESSION_LIMIT, 0, profile || "", "recent")
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
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
  }, [profile]);

  useEffect(() => {
    if (!sessionParam || sessionParam === selectedSessionId) return;
    setSelectedSessionId(sessionParam);
  }, [selectedSessionId, sessionParam]);

  useEffect(() => {
    let cancelled = false;
    const sessionId = selectedSessionId.trim();

    if (!sessionId) {
      resolvedSessionIdRef.current = "";
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
      resolvedSessionIdRef.current = resolvedSessionId;
      setMessagesLoading(false);
      setStreamStatus("live");
      return resolvedSessionId;
    };

    const syncDelta = async (resolvedSessionId: string, afterId: number) => {
      if (cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;
      await applyMessageDelta(resolvedSessionId, afterId, profile || "");
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
  }, [applyMessageDelta, profile, selectedSessionId, setSearchParams]);

  useEffect(() => {
    const title = activeSession
      ? `${sessionDisplayLabel(activeSession)} · Hermes`
      : "Hermes Agent Hub";
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
    },
    [setSearchParams],
  );

  const leaveChat = useCallback(() => {
    setSelectedSessionId("");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("session");
      return next;
    }, { replace: false });
  }, [setSearchParams]);

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
      const result = await api.submitSessionMessage(selectedSessionId, text, profile || "");
      const targetSessionId =
        result.session_id || resolvedSessionIdRef.current || selectedSessionId;
      if (targetSessionId !== selectedSessionRef.current) {
        return;
      }
      await applyMessageDelta(targetSessionId, cursorRef.current, profile || "");
      if (targetSessionId !== selectedSessionId) {
        resolvedSessionIdRef.current = targetSessionId;
        setSelectedSessionId(targetSessionId);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("session", targetSessionId);
          return next;
        }, { replace: true });
      }
      reloadSessions();
    } catch (error) {
      setStreamNote(error instanceof Error ? error.message : String(error));
      setStreamStatus("error");
    } finally {
      setSendBusy(false);
    }
  }, [applyMessageDelta, composer, profile, reloadSessions, sendBusy, selectedSessionId, setSearchParams]);

  const sendDisabled = !composer.trim() || !selectedSessionId || sendBusy;
  const profileLabel =
    currentProfile === profile || !profile ? currentProfile || "default" : profile;

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background-base text-foreground">
      <aside
        className={cn(
          "flex min-h-0 w-full flex-col border-current/10 bg-background-base lg:w-[min(100%,24rem)] lg:border-r",
          inChat && "hidden lg:flex",
        )}
      >
        <header className="shrink-0 border-b border-current/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-foreground">Agent Hub</div>
              <div className="truncate text-xs text-text-tertiary">{profileLabel}</div>
            </div>
            <Button
              ghost
              size="icon"
              onClick={reloadSessions}
              aria-label="Refresh agents"
              title="Refresh agents"
            >
              <RefreshCw className={cn(sessionsLoading && "animate-spin")} />
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-current/10 bg-muted/20 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
            <input
              value={hubQuery}
              onChange={(event) => setHubQuery(event.target.value)}
              placeholder="Search agents"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
              aria-label="Search agents"
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessionsError ? (
            <div className="flex flex-col gap-2 p-4">
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{sessionsError}</span>
              </div>
              <Button outlined size="sm" onClick={reloadSessions} prefix={<RefreshCw />}>
                Retry
              </Button>
            </div>
          ) : sessionsLoading && sessions.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-tertiary">
              <Spinner /> Loading agents…
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-text-tertiary">
              {hubQuery.trim() ? "No agents match your search." : "No agents found for this profile."}
            </div>
          ) : (
            <div>
              {filteredSessions.map((session) => (
                <AgentHubRow
                  key={session.id}
                  session={session}
                  active={session.id === selectedSessionId}
                  onClick={() => pickSession(session.id)}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 space-y-2 border-t border-current/10 px-4 py-3">
          <ProfileSwitcher />
          <AuthWidget />
        </footer>
      </aside>

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_12rem)]",
          !inChat && "hidden lg:flex",
        )}
      >
        {!inChat ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-text-tertiary">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/30 text-foreground/70">
              <Bot className="h-8 w-8" />
            </div>
            <div className="text-lg font-medium text-foreground">Hermes Agent Hub</div>
            <p className="max-w-sm text-sm">
              Pick an agent conversation to mirror live messages from your cloud Hermes backend.
            </p>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-2 border-b border-current/10 px-3 py-2">
              <Button
                ghost
                size="icon"
                onClick={leaveChat}
                aria-label="Back to agents"
                className="lg:hidden"
              >
                <ArrowLeft />
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
                aria-label="Refresh agents"
                title="Refresh agents"
              >
                <RefreshCw className={cn(sessionsLoading && "animate-spin")} />
              </Button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {messagesLoading && messages.length === 0 ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-text-tertiary">
                  <Spinner /> Loading messages…
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-tertiary">
                  Send a message to start this conversation.
                </div>
              ) : (
                <div className="flex flex-col gap-2 pb-4">
                  {messages.map((message) => (
                    <ChatBubble
                      key={
                        message.id ??
                        `${message.role}-${message.timestamp ?? ""}-${message.tool_call_id ?? ""}`
                      }
                      message={message}
                    />
                  ))}
                  <div ref={messagesEndRef} />
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
              <div className="flex items-end gap-2">
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitComposer();
                    }
                  }}
                  rows={1}
                  placeholder="Message"
                  className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-3xl border border-current/10 bg-muted/20 px-4 py-2.5 text-sm outline-none transition focus:border-primary/40 focus:bg-background"
                  disabled={sendBusy}
                />
                <Button
                  type="submit"
                  disabled={sendDisabled}
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-full"
                  aria-label="Send message"
                >
                  {sendBusy ? <Spinner /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
