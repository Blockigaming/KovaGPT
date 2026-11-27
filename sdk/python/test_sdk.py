import io
import json
import time
import unittest
from unittest.mock import patch

from kovagpt import Client, KovaError, response_events

KEY = "kova_11111111-1111-4111-8111-111111111111_" + "a" * 43
ID = "55555555-5555-4555-8555-555555555555"
BUDGET = {"currency": "USD", "maximum_charge": 10, "idempotency_key": "stable"}
DATA = {"model": "kova-fast", "input": "hello", "max_output_tokens": 100}


def quote(**extra):
    return {"quoteToken": "e30." + "a" * 64, "currency": "USD", "maximumCharge": 5,
            "expiresAt": int(time.time() * 1000) + 119000, **extra}


class FakeResponse(io.BytesIO):
    def __init__(self, value, status=200, content_type="application/json"):
        super().__init__(value if isinstance(value, bytes) else json.dumps(value).encode())
        self.status, self.content_type = status, content_type

    def getheader(self, name, default=None):
        return self.content_type if name == "Content-Type" else default


class SDKTests(unittest.TestCase):
    def setUp(self):
        self.calls, self.responses, self.connections = [], [], []
        test = self

        class Connection:
            def __init__(self, host, port, timeout):
                self.closed = False
                test.connections.append(self)

            def request(self, method, path, body, headers):
                test.calls.append((method, path, body, headers))

            def getresponse(self):
                value = test.responses.pop(0)
                if isinstance(value, Exception):
                    raise value
                return value

            def close(self):
                self.closed = True

        self.mock = patch("http.client.HTTPSConnection", Connection)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.client = Client(KEY)

    def test_explicit_budget_and_identical_quoted_input(self):
        self.responses.extend([FakeResponse(quote()), FakeResponse({"ok": True})])
        self.assertEqual(self.client.responses(DATA, **BUDGET).json(), {"ok": True})
        self.assertEqual(json.loads(self.calls[0][2])["input"], json.loads(self.calls[1][2]))
        self.assertEqual(self.calls[1][3]["Idempotency-Key"], "stable")
        self.assertEqual(self.calls[1][3]["X-Kova-Quote"], quote()["quoteToken"])
        self.assertTrue(all(c.closed for c in self.connections))

    def test_overbudget_and_invalid_inputs_do_not_dispatch(self):
        self.responses.append(FakeResponse(quote(maximumCharge=11)))
        with self.assertRaisesRegex(KovaError, "quote_outside_budget"):
            self.client.responses(DATA, **BUDGET)
        with self.assertRaisesRegex(KovaError, "budget_required"):
            self.client.responses(DATA, **{**BUDGET, "maximum_charge": True})
        with self.assertRaisesRegex(KovaError, "image_required"):
            self.client.image_edit({}, **BUDGET)
        self.assertEqual(len(self.calls), 1)

    def test_safe_discovery_and_file_paths(self):
        self.responses.extend(FakeResponse({}) for _ in range(4))
        self.client.models("kova-argon-4.6")
        self.client.usage_list(limit=100, offset=10000)
        self.client.usage_retrieve(ID)
        self.client.file_delete(ID)
        self.assertEqual(self.calls[0][1], "/api/v1/models?id=kova-argon-4.6")
        self.assertEqual(self.calls[1][1], "/api/v1/usage?limit=100&offset=10000")
        self.assertEqual(self.calls[2][1], "/api/v1/usage?id=" + ID)
        self.assertEqual(self.calls[3][0], "DELETE")
        with self.assertRaisesRegex(KovaError, "usage_id_invalid"):
            self.client.usage_retrieve("x&offset=1")
        self.assertEqual(len(self.calls), 4)

    def test_uncertain_transport_and_redirect_never_retry(self):
        self.responses.extend([FakeResponse(quote()), OSError(KEY)])
        with self.assertRaises(KovaError) as raised:
            self.client.responses(DATA, **BUDGET)
        self.assertTrue(raised.exception.request_may_have_started)
        self.assertNotIn(KEY, str(raised.exception))
        self.responses.append(FakeResponse({"error": {"code": KEY}}, status=302))
        with self.assertRaisesRegex(KovaError, "request_failed"):
            self.client.models()
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(all(c.closed for c in self.connections))

    def test_stream_terminal_and_truncation(self):
        good = b'data: {"type":"response.completed"}\r\n\r\ndata: [DONE]\r\n\r\n'
        self.responses.append(FakeResponse(good, content_type="text/event-stream"))
        response = self.client.execute("responses", DATA, quote=quote(), **BUDGET)
        self.assertEqual(list(response_events(response)), [{"type": "response.completed"}])
        self.assertTrue(response.closed)
        self.responses.append(FakeResponse(b'data: [DONE]\n\n', content_type="text/event-stream"))
        response = self.client.execute("responses", DATA, quote=quote(), **BUDGET)
        with self.assertRaisesRegex(KovaError, "stream_truncated"):
            list(response_events(response))
        self.assertTrue(response.closed)

    def test_file_search_uses_scoped_read_without_inference_quote(self):
        self.responses.append(FakeResponse({"data": [], "search_type": "lexical"}))
        body = {"query": "hello", "file_ids": [ID]}
        self.assertEqual(self.client.file_search(body)["search_type"], "lexical")
        self.assertEqual(self.calls[0][:2], ("POST", "/api/v1/file-search"))
        self.assertEqual(json.loads(self.calls[0][2]), body)
        self.assertNotIn("X-Kova-Quote", self.calls[0][3])

    def test_search_and_chat_aliases_keep_signed_quotes(self):
        for operation, method, body in [
            ("search", self.client.search, {"model": "kova-search", "query": "hello", "max_output_tokens": 100, "max_tool_calls": 1}),
            ("chat/completions", self.client.chat_completions, {"model": "kova-fast", "messages": [{"role": "user", "content": "hello"}], "max_completion_tokens": 100}),
        ]:
            self.responses.extend([FakeResponse(quote()), FakeResponse({"ok": True})])
            self.assertEqual(method(body, **BUDGET).json(), {"ok": True})
            self.assertEqual(json.loads(self.calls[-2][2]), {"operation": operation, "input": body})
            self.assertEqual(self.calls[-1][1], "/api/v1/" + operation)
            self.assertEqual(json.loads(self.calls[-1][2]), body)

    def test_invalid_origin_and_unsafe_key(self):
        for url in ("http://kovagpt.com", "https://x:y@kovagpt.com", "https://kovagpt.com/path"):
            with self.assertRaisesRegex(KovaError, "origin_invalid"):
                Client(KEY, base_url=url)
        with self.assertRaisesRegex(KovaError, "credential_invalid"):
            Client("fake")
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
