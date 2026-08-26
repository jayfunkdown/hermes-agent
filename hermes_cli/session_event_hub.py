"""Per-session SSE fanout for dashboard message-sync clients.

Cross-process writers (messaging gateway, cron, another dashboard) append to
``state.db`` without touching this process. A lightweight watcher polls the
shared store's revision watermark for each subscribed session and pushes
``message.appended`` events to connected SSE clients.

Same-process appends can call :func:`notify_session_revision` for immediate
delivery; the watcher remains the backstop for external writes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, DefaultDict, Dict, List, Optional, Set, Tuple

_log = logging.getLogger("hermes_cli.session_event_hub")

ProfileKey = Optional[str]
SessionKey = Tuple[ProfileKey, str]

# Per-session subscriber cap — enough for phone + desktop + a few tabs.
_MAX_SUBSCRIBERS_PER_SESSION = 16

# Watcher cadence mirrors the gateway ``sessions.changed`` probe (0.5s).
_WATCH_INTERVAL_S = 0.5

# SSE keepalive when idle.
_PING_INTERVAL_S = 25.0


@dataclass
class _Subscription:
    queue: asyncio.Queue
    after_id: int = 0


@dataclass
class SessionEventHub:
    """In-process SSE hub keyed by (profile, session_id)."""

    revision_reader: Callable[[ProfileKey, str], Awaitable[int]]
    _subs: DefaultDict[SessionKey, List[_Subscription]] = field(
        default_factory=lambda: defaultdict(list)
    )
    _last_revision: Dict[SessionKey, int] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _watcher_task: Optional[asyncio.Task] = field(default=None, repr=False)
    _stopped: bool = False

    async def start(self) -> None:
        if self._watcher_task is not None:
            return
        self._stopped = False
        self._watcher_task = asyncio.create_task(self._watch_loop(), name="session-event-hub")

    async def stop(self) -> None:
        self._stopped = True
        if self._watcher_task is not None:
            self._watcher_task.cancel()
            try:
                await self._watcher_task
            except asyncio.CancelledError:
                pass
            self._watcher_task = None
        async with self._lock:
            self._subs.clear()
            self._last_revision.clear()

    async def subscribe(
        self,
        profile: ProfileKey,
        session_id: str,
        *,
        after_id: int = 0,
    ) -> Tuple[asyncio.Queue, bool]:
        """Register a subscriber queue. Returns (queue, admitted)."""
        key = (profile, session_id)
        async with self._lock:
            existing = self._subs[key]
            if len(existing) >= _MAX_SUBSCRIBERS_PER_SESSION:
                return asyncio.Queue(maxsize=1), False
            sub = _Subscription(queue=asyncio.Queue(maxsize=64), after_id=max(0, after_id))
            existing.append(sub)
            return sub.queue, True

    async def unsubscribe(self, profile: ProfileKey, session_id: str, queue: asyncio.Queue) -> None:
        key = (profile, session_id)
        async with self._lock:
            subs = self._subs.get(key)
            if not subs:
                return
            self._subs[key] = [s for s in subs if s.queue is not queue]
            if not self._subs[key]:
                self._subs.pop(key, None)
                self._last_revision.pop(key, None)

    async def notify_session_revision(
        self,
        profile: ProfileKey,
        session_id: str,
        revision: int,
        *,
        message_ids: Optional[List[int]] = None,
    ) -> None:
        """Fast-path notify after a same-process append."""
        await self._emit(profile, session_id, revision, message_ids=message_ids)

    async def _watch_loop(self) -> None:
        while not self._stopped:
            try:
                await self._poll_once()
            except Exception:  # noqa: BLE001
                _log.exception("session event hub poll failed")
            await asyncio.sleep(_WATCH_INTERVAL_S)

    async def _poll_once(self) -> None:
        async with self._lock:
            keys = list(self._subs.keys())
        for profile, session_id in keys:
            if not self._subs.get((profile, session_id)):
                continue
            try:
                revision = await self.revision_reader(profile, session_id)
            except Exception:  # noqa: BLE001
                _log.debug("revision read failed for %s/%s", profile, session_id, exc_info=True)
                continue
            last = self._last_revision.get((profile, session_id))
            if last is None:
                self._last_revision[(profile, session_id)] = revision
                continue
            if revision > last:
                await self._emit(profile, session_id, revision)

    async def _emit(
        self,
        profile: ProfileKey,
        session_id: str,
        revision: int,
        *,
        message_ids: Optional[List[int]] = None,
    ) -> None:
        key = (profile, session_id)
        prev = self._last_revision.get(key, 0)
        if revision <= prev and message_ids is None:
            return
        self._last_revision[key] = max(revision, prev)
        event = {
            "type": "message.appended",
            "session_id": session_id,
            "revision": revision,
            "latest_message_id": revision,
        }
        if message_ids:
            event["message_ids"] = message_ids
        if profile:
            event["profile"] = profile
        async with self._lock:
            subs = list(self._subs.get(key, []))
        for sub in subs:
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                _log.debug("dropping session event for slow subscriber %s", session_id)

    async def stream_events(
        self,
        profile: ProfileKey,
        session_id: str,
        *,
        after_id: int = 0,
        initial_revision: int = 0,
    ):
        """Async generator of SSE ``data:`` payloads (without the ``data:`` prefix)."""
        queue, admitted = await self.subscribe(profile, session_id, after_id=after_id)
        if not admitted:
            yield json.dumps({"type": "error", "code": "rate_limited", "detail": "too many subscribers"})
            return

        hello = {
            "type": "hello",
            "session_id": session_id,
            "revision": initial_revision,
            "latest_message_id": initial_revision,
            "after_id": after_id,
        }
        if profile:
            hello["profile"] = profile
        yield json.dumps(hello)

        # Seed watcher baseline so the first external append fires.
        self._last_revision[(profile, session_id)] = initial_revision

        last_ping = time.monotonic()
        try:
            while True:
                timeout = max(0.1, _PING_INTERVAL_S - (time.monotonic() - last_ping))
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=timeout)
                    yield json.dumps(event)
                except asyncio.TimeoutError:
                    last_ping = time.monotonic()
                    yield json.dumps({"type": "ping", "ts": time.time()})
        finally:
            await self.unsubscribe(profile, session_id, queue)


_hub: Optional[SessionEventHub] = None


def get_session_event_hub() -> Optional[SessionEventHub]:
    return _hub


def set_session_event_hub(hub: Optional[SessionEventHub]) -> None:
    global _hub
    _hub = hub
