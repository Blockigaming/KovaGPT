"""Server-side KovaGPT v1 client. No implicit retries or provider execution."""

import hashlib
import hmac
import http.client
import json
import math
import re
import time
from urllib.parse import urlsplit

__all__ = ["Client", "KovaError", "APIResponse", "response_events", "chat_completion_events", "verify_webhook_signature"]
_OPERATIONS = frozenset(("responses", "images", "embeddings", "moderations", "search", "chat/completions", "decisions", "agent-turns", "analysis", "computer-use", "browser", "audio/transcriptions"))
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.I)
_MODEL = re.compile(r"[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*")
_KEY = re.compile(r"kova_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}")
_RETRY = re.compile(r"[\x21-\x7e]{1,128}")
_QUOTE = re.compile(r"[A-Za-z0-9_-]+\.[a-f0-9]{64}")


class KovaError(Exception):
    def __init__(self, code, status=0, request_may_have_started=False):
        super().__init__(code)
        self.code = code
        self.status = status
        self.request_may_have_started = request_may_have_started


def _require(condition, code):
    if not condition:
        raise KovaError(code)


def _number(value):
    return type(value) in (int, float) and 0 < value <= 1e9 and math.isfinite(value)


def _json_body(value, maximum=65536):
    _require(isinstance(value, dict), "input_invalid")
    try:
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, OverflowError, UnicodeError, RecursionError):
        raise KovaError("input_invalid") from None
    _require(len(raw) <= maximum, "input_too_large")
    return raw


def _identifier(value, pattern, code):
    _require(isinstance(value, str) and pattern.fullmatch(value), code)
    return value


class APIResponse:
    """Owns one HTTP connection. Always consume or close the response."""

    def __init__(self, connection, response, paid):
        self._connection = connection
        self._response = response
        self._paid = paid
        self.status = response.status
        self.content_type = response.getheader("Content-Type", "")
        self.closed = False

    def close(self):
        if not self.closed:
            self.closed = True
            try:
                self._response.close()
            finally:
                self._connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _read(self, size, *, line=False):
        _require(not self.closed, "response_closed")
        try:
            return self._response.readline(size) if line else self._response.read(size)
        except (OSError, http.client.HTTPException):
            self.close()
            raise KovaError("transport_failed", self.status, self._paid) from None

    def json(self, maximum_bytes=16 * 1024 * 1024):
        _require(type(maximum_bytes) is int and 1 <= maximum_bytes <= 16 * 1024 * 1024, "limit_invalid")
        try:
            data = self._read(maximum_bytes + 1)
            _require(len(data) <= maximum_bytes, "response_too_large")
            return json.loads(data.decode("utf-8"))
        except (UnicodeError, ValueError, RecursionError):
            raise KovaError("response_invalid", self.status, self._paid) from None
        finally:
            self.close()


def _stream_events(response, *, maximum_event_bytes=1048576, chat=False):
    """Validate the chosen SSE protocol and close the connection on exit."""
    _require("text/event-stream" in response.content_type.lower(), "stream_invalid")
    _require(type(maximum_event_bytes) is int and 1 <= maximum_event_bytes <= 1048576, "limit_invalid")
    terminal = False
    lines = []
    size = 0
    try:
        while True:
            raw = response._read(maximum_event_bytes + 1, line=True)
            if not raw:
                _require(terminal and not lines and size == 0 and not chat, "stream_truncated")
                return
            size += len(raw)
            _require(size <= maximum_event_bytes, "stream_event_too_large")
            try:
                line = raw.decode("utf-8").rstrip("\r\n")
            except UnicodeError:
                raise KovaError("stream_event_invalid") from None
            if line.startswith("data:"):
                data = line[5:]
                lines.append(data[1:] if data.startswith(" ") else data)
            if line:
                continue
            data = "\n".join(lines)
            lines = []
            size = 0
            if not data:
                continue
            if data == "[DONE]":
                _require(terminal, "stream_truncated")
                return
            _require(not terminal, "stream_event_invalid")
            try:
                event = json.loads(data)
            except (ValueError, RecursionError):
                raise KovaError("stream_event_invalid") from None
            _require(isinstance(event, dict), "stream_event_invalid")
            if chat:
                choices = event.get("choices")
                _require(event.get("object") == "chat.completion.chunk"
                         and isinstance(choices, list) and len(choices) == 1
                         and isinstance(choices[0], dict) and choices[0].get("index") == 0
                         and "finish_reason" in choices[0]
                         and choices[0]["finish_reason"] in (None, "stop", "length", "content_filter"),
                         "stream_event_invalid")
                terminal = choices[0]["finish_reason"] is not None
            else:
                terminal = event.get("type") in ("response.completed", "response.incomplete", "response.failed", "error")
            yield event
    finally:
        response.close()


def response_events(response, *, maximum_event_bytes=1048576):
    return _stream_events(response, maximum_event_bytes=maximum_event_bytes)


def chat_completion_events(response, *, maximum_event_bytes=1048576):
    return _stream_events(response, maximum_event_bytes=maximum_event_bytes, chat=True)


class Client:
    """Use from trusted server code; every paid request needs a caller budget."""

    def __init__(self, api_key, *, base_url="https://kovagpt.com", timeout=60):
        _identifier(api_key, _KEY, "credential_invalid")
        try:
            url = urlsplit(base_url)
            port = url.port
        except (TypeError, ValueError, AttributeError):
            raise KovaError("origin_invalid") from None
        _require(url.scheme == "https" and url.hostname and url.username is None and url.password is None
                 and url.path in ("", "/") and not url.query and not url.fragment
                 and not any(ord(c) <= 32 for c in base_url), "origin_invalid")
        _require(type(timeout) in (int, float) and 0 < timeout <= 300, "timeout_invalid")
        self._api_key = api_key
        self._host = url.hostname
        self._port = port or 443
        self._timeout = timeout

    def _request(self, path, *, method="GET", body=None, headers=None, paid=False):
        connection = None
        try:
            connection = http.client.HTTPSConnection(self._host, self._port, timeout=self._timeout)
            request_headers = {"Authorization": "Bearer " + self._api_key, "Cache-Control": "no-store"}
            if body is not None:
                request_headers["Content-Type"] = "application/json"
            request_headers.update(headers or {})
            connection.request(method, "/api/v1/" + path, body=body, headers=request_headers)
            response = APIResponse(connection, connection.getresponse(), paid)
        except (OSError, http.client.HTTPException, ValueError):
            if connection is not None:
                connection.close()
            raise KovaError("transport_failed", request_may_have_started=paid) from None
        if 200 <= response.status < 300:
            return response
        code = "request_failed"
        try:
            error = response.json(65536)
            candidate = error.get("error", {}).get("code") if isinstance(error, dict) else None
            if isinstance(candidate, str) and re.fullmatch(r"developer_[a-z_]{1,80}", candidate):
                code = candidate
        except (KovaError, AttributeError):
            pass
        finally:
            response.close()
        raise KovaError(code, response.status, paid and response.status >= 500)

    def _get(self, path):
        return self._request(path).json(1024 * 1024)

    def models(self, model_id=None):
        if model_id is None:
            return self._get("models")
        _identifier(model_id, _MODEL, "model_id_invalid")
        _require(2 <= len(model_id) <= 80, "model_id_invalid")
        return self._get("models?id=" + model_id)

    def usage_list(self, *, limit=25, offset=0):
        _require(type(limit) is int and 1 <= limit <= 100 and type(offset) is int and 0 <= offset <= 10000,
                 "usage_pagination_invalid")
        return self._get(f"usage?limit={limit}&offset={offset}")

    def usage_retrieve(self, request_id):
        return self._get("usage?id=" + _identifier(request_id, _UUID, "usage_id_invalid"))

    def file_search(self, data):
        return self._request("file-search", method="POST", body=_json_body(data)).json(65536)

    def file_list(self, *, page=0):
        _require(type(page) is int and 0 <= page <= 4, "file_page_invalid")
        return self._get(f"files?page={page}")

    def file_retrieve(self, file_id):
        return self._get("files?id=" + _identifier(file_id, _UUID, "file_id_invalid"))

    def file_delete(self, file_id):
        path = "files?id=" + _identifier(file_id, _UUID, "file_id_invalid")
        return self._request(path, method="DELETE").json(65536)

    def file_upload(self, data, *, idempotency_key):
        key = _identifier(idempotency_key, _RETRY, "idempotency_key_required")
        return self._request("files", method="POST", body=_json_body(data, 131072),
                             headers={"Idempotency-Key": key}).json(131072)

    @staticmethod
    def _vector_path(store_id, entry=None):
        path = "vector-stores?id=" + _identifier(store_id, _UUID, "vector_id_invalid")
        if entry is not None:
            path += "&entry_id=" + _identifier(entry, re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}"), "vector_entry_invalid")
        return path

    @staticmethod
    def _conversation_path(conversation_id, item_id=None):
        path = "conversations?id=" + _identifier(conversation_id, _UUID, "conversation_id_invalid")
        if item_id is not None:
            path += "&item_id=" + _identifier(item_id, _UUID, "conversation_id_invalid")
        return path

    def _conversation_post(self, operation, data):
        _require(isinstance(data, dict), "input_invalid")
        return self._request("conversations", method="POST",
                             body=_json_body({**data, "operation": operation}, 16384)).json(131072)

    def conversation_create(self, data):
        return self._conversation_post("create", data)

    def conversation_append(self, data):
        return self._conversation_post("append", data)

    def conversation_remove(self, data):
        return self._conversation_post("remove", data)

    def conversation_list(self):
        return self._get("conversations")

    def conversation_retrieve(self, conversation_id):
        return self._get(self._conversation_path(conversation_id))

    def conversation_item(self, conversation_id, item_id):
        _require(item_id is not None, "conversation_id_invalid")
        return self._get(self._conversation_path(conversation_id, item_id))

    def conversation_delete(self, conversation_id):
        return self._request(self._conversation_path(conversation_id), method="DELETE").json(65536)

    def _vector_post(self, operation, data, headers=None):
        _require(isinstance(data, dict), "input_invalid")
        return self._request("vector-stores", method="POST",
                             body=_json_body({**data, "operation": operation}), headers=headers).json(1048576)

    def vector_create(self, data, *, idempotency_key):
        key = _identifier(idempotency_key, _RETRY, "idempotency_key_required")
        return self._vector_post("create", data, {"Idempotency-Key": key})

    def vector_upsert(self, data):
        return self._vector_post("upsert", data)

    def vector_search(self, data):
        return self._vector_post("search", data)

    def vector_list(self):
        return self._get("vector-stores")

    def vector_retrieve(self, store_id):
        return self._get(self._vector_path(store_id))

    def vector_entries(self, store_id, *, page=0):
        _require(type(page) is int and 0 <= page <= 19, "vector_page_invalid")
        return self._get(self._vector_path(store_id) + f"&entries=true&page={page}")

    def vector_entry(self, store_id, entry):
        _require(entry is not None, "vector_entry_invalid")
        return self._get(self._vector_path(store_id, entry))

    def vector_delete(self, store_id, *, entry=None):
        return self._request(self._vector_path(store_id, entry), method="DELETE").json(65536)

    @staticmethod
    def _agent_path(agent_id, version=None):
        path = "agents?id=" + _identifier(agent_id, _UUID, "agent_id_invalid")
        if version is not None:
            _require(type(version) is int and 1 <= version <= 20, "agent_version_invalid")
            path += f"&version={version}"
        return path

    def _agent_post(self, operation, data):
        _require(isinstance(data, dict), "input_invalid")
        return self._request("agents", method="POST",
                             body=_json_body({**data, "operation": operation}, 16384)).json(65536)

    def agent_create(self, data):
        return self._agent_post("create", data)

    def agent_update(self, data):
        return self._agent_post("update", data)

    def agent_list(self):
        return self._get("agents")

    def agent_retrieve(self, agent_id, *, version=None):
        return self._get(self._agent_path(agent_id, version))

    def agent_delete(self, agent_id):
        return self._request(self._agent_path(agent_id), method="DELETE").json(65536)

    def agent_turn(self, data, **budget):
        return self.run("agent-turns", data, **budget)

    @staticmethod
    def _skill_path(skill_id, version=None):
        path = "skills?id=" + _identifier(skill_id, _UUID, "skill_id_invalid")
        if version is not None:
            _require(type(version) is int and 1 <= version <= 20, "skill_version_invalid")
            path += f"&version={version}"
        return path

    def _skill_post(self, operation, data):
        _require(isinstance(data, dict), "input_invalid")
        return self._request("skills", method="POST",
                             body=_json_body({**data, "operation": operation}, 16384)).json(65536)

    def skill_create(self, data):
        return self._skill_post("create", data)

    def skill_update(self, data):
        return self._skill_post("update", data)

    def skill_list(self):
        return self._get("skills")

    def skill_retrieve(self, skill_id, *, version=None):
        return self._get(self._skill_path(skill_id, version))

    def skill_delete(self, skill_id):
        return self._request(self._skill_path(skill_id), method="DELETE").json(65536)

    @staticmethod
    def _webhook_path(endpoint_id, deliveries=False):
        return "webhooks?id=" + _identifier(endpoint_id, _UUID, "webhook_id_invalid") + ("&deliveries=true" if deliveries else "")

    def _webhook_post(self, operation, data):
        _require(isinstance(data, dict), "input_invalid")
        return self._request("webhooks", method="POST",
                             body=_json_body({**data, "operation": operation}, 8192)).json(65536)

    def webhook_create(self, data):
        return self._webhook_post("create", data)

    def webhook_rotate(self, data):
        return self._webhook_post("rotate", data)

    def webhook_test(self, data):
        return self._webhook_post("test", data)

    def webhook_list(self):
        return self._get("webhooks")

    def webhook_retrieve(self, endpoint_id):
        return self._get(self._webhook_path(endpoint_id))

    def webhook_deliveries(self, endpoint_id):
        return self._get(self._webhook_path(endpoint_id, True))

    def webhook_delete(self, endpoint_id):
        return self._request(self._webhook_path(endpoint_id), method="DELETE").json(65536)

    @staticmethod
    def _batch_path(batch_id, item_id=None):
        path = "batches?id=" + _identifier(batch_id, _UUID, "batch_id_invalid")
        if item_id is not None:
            path += "&item_id=" + _identifier(item_id, _UUID, "batch_id_invalid")
        return path

    def batch_create(self, data):
        _require(isinstance(data, dict), "input_invalid")
        return self._request("batches", method="POST",
                             body=_json_body({**data, "operation": "create"})).json(65536)

    def batch_cancel(self, batch_id):
        batch_id = _identifier(batch_id, _UUID, "batch_id_invalid")
        return self._request("batches", method="POST",
                             body=_json_body({"operation": "cancel", "id": batch_id})).json(65536)

    def batch_list(self):
        return self._get("batches")

    def batch_retrieve(self, batch_id):
        return self._request(self._batch_path(batch_id), method="GET").json(131072)

    def batch_item(self, batch_id, item_id):
        _require(item_id is not None, "batch_id_invalid")
        return self._request(self._batch_path(batch_id, item_id), method="GET").json(262144)

    def response_job_create(self, data):
        snapshot = json.loads(_json_body(data, 16384))
        _identifier(snapshot.get("id"), _UUID, "response_job_id_invalid")
        currency, maximum, token = snapshot.get("currency"), snapshot.get("maximum_charge"), snapshot.get("quote_token")
        _require(isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency)
                 and _number(maximum) and maximum <= 1000000
                 and isinstance(token, str) and len(token) <= 2048 and _QUOTE.fullmatch(token), "budget_required")
        return self._request("response-jobs", method="POST", paid=True,
                             body=_json_body({**snapshot, "operation": "create"})).json(262144)

    def response_job_cancel(self, job_id):
        job_id = _identifier(job_id, _UUID, "response_job_id_invalid")
        return self._request("response-jobs", method="POST",
                             body=_json_body({"operation": "cancel", "id": job_id})).json(262144)

    def response_job_list(self):
        return self._get("response-jobs")

    def response_job_retrieve(self, job_id):
        return self._request("response-jobs?id=" + _identifier(job_id, _UUID, "response_job_id_invalid")).json(262144)

    @staticmethod
    def _automation_path(automation_id, item_id=None):
        path = "automations?id=" + _identifier(automation_id, _UUID, "automation_id_invalid")
        if item_id is not None:
            path += "&item_id=" + _identifier(item_id, _UUID, "automation_id_invalid")
        return path

    def automation_create(self, data):
        _require(isinstance(data, dict), "input_invalid")
        return self._request("automations", method="POST",
                             body=_json_body({**data, "operation": "create"})).json(65536)

    def automation_cancel(self, automation_id):
        automation_id = _identifier(automation_id, _UUID, "automation_id_invalid")
        return self._request("automations", method="POST",
                             body=_json_body({"operation": "cancel", "id": automation_id})).json(65536)

    def automation_list(self):
        return self._get("automations")

    def automation_retrieve(self, automation_id):
        return self._request(self._automation_path(automation_id), method="GET").json(131072)

    def automation_item(self, automation_id, item_id):
        _require(item_id is not None, "automation_id_invalid")
        return self._request(self._automation_path(automation_id, item_id), method="GET").json(262144)

    def automation_pause(self, automation_id):
        automation_id = _identifier(automation_id, _UUID, "automation_id_invalid")
        return self._request("automations", method="POST",
                             body=_json_body({"operation": "pause", "id": automation_id})).json(65536)

    def automation_resume(self, automation_id):
        automation_id = _identifier(automation_id, _UUID, "automation_id_invalid")
        return self._request("automations", method="POST",
                             body=_json_body({"operation": "resume", "id": automation_id})).json(65536)

    def quote(self, operation, data):
        _require(isinstance(operation, str) and operation in _OPERATIONS, "operation_invalid")
        limit = 1048576 if operation == "audio/transcriptions" else 65536
        snapshot = _json_body(data, limit)
        payload = b'{"operation":' + json.dumps(operation).encode("ascii") + b',"input":' + snapshot + b'}'
        _require(len(payload) <= limit, "input_too_large")
        return self._request("quotes", method="POST", body=payload).json(65536)

    @staticmethod
    def _budget(currency, maximum_charge, idempotency_key):
        _require(isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency) and _number(maximum_charge),
                 "budget_required")
        return _identifier(idempotency_key, _RETRY, "idempotency_key_required")

    def execute(self, operation, data, *, quote, currency, maximum_charge, idempotency_key):
        _require(isinstance(operation, str) and operation in _OPERATIONS, "operation_invalid")
        key = self._budget(currency, maximum_charge, idempotency_key)
        now = int(time.time() * 1000)
        _require(isinstance(quote, dict), "quote_outside_budget")
        token, charge, expires = quote.get("quoteToken"), quote.get("maximumCharge"), quote.get("expiresAt")
        _require(isinstance(token, str) and len(token) <= 2048 and _QUOTE.fullmatch(token)
                 and _number(charge) and charge <= maximum_charge and quote.get("currency") == currency
                 and type(expires) is int and now < expires <= now + 120000, "quote_outside_budget")
        limit = 1048576 if operation == "audio/transcriptions" else 65536
        return self._request(operation, method="POST", body=_json_body(data, limit), paid=True,
                             headers={"Idempotency-Key": key, "X-Kova-Quote": token})

    def run(self, operation, data, *, currency, maximum_charge, idempotency_key):
        self._budget(currency, maximum_charge, idempotency_key)
        limit = 1048576 if operation == "audio/transcriptions" else 65536
        snapshot = json.loads(_json_body(data, limit))
        quote = self.quote(operation, snapshot)
        return self.execute(operation, snapshot, quote=quote, currency=currency,
                            maximum_charge=maximum_charge, idempotency_key=idempotency_key)

    def responses(self, data, **budget):
        return self.run("responses", data, **budget)

    def chat_completions(self, data, **budget):
        return self.run("chat/completions", data, **budget)

    def search(self, data, **budget):
        return self.run("search", data, **budget)

    def images(self, data, **budget):
        return self.run("images", data, **budget)

    def image_edit(self, data, **budget):
        _require(isinstance(data, dict) and isinstance(data.get("image"), str)
                 and data["image"].startswith("data:image/png;base64,"), "image_required")
        return self.run("images", data, **budget)

    def embeddings(self, data, **budget):
        return self.run("embeddings", data, **budget)

    def browser_snapshot(self, data, **budget):
        return self.run("browser", data, **budget)

    def computer_use(self, data, **budget):
        return self.run("computer-use", data, **budget)

    def analysis(self, data, **budget):
        return self.run("analysis", data, **budget)

    def decisions(self, data, **budget):
        return self.run("decisions", data, **budget)

    def transcriptions(self, data, **budget):
        return self.run("audio/transcriptions", data, **budget)

    def moderations(self, data, **budget):
        return self.run("moderations", data, **budget)

def verify_webhook_signature(*, secret, event_id, timestamp, body, signature, now=None):
    """Verify a raw webhook payload before parsing or processing the event."""
    if now is None:
        now = int(time.time())
    if not (
        isinstance(secret, str) and re.fullmatch(r"whsec_[A-Za-z0-9_-]{43}", secret)
        and isinstance(event_id, str) and _UUID.fullmatch(event_id)
        and isinstance(signature, str) and re.fullmatch(r"v1=[a-f0-9]{64}", signature)
        and type(now) is int and abs(now) <= 9007199254740991
    ):
        return False
    if isinstance(timestamp, str) and re.fullmatch(r"[1-9][0-9]{0,15}", timestamp):
        timestamp = int(timestamp)
    if type(timestamp) is not int or not 1 <= timestamp <= 9007199254740991 or abs(now - timestamp) > 300:
        return False
    try:
        if isinstance(body, str):
            body = body.encode("utf-8")
        if not isinstance(body, bytes) or len(body) > 65536:
            return False
        prefix = f"{event_id.lower()}.{timestamp}.".encode("ascii")
        digest = hmac.new(secret.encode("ascii"), prefix + body, hashlib.sha256).hexdigest()
        return hmac.compare_digest("v1=" + digest, signature)
    except (TypeError, UnicodeError, ValueError):
        return False
