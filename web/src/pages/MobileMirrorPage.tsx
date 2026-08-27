import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertCircle, Archive, ArrowLeft, Bot, ChevronRight, RefreshCw, Search, Send } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";

import { AuthWidget } from "@/components/AuthWidget";
import { Markdown } from "@/components/Markdown";
import {
  AgentDeliveryNotice,
  AgentDeliveryToolNotice,
} from "@/components/mobile/AgentDeliveryNotice";
import { AgentActivityNotice } from "@/components/mobile/AgentActivityNotice";
import { MobileBotRow } from "@/components/mobile/MobileBotRow";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useProfileScope } from "@/contexts/useProfileScope";
import { useMobileKeyboardInset } from "@/hooks/useMobileKeyboardInset";
import {
  ensureCanonicalChat,
  useMobileBotActivity,
  useMobileBotRoster,
  useMobileHubActivity,
} from "@/hooks/useMobileBotRoster";
import { api, authedFetch, type SessionMessage } from "@/lib/api";
import {
  botRosterMeta,
  displayName,
  formatMobileError,
  isSessionNotFoundError,
  type MobileBotRow as MobileBot,
} from "@/lib/mobile-bot-roster";
import { renderMobileSessionMessages } from "@/lib/mobile-agent-delivery-render";
import { GatewayClient } from "@/lib/gatewayClient";
import {
  latestMessageId,
  mergeSessionMessages,
  parseSessionStreamEvent,
  sessionStreamCursor,
  shouldCollapseMessage,
  shouldShowThinkingIndicator,
  type SessionStreamEvent,
} from "@/lib/mobile-session-sync";
import { cn, timeAgo } from "@/lib/utils";

const STREAM_RETRY_BASE_MS = 1_000;
const STREAM_RETRY_MAX_MS = 12_000;

type HubView = "active" | "archived";

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
        if (event) yield event;
        splitIndex = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function ThinkingBubble() {
  return (
    <article className="flex w-full justify-start">
      <div className="rounded-2xl rounded-bl-md border border-border bg-muted/35 px-4 py-3 text-sm text-text-tertiary">
        <span className="inline-flex items-center gap-1" aria-label="Agent is thinking">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
        </span>
      </div>
    </article>
  );
}

function ChatBubble({ message }: { message: SessionMessage }) {
  if (message.display_kind === "hidden") return null;

  const collapseBody = shouldCollapseMessage(message);
  const body = message.content?.trim() ?? "";
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <article className={cn("flex w-full", isUser ? "justify-end" : isAssistant ? "justify-start" : "justify-center")}>
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
                Show {message.role} message
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
        {message.timestamp ? (
          <div className={cn("mt-1 text-[0.65rem] text-text-tertiary", isUser ? "text-right" : "text-left")}>
            {timeAgo(message.timestamp)}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function MobileMirrorPage() {
  const { profile, currentProfile, setProfile } = useProfileScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const gatewayRef = useRef<GatewayClient | null>(null);
  if (!gatewayRef.current) {
    gatewayRef.current = new GatewayClient();
  }
  const gateway = gatewayRef.current;

  const sessionParam = searchParams.get("session") ?? "";
  const [hubView, setHubView] = useState<HubView>("active");
  const [hubQuery, setHubQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState(sessionParam);
  const [selectedBotName, setSelectedBotName] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "live" | "reconnecting" | "error">("idle");
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const [chatLoadFailed, setChatLoadFailed] = useState(false);
  const [composer, setComposer] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [openingBot, setOpeningBot] = useState<string | null>(null);
  const [hubOpenError, setHubOpenError] = useState<string | null>(null);

  const {
    allBots,
    bots,
    hiddenBots,
    rosterIncomplete,
    defaultOnlyWarning,
    loading: botsLoading,
    error: botsError,
    avatars,
    refresh: refreshBots,
    bumpBotFromMessages,
  } = useMobileBotRoster(gateway);
  const { busyBots, activityLabels } = useMobileHubActivity(gateway);
  const keyboardInset = useMobileKeyboardInset();

  const selectedSessionRef = useRef(selectedSessionId);
  const selectedBotRef = useRef(selectedBotName);
  const resolvedSessionIdRef = useRef("");
  const cursorRef = useRef(0);
  const streamRunRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const rosterForDelivery = allBots.length > 0 ? allBots : bots;

  const activeBot = useMemo(() => {
    if (selectedBotName) {
      return rosterForDelivery.find((bot) => bot.name === selectedBotName) ?? null;
    }
    if (!selectedSessionId) return null;
    return (
      rosterForDelivery.find((bot) => {
        const canonical = bot.canonical_session?.resolved_id || bot.canonical_session?.id;
        return canonical === selectedSessionId || bot.canonical_session?.id === selectedSessionId;
      }) ?? null
    );
  }, [bots, rosterForDelivery, selectedBotName, selectedSessionId]);

  const scopedProfile = activeBot
    ? activeBot.name === "default"
      ? ""
      : activeBot.name
    : profile;

  const { busy: gatewayBusy, activities, latestActivityLabel } = useMobileBotActivity(
    gateway,
    selectedSessionId,
    scopedProfile || "",
  );

  const renderedMessages = useMemo(() => renderMobileSessionMessages(messages), [messages]);

  const hubBots = hubView === "archived" ? hiddenBots : bots;

  const filteredBots = useMemo(() => {
    const needle = hubQuery.trim().toLowerCase();
    if (!needle) return hubBots;
    return hubBots.filter((bot) => {
      const meta = botRosterMeta(bot);
      const haystack = [displayName(bot, meta), bot.name, botHandleForSearch(bot), bot.description ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [hubBots, hubQuery]);

  const inChat = Boolean(selectedSessionId);

  const statusText = useMemo(() => {
    if (!selectedSessionId) return "Pick an agent";
    if (chatLoadFailed) return "Chat unavailable";
    if (messagesLoading) return "Loading messages…";
    if (gatewayBusy) return latestActivityLabel || "Working…";
    if (streamStatus === "connecting") return "Connecting…";
    if (streamStatus === "reconnecting") return "Reconnecting…";
    if (streamStatus === "live") return "Live";
    if (streamStatus === "error") return streamNote ?? "Sync unavailable";
    return "Ready";
  }, [chatLoadFailed, gatewayBusy, latestActivityLabel, messagesLoading, selectedSessionId, streamNote, streamStatus]);

  const showThinking = useMemo(
    () =>
      !chatLoadFailed &&
      shouldShowThinkingIndicator(messages, awaitingReply || gatewayBusy, streamStatus === "live"),
    [awaitingReply, chatLoadFailed, gatewayBusy, messages, streamStatus],
  );

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    selectedBotRef.current = selectedBotName;
  }, [selectedBotName]);

  useEffect(() => {
    if (!inChat || messagesLoading) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activities, inChat, messages, messagesLoading, showThinking]);

  const applyMessageDelta = useCallback(async (sessionId: string, afterId: number, profileName: string) => {
    const next = await api.getSessionMessagesSince(
      sessionId,
      afterId,
      profileName,
      cursorRef.current || undefined,
    );
    if (next.unchanged) {
      const revision = next.latest_message_id ?? next.revision ?? cursorRef.current;
      if (revision > cursorRef.current) cursorRef.current = revision;
      return;
    }
    const incoming = next.messages ?? [];
    if (incoming.length === 0) {
      const revision = next.latest_message_id ?? next.revision ?? afterId;
      if (revision > cursorRef.current) cursorRef.current = revision;
      return;
    }
    let mergedMessages: SessionMessage[] | null = null;
    setMessages((prev) => {
      mergedMessages = mergeSessionMessages(prev, incoming);
      cursorRef.current = latestMessageId(mergedMessages);
      if (incoming.some((message) => message.role === "assistant")) {
        setAwaitingReply(false);
      }
      return mergedMessages;
    });
    if (mergedMessages) {
      bumpBotFromMessages(profileName.trim() || "default", mergedMessages);
    }
  }, [bumpBotFromMessages]);

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
      setChatLoadFailed(false);
      setAwaitingReply(false);
      cursorRef.current = 0;
      return;
    }

    const controller = new AbortController();
    const runId = ++streamRunRef.current;
    setMessagesLoading(true);
    setStreamNote(null);
    setChatLoadFailed(false);
    setStreamStatus("connecting");
    cursorRef.current = 0;
    setMessages([]);

    const loadInitial = async (attemptSessionId: string, repaired = false): Promise<string | undefined> => {
      try {
        const response = await api.getSessionMessages(attemptSessionId, scopedProfile || "");
        if (cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;

        const resolvedSessionId = response.session_id || attemptSessionId;
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
      } catch (error) {
        if (cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;

        if (!repaired && isSessionNotFoundError(error) && selectedBotRef.current) {
          try {
            const repairedId = await ensureCanonicalChat(gateway, selectedBotRef.current);
            if (repairedId && repairedId !== attemptSessionId) {
              setSelectedSessionId(repairedId);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set("session", repairedId);
                return next;
              }, { replace: true });
              await refreshBots();
              return loadInitial(repairedId, true);
            }
          } catch {
            /* fall through to friendly error */
          }
        }

        setMessagesLoading(false);
        setStreamStatus("error");
        setChatLoadFailed(true);
        setStreamNote(formatMobileError(error));
        return undefined;
      }
    };

    const syncDelta = async (resolvedSessionId: string, afterId: number) => {
      if (cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;
      await applyMessageDelta(resolvedSessionId, afterId, scopedProfile || "");
    };

    const catchUpFromEvent = async (event: SessionStreamEvent, resolvedSessionId: string) => {
      const watermark = sessionStreamCursor(event, cursorRef.current);
      if (watermark <= cursorRef.current) return;
      await syncDelta(resolvedSessionId, cursorRef.current);
    };

    const runStream = async (resolvedSessionId: string) => {
      let attempt = 0;
      while (!controller.signal.aborted && streamRunRef.current === runId) {
        const streamUrl = api.getSessionEventsUrl(resolvedSessionId, scopedProfile || "", cursorRef.current);
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
            if (event.type === "hello" || event.type === "message.appended") {
              await catchUpFromEvent(event, resolvedSessionId);
            }
          }
          if (controller.signal.aborted || streamRunRef.current !== runId) return;
          attempt = 0;
        } catch (error) {
          if (controller.signal.aborted || streamRunRef.current !== runId) return;
          setStreamNote(formatMobileError(error));
          setStreamStatus("reconnecting");
          await sleep(streamRetryDelay(attempt++));
        }
      }
    };

    void loadInitial(sessionId)
      .then((resolved) => {
        if (!resolved || cancelled || controller.signal.aborted || streamRunRef.current !== runId) return;
        void runStream(resolved);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applyMessageDelta, gateway, refreshBots, scopedProfile, selectedSessionId, setSearchParams]);

  const openBot = useCallback(
    async (bot: MobileBot) => {
      setOpeningBot(bot.name);
      setChatLoadFailed(false);
      setStreamNote(null);
      setHubOpenError(null);
      try {
        const profileName = bot.name === "default" ? "" : bot.name;
        setProfile(profileName);
        setSelectedBotName(bot.name);
        if (gateway.connectionState !== "open") {
          await gateway.connect();
        }
        // Always adopt/create canonical Bot Chat by profile name — repairs stale pointers.
        const sessionId = await ensureCanonicalChat(gateway, bot.name);
        await refreshBots();
        setSelectedSessionId(sessionId);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("session", sessionId);
          if (profileName) next.set("profile", profileName);
          else next.delete("profile");
          return next;
        }, { replace: false });
      } catch (error) {
        const friendly = formatMobileError(error);
        setChatLoadFailed(true);
        setStreamNote(friendly);
        setHubOpenError(friendly);
        setStreamStatus("error");
        setSelectedBotName(null);
        // Do not leave a stale session id that would fetch messages and paint raw 404s.
        setSelectedSessionId("");
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("session");
          return next;
        }, { replace: true });
      } finally {
        setOpeningBot(null);
      }
    },
    [gateway, refreshBots, setProfile, setSearchParams],
  );

  const leaveChat = useCallback(() => {
    setSelectedSessionId("");
    setSelectedBotName(null);
    setChatLoadFailed(false);
    setStreamNote(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("session");
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  const submitComposer = useCallback(async () => {
    const text = composer.trim();
    if (!text || !selectedSessionId || sendBusy || chatLoadFailed) return;
    setSendBusy(true);
    setAwaitingReply(true);
    try {
      setComposer("");
      const result = await api.submitSessionMessage(selectedSessionId, text, scopedProfile || "");
      const targetSessionId = result.session_id || resolvedSessionIdRef.current || selectedSessionId;
      if (targetSessionId !== selectedSessionRef.current) {
        setAwaitingReply(false);
        return;
      }
      await applyMessageDelta(targetSessionId, cursorRef.current, scopedProfile || "");
      if (targetSessionId !== selectedSessionId) {
        resolvedSessionIdRef.current = targetSessionId;
        setSelectedSessionId(targetSessionId);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("session", targetSessionId);
          return next;
        }, { replace: true });
      }
      void refreshBots();
    } catch (error) {
      setAwaitingReply(false);
      setStreamNote(formatMobileError(error));
      setStreamStatus("error");
    } finally {
      setSendBusy(false);
    }
  }, [applyMessageDelta, chatLoadFailed, composer, refreshBots, scopedProfile, sendBusy, selectedSessionId, setSearchParams]);

  const sendDisabled = !composer.trim() || !selectedSessionId || sendBusy || chatLoadFailed;
  const profileLabel = currentProfile === profile || !profile ? currentProfile || "default" : profile;
  const chatTitle = activeBot ? displayName(activeBot, botRosterMeta(activeBot)) : "Agent";

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background-base text-foreground">
      <aside className={cn("flex min-h-0 w-full flex-col border-current/10 bg-background-base lg:w-[min(100%,24rem)] lg:border-r", inChat && "hidden lg:flex")}>
        <header className="shrink-0 border-b border-current/10 px-4 py-3">
          <div className="flex items-center gap-2">
            {hubView === "archived" ? (
              <Button ghost size="icon" onClick={() => setHubView("active")} aria-label="Back to active agents">
                <ArrowLeft />
              </Button>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Bot className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-foreground">
                {hubView === "archived" ? "Archived" : "Agent Hub"}
              </div>
              <div className="truncate text-xs text-text-tertiary">
                {hubView === "archived"
                  ? `${hiddenBots.length} archived agent${hiddenBots.length === 1 ? "" : "s"}`
                  : `Bot Mode · ${profileLabel}`}
              </div>
            </div>
            <Button ghost size="icon" onClick={() => void refreshBots()} aria-label="Refresh agents">
              <RefreshCw className={cn(botsLoading && "animate-spin")} />
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-current/10 bg-muted/20 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
            <input
              value={hubQuery}
              onChange={(event) => setHubQuery(event.target.value)}
              placeholder={hubView === "archived" ? "Search archived" : "Search agents"}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
              aria-label="Search agents"
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {botsError ? (
            <div className="flex flex-col gap-2 p-4">
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formatMobileError(botsError)}</span>
              </div>
              <Button outlined size="sm" onClick={() => void refreshBots()} prefix={<RefreshCw />}>
                Retry
              </Button>
            </div>
          ) : botsLoading && allBots.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-tertiary">
              <Spinner /> Loading agents…
            </div>
          ) : hubView === "active" && rosterIncomplete ? (
            <div className="flex flex-col gap-2 p-4">
              <div className="flex items-start gap-2 rounded-2xl border border-warning/20 bg-warning/5 p-3 text-sm text-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <div className="font-medium text-foreground">Roster sync needed</div>
                  <p>
                    Could not load the desktop Bot Mode agent list. Only a hidden/default
                    profile is available — this is not your full agent hub. Retry, or open
                    Archived for hidden agents.
                  </p>
                </div>
              </div>
              <Button outlined size="sm" onClick={() => void refreshBots()} prefix={<RefreshCw />}>
                Retry
              </Button>
            </div>
          ) : filteredBots.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-text-tertiary">
              {hubQuery.trim()
                ? "No agents match your search."
                : hubView === "archived"
                  ? "No archived agents."
                  : "No active agents found"}
            </div>
          ) : (
            <>
              {hubView === "active" && defaultOnlyWarning ? (
                <div className="flex items-start gap-2 border-b border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium text-foreground">Roster may be incomplete</div>
                    <p>
                      Only the default Hermes profile was returned. Desktop Bot Mode agents
                      (for example @boss-bot, @dev) are missing — tap Retry before treating
                      this as your hub.
                    </p>
                    <Button
                      outlined
                      size="sm"
                      className="mt-1"
                      onClick={() => void refreshBots()}
                      prefix={<RefreshCw />}
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              ) : null}
              {filteredBots.map((bot) => (
                <MobileBotRow
                  key={bot.name}
                  bot={bot}
                  active={bot.name === activeBot?.name}
                  archived={hubView === "archived"}
                  avatarUrl={avatars[bot.name]}
                  activeProfile={bot.name}
                  busyBotName={busyBots[bot.name] ? bot.name : null}
                  activityLabel={activityLabels[bot.name] ?? null}
                  onClick={() => void openBot(bot)}
                />
              ))}
            </>
          )}

          {hubView === "active" && hiddenBots.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setHubQuery("");
                setHubView("archived");
              }}
              className="flex w-full items-center gap-3 border-b border-current/5 px-4 py-3 text-left transition-colors hover:bg-muted/30"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40 text-text-tertiary">
                <Archive className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[0.95rem] font-medium text-foreground">
                  Archived ({hiddenBots.length})
                </div>
                <div className="text-sm text-text-tertiary">
                  {hiddenBots.length} hidden agent{hiddenBots.length === 1 ? "" : "s"}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
            </button>
          ) : null}

          {openingBot ? (
            <div className="px-4 py-2 text-xs text-text-tertiary">
              Opening {openingBot}…
            </div>
          ) : null}

          {hubOpenError ? (
            <div className="m-4 flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{hubOpenError}</span>
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 space-y-2 border-t border-current/10 px-4 py-3">
          <ProfileSwitcher />
          <AuthWidget />
        </footer>
      </aside>

      <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !inChat && "hidden lg:flex")}>
        {!inChat ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-text-tertiary">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/30 text-foreground/70">
              <Bot className="h-8 w-8" />
            </div>
            <div className="text-lg font-medium text-foreground">Hermes Agent Hub</div>
            <p className="max-w-sm text-sm">Tap an agent to open its canonical Bot Chat live feed.</p>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-2 border-b border-current/10 px-3 py-2">
              <Button ghost size="icon" onClick={leaveChat} aria-label="Back to agents" className="lg:hidden">
                <ArrowLeft />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{chatTitle}</div>
                <div className="truncate text-[0.7rem] text-text-tertiary">{statusText}</div>
              </div>
              <Button ghost size="icon" onClick={() => void refreshBots()} aria-label="Refresh agents">
                <RefreshCw className={cn(botsLoading && "animate-spin")} />
              </Button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {messagesLoading && messages.length === 0 && !chatLoadFailed ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-text-tertiary">
                  <Spinner /> Loading messages…
                </div>
              ) : chatLoadFailed && messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="text-sm text-destructive">{streamNote}</p>
                  <Button
                    outlined
                    size="sm"
                    onClick={() => {
                      if (activeBot) void openBot(activeBot);
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 pb-4">
                  {renderedMessages.map((item) => {
                    if (item.kind === "agent-receive") {
                      return (
                        <AgentDeliveryNotice
                          key={item.key}
                          sender={item.parsed.sender}
                          handle={item.parsed.handle}
                          body={item.parsed.body}
                          gateway={gateway}
                          rosterAvatars={avatars}
                          bots={rosterForDelivery}
                        />
                      );
                    }
                    if (item.kind === "agent-send") {
                      return (
                        <AgentDeliveryToolNotice
                          key={item.key}
                          target={item.delivery.target}
                          pending={item.delivery.pending}
                          replyBody={item.delivery.replyBody}
                          gateway={gateway}
                          rosterAvatars={avatars}
                          bots={rosterForDelivery}
                        />
                      );
                    }
                    if (item.kind === "activity-notice") {
                      return (
                        <AgentActivityNotice
                          key={item.key}
                          label={item.label}
                          pending={item.pending}
                        />
                      );
                    }
                    return <ChatBubble key={item.key} message={item.message} />;
                  })}
                  {activities.map((item) => (
                    <AgentActivityNotice key={item.id} label={item.label} pending={item.pending} />
                  ))}
                  {showThinking ? <ThinkingBubble /> : null}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <form
              className="shrink-0 border-t border-current/10 bg-background-base px-3 py-3"
              style={{
                paddingBottom: `max(0.75rem, calc(0.75rem + env(safe-area-inset-bottom, 0px) + ${keyboardInset}px))`,
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void submitComposer();
              }}
            >
              {streamNote && (streamStatus === "error" || chatLoadFailed) ? (
                <div className="mb-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {streamNote}
                </div>
              ) : null}
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
                  placeholder={chatLoadFailed ? "Chat unavailable" : "Message"}
                  className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-3xl border border-current/10 bg-muted/20 px-4 py-2.5 text-sm outline-none transition focus:border-primary/40 focus:bg-background disabled:opacity-50"
                  disabled={sendBusy || chatLoadFailed}
                />
                <Button type="submit" disabled={sendDisabled} size="icon" className="h-11 w-11 shrink-0 rounded-full" aria-label="Send message">
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

function botHandleForSearch(bot: MobileBot): string {
  return bot.name === "default" ? "hermes" : bot.name;
}
