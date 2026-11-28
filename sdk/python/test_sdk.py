import io
import json
from email import policy
from email.parser import BytesParser
import time
import unittest
from unittest.mock import patch

from kovagpt import Client, KovaError, response_events, chat_completion_events, verify_webhook_signature

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


class WebhookVerificationTests(unittest.TestCase):
    def test_original_bytes_and_tampering(self):
        data = {
            "secret": "whsec_" + "a" * 43,
            "event_id": "11111111-1111-4111-8111-111111111111",
            "timestamp": "1795651200",
            "body": '{"message":"café"}',
            "signature": "v1=c9b338ec00ca9cbe82fba49f1a10e098931f373563745588c85a976b43c63478",
            "now": 1795651200,
        }
        self.assertTrue(verify_webhook_signature(**data))
        self.assertTrue(verify_webhook_signature(**{**data, "body": data["body"].encode()}))
        self.assertTrue(verify_webhook_signature(**{**data, "timestamp": 1795651200}))
        for change in (
            {"body": data["body"] + " "},
            {"body": b"x" * 65537},
            {"timestamp": "01795651200"},
            {"timestamp": "1795651201"},
            {"timestamp": "1795651200, 1795651200"},
            {"now": data["now"] + 301},
            {"now": data["now"] - 301},
            {"event_id": "22222222-2222-4222-8222-222222222222"},
            {"secret": "whsec_" + "b" * 43},
            {"signature": "v1=" + "0" * 64},
        ):
            self.assertFalse(verify_webhook_signature(**{**data, **change}))


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

    def test_recorded_translation_and_research_review_workflows(self):
        transcript = {"id": "req_test", "status": "completed", "text": "bonjour", "usage": {"type": "duration", "seconds": 1}}
        data = {"model": "kova-fast", "transcription": transcript, "target_language": "en", "max_output_tokens": 100}
        with self.assertRaisesRegex(KovaError, "transcription_incomplete"):
            self.client.translate_transcript({**data, "transcription": {**transcript, "status": "failed"}}, **BUDGET)
        self.assertEqual(len(self.calls), 0)
        self.responses.extend([FakeResponse(quote()), FakeResponse({"status": "completed"})])
        self.client.translate_transcript(data, **BUDGET).json()
        body = json.loads(self.calls[1][2])
        self.assertEqual(json.loads(body["input"]), {"target_language": "en", "transcript": "bonjour"})
        self.assertEqual(json.loads(self.calls[0][2]), {"operation": "responses", "input": body})
        plan_input = {"model": "kova-fast", "question": "How does it work?", "max_output_tokens": 100}
        plan_response = {"id": "resp_plan", "status": "completed", "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": '{"queries":["first","second"]}'}]}]}
        self.responses.extend([FakeResponse(quote()), FakeResponse(plan_response)])
        self.assertEqual(self.client.research_plan(plan_input, **BUDGET), {"queries": ["first", "second"], "response_id": "resp_plan"})
        items = [{"id": "11111111-1111-4111-8111-111111111111", "query": "first"}, {"id": "22222222-2222-4222-8222-222222222222", "query": "second"}]
        draft_input = {"id": ID, "currency": "USD", "maximum_charge": 10, "model": "kova-fast", "queries": items, "max_output_tokens": 100, "max_tool_calls": 1}
        self.responses.extend([FakeResponse(quote()), FakeResponse(quote())])
        draft = self.client.research_prepare(draft_input)
        self.assertEqual(len(draft["items"]), 2)
        self.assertEqual(len(self.calls), 6)
        self.assertTrue(all(call[1] == "/api/v1/quotes" for call in self.calls[4:6]))
        self.responses.extend([FakeResponse(quote()), FakeResponse(quote())])
        with self.assertRaisesRegex(KovaError, "quote_outside_budget"):
            self.client.research_prepare({**draft_input, "maximum_charge": 9})
        item = {**items[0], "status": "completed", "result_status": "completed", "settlement_state": "settled", "text": "Evidence", "citations": [{"url": "https://example.com/report", "title": "Report"}]}
        run = {"id": ID, "object": "research.run", "status": "partial", "items": [item, {**item, **items[1], "settlement_state": "uncertain", "text": "NOT SETTLED"}]}
        self.responses.append(FakeResponse(run))
        with self.assertRaisesRegex(KovaError, "research_not_ready"):
            self.client.research_synthesize(ID, plan_input, **BUDGET)
        self.assertEqual(len(self.calls), 9)
        self.responses.extend([FakeResponse(run), FakeResponse(quote()), FakeResponse({"status": "completed"})])
        self.client.research_synthesize(ID, {**plan_input, "allow_partial": True}, **BUDGET).json()
        body = json.loads(self.calls[-1][2])
        self.assertEqual(len(json.loads(body["input"])["evidence"]), 1)
        self.assertNotIn("NOT SETTLED", body["input"])

    def test_analysis_preserves_project_file_references(self):
        data = {**DATA, "file_ids": [ID]}
        self.responses.extend([FakeResponse(quote()), FakeResponse({"text": "result"})])
        self.assertEqual(self.client.analysis(data, **BUDGET).json()["text"], "result")
        self.assertEqual(json.loads(self.calls[0][2]), {"operation": "analysis", "input": data})
        self.assertEqual(self.calls[1][1], "/api/v1/analysis")
        self.assertEqual(json.loads(self.calls[1][2]), data)

    def test_native_translation_uses_exact_quoted_input(self):
        data = {"model": "kova-translate", "audio": "AAAA" * 32000, "target_language": "es"}
        self.responses.extend([FakeResponse(quote()), FakeResponse({"text": "Hola"})])
        self.assertEqual(self.client.translate_audio(data, **BUDGET).json()["text"], "Hola")
        self.assertEqual(json.loads(self.calls[0][2]), {"operation": "audio/translations", "input": data})
        self.assertEqual(self.calls[1][1], "/api/v1/audio/translations")

    def test_realtime_uses_exact_quoted_input(self):
        data = {"model": "kova-realtime", "audio": "AAAA" * 30000, "output_modality": "audio", "max_output_tokens": 64}
        self.responses.extend([FakeResponse(quote()), FakeResponse({"text": "result"})])
        self.assertEqual(self.client.realtime(data, **BUDGET).json()["text"], "result")
        self.assertEqual(json.loads(self.calls[0][2]), {"operation": "realtime", "input": data})
        self.assertEqual(self.calls[1][1], "/api/v1/realtime")
        self.assertEqual(json.loads(self.calls[1][2]), data)

    def test_speech_uses_exact_quoted_input(self):
        data = {"model": "speech", "input": "hello", "voice": "default"}
        self.responses.extend([FakeResponse(quote()), FakeResponse({"audio": "//uAAA=="})])
        self.assertEqual(self.client.speech(data, **BUDGET).json()["audio"], "//uAAA==")
        self.assertEqual(json.loads(self.calls[0][2]), {"operation": "audio/speech", "input": data})
        self.assertEqual(self.calls[1][1], "/api/v1/audio/speech")
        self.assertEqual(json.loads(self.calls[1][2]), data)

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

    def test_vector_batch(self):
        self.responses.append(FakeResponse({"object": "list", "data": []}))
        data = {"store_id": ID, "model": "embedding", "entries": [{"entry_id": "a", "vector": [1], "text": "one"}]}
        self.client.vector_upsert_batch(data)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(json.loads(self.calls[0][2]), {**data, "operation": "upsert_batch"})

    def test_vectors_scoped_crud_no_inference(self):
        self.responses.extend(FakeResponse({}) for _ in range(5))
        self.client.vector_create({"name": "index", "model": "embedding", "dimensions": 2}, idempotency_key="stable")
        self.client.vector_upsert({"store_id": ID, "entry_id": "item", "model": "embedding", "vector": [1, 0], "text": "example"})
        self.client.vector_search({"store_id": ID, "model": "embedding", "vector": [1, 0]})
        self.client.vector_entries(ID, page=1)
        self.client.vector_delete(ID, entry="item")
        self.assertEqual([json.loads(call[2])["operation"] for call in self.calls[:3]], ["create", "upsert", "search"])
        self.assertEqual(self.calls[0][3]["Idempotency-Key"], "stable")
        self.assertEqual(self.calls[3][1], "/api/v1/vector-stores?id=" + ID + "&entries=true&page=1")
        self.assertEqual(self.calls[4][:2], ("DELETE", "/api/v1/vector-stores?id=" + ID + "&entry_id=item"))
        self.assertTrue(all("X-Kova-Quote" not in call[3] for call in self.calls))
        with self.assertRaisesRegex(KovaError, "vector_entry_invalid"):
            self.client.vector_entry(ID, "x&other=1")
        self.assertEqual(len(self.calls), 5)

    def test_chat_stream_requires_finish_and_done(self):
        chunk = {"object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        frame = ("data: " + json.dumps(chunk) + "\n\n").encode()
        for data, valid in [(frame + b"data: [DONE]\n\n", True), (frame, False), (b"data: [DONE]\n\n", False)]:
            self.responses.append(FakeResponse(data, content_type="text/event-stream"))
            response = self.client.execute("chat/completions", {}, quote=quote(), **BUDGET)
            if valid:
                self.assertEqual(list(chat_completion_events(response)), [chunk])
            else:
                with self.assertRaisesRegex(KovaError, "stream_truncated"):
                    list(chat_completion_events(response))
            self.assertTrue(response.closed)

    def test_conversation_resource_operations(self):
        self.responses.extend(FakeResponse({}) for _ in range(4))
        self.client.conversation_create({"id": ID, "title": "Example"})
        self.client.conversation_append({"id": ID, "expected_revision": 0, "item": {"id": ID, "role": "user", "content": "hello"}})
        self.client.conversation_item(ID, ID)
        self.client.conversation_delete(ID)
        self.assertEqual(json.loads(self.calls[0][2])["operation"], "create")
        self.assertEqual(json.loads(self.calls[1][2])["operation"], "append")
        self.assertEqual(self.calls[2][1], "/api/v1/conversations?id=" + ID + "&item_id=" + ID)
        self.assertEqual(self.calls[3][:2], ("DELETE", "/api/v1/conversations?id=" + ID))
        self.assertTrue(all("X-Kova-Quote" not in call[3] for call in self.calls))
        with self.assertRaisesRegex(KovaError, "conversation_id_invalid"):
            self.client.conversation_item(ID, "../files")
        self.assertEqual(len(self.calls), 4)

    def test_audio_transcription_quotes_and_dispatches_large_bounded_body(self):
        self.responses.extend([FakeResponse(quote()), FakeResponse({"text": "hello"})])
        data = {"model": "transcribe", "audio": "data:audio/wav;base64," + "A" * 80000}
        response = self.client.transcriptions(data, **BUDGET)
        self.assertEqual(response.json(65536)["text"], "hello")
        self.assertEqual(json.loads(self.calls[0][2]), {"operation": "audio/transcriptions", "input": data})
        self.assertEqual(self.calls[1][1], "/api/v1/audio/transcriptions")
        self.assertEqual(json.loads(self.calls[1][2]), data)
        self.assertEqual(self.calls[1][3]["Idempotency-Key"], "stable")
        with self.assertRaises(KovaError):
            self.client.responses({"model": "fast", "input": data["audio"]}, **BUDGET)
        self.assertEqual(len(self.calls), 2)

    def test_research_runs_use_scoped_routes(self):
        job = {"id": ID, "currency": "USD", "maximum_charge": 1, "items": []}
        self.responses.extend(FakeResponse({"id": ID}) for _ in range(4))
        self.client.research_create(job)
        self.client.research_list()
        self.client.research_retrieve(ID)
        self.client.research_cancel(ID)
        self.assertEqual(json.loads(self.calls[0][2]), {**job, "operation": "create"})
        self.assertEqual(self.calls[2][1], "/api/v1/research-runs?id=" + ID)
        self.assertEqual(json.loads(self.calls[3][2]), {"operation": "cancel", "id": ID})
        with self.assertRaisesRegex(KovaError, "research_id_invalid"):
            self.client.research_retrieve("../keys")
        self.assertEqual(len(self.calls), 4)

    def test_response_jobs_use_stable_ids_and_explicit_quotes(self):
        self.responses.extend(FakeResponse({"id": ID, "status": "queued"}) for _ in range(4))
        job = {"id": ID, "currency": "USD", "maximum_charge": 10, "quote_token": quote()["quoteToken"], "input": DATA}
        self.client.response_job_create(job)
        self.client.response_job_list()
        self.client.response_job_retrieve(ID)
        self.client.response_job_cancel(ID)
        self.assertEqual(json.loads(self.calls[0][2]), {**job, "operation": "create"})
        self.assertEqual(self.calls[2][1], "/api/v1/response-jobs?id=" + ID)
        self.assertEqual(json.loads(self.calls[3][2]), {"operation": "cancel", "id": ID})
        with self.assertRaisesRegex(KovaError, "budget_required"):
            self.client.response_job_create({**job, "quote_token": ""})
        with self.assertRaisesRegex(KovaError, "response_job_id_invalid"):
            self.client.response_job_retrieve("../keys")
        self.assertEqual(len(self.calls), 4)

    def test_paid_queue_operations_preserve_uncertainty_and_never_retry(self):
        job = {"id": ID, "currency": "USD", "maximum_charge": 10, "items": []}
        response_job = {"id": ID, "currency": "USD", "maximum_charge": 10,
                        "quote_token": quote()["quoteToken"], "input": DATA}
        for action in (lambda: self.client.batch_create(job),
                       lambda: self.client.automation_create(job),
                       lambda: self.client.automation_resume(ID),
                       lambda: self.client.response_job_create(response_job)):
            for response in (OSError("lost acknowledgement"), FakeResponse(b"invalid JSON", 202),
                             FakeResponse(b"x" * 262145, 202), FakeResponse({}, 503)):
                before = len(self.calls)
                self.responses.append(response)
                with self.assertRaises(KovaError) as raised:
                    action()
                self.assertTrue(raised.exception.request_may_have_started)
                self.assertEqual(len(self.calls), before + 1)
        self.responses.append(OSError("lost acknowledgement"))
        with self.assertRaises(KovaError) as raised:
            self.client.batch_cancel(ID)
        self.assertFalse(raised.exception.request_may_have_started)

    def test_multipart_upload_uses_one_utf8_file_and_stable_key(self):
        data = {"filename": "data.csv", "mimeType": "text/csv", "text": "A,é\nB,2"}
        self.responses.append(FakeResponse({"id": ID}))
        self.client.file_upload_multipart(data, idempotency_key="upload-1")
        method, path, raw, headers = self.calls[0]
        self.assertEqual((method, path), ("POST", "/api/v1/files"))
        self.assertEqual(headers["Idempotency-Key"], "upload-1")
        message = BytesParser(policy=policy.default).parsebytes(
            ("Content-Type: " + headers["Content-Type"] + "\r\n\r\n").encode("ascii") + raw)
        parts = list(message.iter_parts())
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].get_param("name", header="content-disposition"), "file")
        self.assertEqual(parts[0].get_filename(), "data.csv")
        self.assertEqual(parts[0].get_content_type(), "text/csv")
        self.assertEqual(parts[0].get_payload(decode=True), data["text"].encode("utf-8"))
        for invalid in ({**data, "filename": "../data.csv"}, {**data, "mimeType": "text/plain"},
                        {**data, "text": "é" * 16385},
                        {"filename": "bad.json", "mimeType": "application/json", "text": "NaN"}):
            with self.assertRaisesRegex(KovaError, "file_invalid"):
                self.client.file_upload_multipart(invalid, idempotency_key="upload-1")
        self.assertEqual(len(self.calls), 1)

    def test_invalid_origin_and_unsafe_key(self):
        for url in ("http://kovagpt.com", "https://x:y@kovagpt.com", "https://kovagpt.com/path"):
            with self.assertRaisesRegex(KovaError, "origin_invalid"):
                Client(KEY, base_url=url)
        with self.assertRaisesRegex(KovaError, "credential_invalid"):
            Client("fake")
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
