"""Async facade for the same bounded synchronous transport and API contracts."""

import asyncio
import functools
import json
import threading

from . import APIResponse, Client, KovaError, _json_body, response_events, chat_completion_events


class AsyncRequestCancelled(asyncio.CancelledError):
    """A canceled wait is not evidence that a submitted operation was canceled."""

    def __init__(self, request_may_have_started=False, mutation_may_have_started=False):
        super().__init__("request_canceled")
        self.request_may_have_started = request_may_have_started
        self.mutation_may_have_started = mutation_may_have_started


async def _invoke(fn, *, paid=False, mutation=False, cleanup=None):
    # Shield the worker future, not the calling coroutine. A canceled waiter
    # returns immediately; an abandoned response is closed when the worker exits.
    abandoned = threading.Event()

    def dispose(value):
        try:
            if isinstance(value, APIResponse):
                value.close()
            if cleanup is not None:
                cleanup()
        except Exception:
            # An abandoned transport cannot replace the caller cancellation.
            pass

    def work():
        result = None
        try:
            if not abandoned.is_set():
                result = fn()
            return result
        finally:
            if abandoned.is_set():
                dispose(result)

    task = asyncio.create_task(asyncio.to_thread(work))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        abandoned.set()
        # The worker can finish immediately before the abandonment flag is set.
        # Consume its outcome and close any response in that race as well.
        def finish(done):
            if done.cancelled():
                return
            try:
                result = done.result()
            except BaseException:
                result = None
            dispose(result)
        task.add_done_callback(finish)
        raise AsyncRequestCancelled(paid, mutation) from None


class AsyncAPIResponse:
    """Own one response and consume it once, via JSON or an async SSE iterator."""

    def __init__(self, response):
        self._response = response
        self.status = response.status
        self.content_type = response.content_type
        self._claimed = False
        self._busy = False
        self._abandoned = False

    @property
    def closed(self):
        return self._abandoned or self._response.closed

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()

    def _claim(self):
        if self.closed or self._claimed:
            raise KovaError("response_closed")
        self._claimed = True

    async def _consume(self, fn):
        if self.closed or self._busy:
            raise KovaError("response_closed" if self.closed else "response_in_use")
        self._busy = True
        try:
            return await _invoke(fn, paid=self._response._paid, cleanup=self._response.close)
        except AsyncRequestCancelled:
            self._abandoned = True
            raise
        finally:
            self._busy = False

    async def json(self, maximum_bytes=16 * 1024 * 1024):
        self._claim()
        try:
            return await self._consume(lambda: self._response.json(maximum_bytes))
        finally:
            await self.close()

    async def close(self):
        if self.closed:
            return
        if self._busy:
            raise KovaError("response_in_use")
        await self._consume(self._response.close)


async def _events(response, maximum_event_bytes, parser):
    response._claim()
    iterator = parser(response._response, maximum_event_bytes=maximum_event_bytes)
    end = object()
    try:
        while True:
            event = await response._consume(lambda: next(iterator, end))
            if event is end:
                return
            yield event
    finally:
        await response.close()


def async_response_events(response, *, maximum_event_bytes=1048576):
    return _events(response, maximum_event_bytes, response_events)


def async_chat_completion_events(response, *, maximum_event_bytes=1048576):
    return _events(response, maximum_event_bytes, chat_completion_events)


def _snapshot(value):
    # Resource methods use the same JSON encodings and validation as Client.
    # Copy the input before the first await so a caller cannot change queued work.
    return json.loads(_json_body(value, 1048576)) if isinstance(value, dict) else value


class AsyncClient:
    """Dependency-free asyncio client; never retries or bypasses a signed budget."""

    def __init__(self, api_key, *, base_url="https://kovagpt.com", timeout=60):
        self._client = Client(api_key, base_url=base_url, timeout=timeout)

    async def quote(self, operation, data):
        snapshot = _snapshot(data)
        return await _invoke(lambda: self._client.quote(operation, snapshot))

    async def execute(self, operation, data, *, quote, currency, maximum_charge, idempotency_key):
        snapshot, accepted = _snapshot(data), _snapshot(quote)
        response = await _invoke(lambda: self._client.execute(
            operation, snapshot, quote=accepted, currency=currency,
            maximum_charge=maximum_charge, idempotency_key=idempotency_key), paid=True, mutation=True)
        return AsyncAPIResponse(response)

    async def run(self, operation, data, *, currency, maximum_charge, idempotency_key):
        self._client._budget(currency, maximum_charge, idempotency_key)
        limit = 1048576 if operation == "audio/transcriptions" else 65536
        snapshot = json.loads(_json_body(data, limit))
        # Separate awaits are essential: canceling during a quote must not later
        # advance into paid execution in the background thread.
        quote = await self.quote(operation, snapshot)
        return await self.execute(operation, snapshot, quote=quote, currency=currency,
                                  maximum_charge=maximum_charge, idempotency_key=idempotency_key)

    async def image_edit(self, data, **budget):
        if not (isinstance(data, dict) and isinstance(data.get("image"), str)
                and data["image"].startswith("data:image/png;base64,")):
            raise KovaError("image_required")
        return await self.run("images", data, **budget)


# Explicit method lists preserve the public API boundary. No forwarding of
# arbitrary or private Client attributes; the regression test checks parity.
_READS = (
    "models", "usage_list", "usage_retrieve", "file_search", "file_list", "file_retrieve",
    "conversation_list", "conversation_retrieve", "conversation_item", "vector_search",
    "vector_list", "vector_retrieve", "vector_entries", "vector_entry", "agent_list",
    "agent_retrieve", "skill_list", "skill_retrieve", "webhook_list", "webhook_retrieve",
    "webhook_deliveries", "batch_list", "batch_retrieve", "batch_item", "response_job_list",
    "response_job_retrieve", "automation_list", "automation_retrieve", "automation_item",
)
_MUTATIONS = (
    "file_delete", "file_upload", "file_upload_multipart", "conversation_create",
    "conversation_append", "conversation_remove", "conversation_delete", "vector_create",
    "vector_upsert", "vector_delete", "agent_create", "agent_update", "agent_delete",
    "skill_create", "skill_update", "skill_delete", "webhook_create", "webhook_rotate",
    "webhook_test", "webhook_delete", "batch_cancel", "response_job_cancel",
    "automation_cancel", "automation_pause",
)
_PAID_MUTATIONS = ("batch_create", "response_job_create", "automation_create", "automation_resume")
_INFERENCE = {
    "responses": "responses", "chat_completions": "chat/completions", "search": "search",
    "images": "images", "embeddings": "embeddings", "agent_turn": "agent-turns",
    "browser_snapshot": "browser", "computer_use": "computer-use", "analysis": "analysis",
    "decisions": "decisions", "transcriptions": "audio/transcriptions", "moderations": "moderations",
}


def _resource_method(name, *, paid=False, mutation=False):
    @functools.wraps(getattr(Client, name))
    async def invoke(self, *args, **kwargs):
        values = tuple(_snapshot(value) for value in args)
        options = {key: _snapshot(value) for key, value in kwargs.items()}
        return await _invoke(lambda: getattr(self._client, name)(*values, **options),
                             paid=paid, mutation=mutation)
    return invoke


def _inference_method(name, operation):
    @functools.wraps(getattr(Client, name))
    async def invoke(self, data, **budget):
        return await self.run(operation, data, **budget)
    return invoke


for _name in _READS:
    setattr(AsyncClient, _name, _resource_method(_name))
for _name in _MUTATIONS:
    setattr(AsyncClient, _name, _resource_method(_name, mutation=True))
for _name in _PAID_MUTATIONS:
    setattr(AsyncClient, _name, _resource_method(_name, paid=True, mutation=True))
for _name, _operation in _INFERENCE.items():
    setattr(AsyncClient, _name, _inference_method(_name, _operation))
