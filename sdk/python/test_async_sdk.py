import asyncio
import inspect
import json
import threading
import unittest
from unittest.mock import patch

from kovagpt import (
    AsyncClient, AsyncRequestCancelled, Client, KovaError,
    async_response_events, async_chat_completion_events,
)
from test_sdk import BUDGET, DATA, ID, KEY, FakeResponse, quote


class AsyncSDKTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.calls, self.responses, self.connections = [], [], []
        test = self

        class Connection:
            def __init__(self, host, port, timeout):
                self.closed = threading.Event()
                test.connections.append(self)

            def request(self, method, path, body, headers):
                test.calls.append((method, path, body, headers))

            def getresponse(self):
                value = test.responses.pop(0)
                return value() if callable(value) else value

            def close(self):
                self.closed.set()

        self.mock = patch("http.client.HTTPSConnection", Connection)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.client = AsyncClient(KEY)

    async def test_throttle_delay_is_exposed_without_retry(self):
        self.responses.append(FakeResponse({"error": {"code": "developer_rate_limit"}}, status=429, retry_after="60"))
        with self.assertRaises(KovaError) as failure:
            await self.client.models()
        self.assertEqual(failure.exception.retry_after, 60)
        self.assertEqual(len(self.calls), 1)

    async def test_resumable_upload_resource(self):
        self.responses.extend([FakeResponse({"id": ID}), FakeResponse({"id": ID})])
        await self.client.upload_append({"id": ID, "offset": 0, "data": "YQ=="})
        await self.client.upload_complete(ID)
        self.assertEqual([json.loads(c[2])["operation"] for c in self.calls], ["append", "complete"])
        self.assertTrue(all(c.closed.is_set() for c in self.connections))

    async def test_saved_prompt_resource(self):
        definition = {"name": "Example", "description": "Saved text", "prompt": "Summarize"}
        self.responses.extend([FakeResponse({"id": ID}), FakeResponse({"id": ID})])
        await self.client.prompt_create({"id": ID, "definition": definition})
        await self.client.prompt_retrieve(ID, version=1)
        self.assertEqual(self.calls[0][0], "POST")
        self.assertTrue(self.calls[1][1].endswith("/prompts?id=" + ID + "&version=1"))
        self.assertTrue(all(c.closed.is_set() for c in self.connections))

    async def test_public_method_parity(self):
        public = lambda cls: {name for name, value in inspect.getmembers(cls, inspect.isfunction)
                              if not name.startswith("_")}
        self.assertEqual(public(AsyncClient), public(Client))
        self.assertTrue(all(inspect.iscoroutinefunction(getattr(AsyncClient, name))
                            for name in public(Client)))

    async def test_budgeted_execution_and_scoped_resource(self):
        self.responses.extend([FakeResponse(quote()), FakeResponse({"ok": True}), FakeResponse({"id": ID})])
        async with await self.client.responses(DATA, **BUDGET) as response:
            self.assertEqual(await response.json(), {"ok": True})
        self.assertEqual(await self.client.file_retrieve(ID), {"id": ID})
        self.assertEqual(json.loads(self.calls[0][2])["input"], json.loads(self.calls[1][2]))
        self.assertEqual(self.calls[1][3]["Idempotency-Key"], "stable")
        self.assertEqual(self.calls[2][0], "GET")
        self.assertTrue(all(c.closed.is_set() for c in self.connections))
        with self.assertRaisesRegex(KovaError, "budget_required"):
            await self.client.responses(DATA, **{**BUDGET, "maximum_charge": True})
        self.assertEqual(len(self.calls), 3)

    async def test_native_and_compatible_streams_and_truncation(self):
        native = b'data: {"type":"response.completed"}\n\ndata: [DONE]\n\n'
        chat = b'data: {"object":"chat.completion.chunk","choices":[{"index":0,"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        self.responses.extend([FakeResponse(native, content_type="text/event-stream"),
                               FakeResponse(chat, content_type="text/event-stream"),
                               FakeResponse(b'data: [DONE]\n\n', content_type="text/event-stream")])
        async with await self.client.execute("responses", DATA, quote=quote(), **BUDGET) as response:
            self.assertEqual([e async for e in async_response_events(response)], [{"type": "response.completed"}])
        async with await self.client.execute("chat/completions", DATA, quote=quote(), **BUDGET) as response:
            self.assertEqual(len([e async for e in async_chat_completion_events(response)]), 1)
        async with await self.client.execute("responses", DATA, quote=quote(), **BUDGET) as response:
            with self.assertRaisesRegex(KovaError, "stream_truncated"):
                _ = [e async for e in async_response_events(response)]
        self.assertTrue(all(c.closed.is_set() for c in self.connections))

    async def test_cancel_during_quote_never_dispatches(self):
        await self._cancel_during_request([FakeResponse(quote())], False, False, 1)

    async def test_cancel_during_paid_dispatch_reports_uncertainty(self):
        await self._cancel_during_request([FakeResponse(quote()), FakeResponse({"ok": True})], True, True, 2)

    async def _cancel_during_request(self, responses, paid, mutation, expected):
        entered, release = threading.Event(), threading.Event()
        final = responses.pop()

        def delayed():
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test release timeout")
            return final

        self.responses.extend([*responses, delayed])
        task = asyncio.create_task(self.client.responses(DATA, **BUDGET))
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 2))
            task.cancel()
            with self.assertRaises(AsyncRequestCancelled) as raised:
                await task
            self.assertEqual(raised.exception.request_may_have_started, paid)
            self.assertEqual(raised.exception.mutation_may_have_started, mutation)
        finally:
            release.set()
        self.assertTrue(await asyncio.to_thread(self.connections[-1].closed.wait, 2))
        self.assertEqual(len(self.calls), expected)

    async def test_cancel_during_nonpaid_mutation_reports_uncertainty(self):
        entered, release = threading.Event(), threading.Event()

        def delayed():
            entered.set()
            release.wait(5)
            return FakeResponse({"deleted": True})

        self.responses.append(delayed)
        task = asyncio.create_task(self.client.file_delete(ID))
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 2))
            task.cancel()
            with self.assertRaises(AsyncRequestCancelled) as raised:
                await task
            self.assertFalse(raised.exception.request_may_have_started)
            self.assertTrue(raised.exception.mutation_may_have_started)
        finally:
            release.set()
        self.assertTrue(await asyncio.to_thread(self.connections[-1].closed.wait, 2))
        self.assertEqual(len(self.calls), 1)

    async def test_cancel_during_read_closes_after_worker_finishes(self):
        entered, release = threading.Event(), threading.Event()

        class Delayed(FakeResponse):
            def read(self, size=-1):
                entered.set()
                release.wait(5)
                return super().read(size)

        self.responses.append(Delayed({"ok": True}))
        response = await self.client.execute("responses", DATA, quote=quote(), **BUDGET)
        task = asyncio.create_task(response.json())
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 2))
            task.cancel()
            with self.assertRaises(AsyncRequestCancelled) as raised:
                await task
            self.assertTrue(raised.exception.request_may_have_started)
            self.assertTrue(response.closed)
            self.assertFalse(self.connections[-1].closed.is_set())
        finally:
            release.set()
        self.assertTrue(await asyncio.to_thread(self.connections[-1].closed.wait, 2))

    async def test_invalid_read_closes_response(self):
        self.responses.append(FakeResponse({}))
        response = await self.client.execute("responses", DATA, quote=quote(), **BUDGET)
        with self.assertRaisesRegex(KovaError, "limit_invalid"):
            await response.json(0)
        self.assertTrue(response.closed)
