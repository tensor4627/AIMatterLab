"""HTTP credential boundary and bounded JSON/MCP request transport."""
import hmac
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

def handler_factory(service, tokens, *, dispatch, mcp_tool_call, tools):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status, value=None):
            body = b"" if value is None else json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.handle_request("GET")

        def do_POST(self):
            self.handle_request("POST")

        def handle_request(self, method):
            if self.headers.get("Origin"):
                return self.respond(403, {"error": "Browser origins are not permitted"})
            auth = self.headers.get("Authorization", "")
            admin = hmac.compare_digest(auth, "Bearer " + tokens["admin"])
            mcp = hmac.compare_digest(auth, "Bearer " + tokens["mcp"])
            if not (admin or mcp):
                return self.respond(401, {"error": "Authentication required"})
            parsed = urlparse(self.path)
            try:
                if method == "POST":
                    length = int(self.headers.get("Content-Length", 0))
                    if not 0 < length <= 4 * 1024 * 1024:
                        return self.respond(413, {"error": "Bounded JSON body required"})
                    data = json.loads(self.rfile.read(length))
                else:
                    data = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                if parsed.path == "/mcp":
                    if method == "GET":
                        return self.respond(405)
                    operation = data.get("method")
                    if "id" not in data:
                        return self.respond(202)
                    if operation == "initialize":
                        value = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                                 "serverInfo": {"name": "gpusampling", "version": "0.18.8"},
                                 "instructions": "Use existing project authorization. Missing scientific choices must be collected. Prepare drafts for desktop review and stop. Only the desktop user can validate and submit with Confirm and Execute. Scientific jobs continue independently once submitted."}
                    elif operation == "resources/list":
                        value = {"resources": []}
                    elif operation == "resources/templates/list":
                        value = {"resourceTemplates": []}
                    elif operation == "ping":
                        value = {}
                    elif operation == "tools/list":
                        value = {"tools": tools()}
                    elif operation == "tools/call":
                        value = mcp_tool_call(service, data.get("params"))
                    else:
                        return self.respond(200, {"jsonrpc": "2.0", "id": data["id"],
                                                  "error": {"code": -32601, "message": "Method not found"}})
                    return self.respond(200, {"jsonrpc": "2.0", "id": data["id"], "result": value})
                if mcp:
                    return self.respond(403, {"error": "MCP credential is restricted to /mcp"})
                self.respond(200, dispatch(service, method, parsed.path, data, admin=admin))
            except PermissionError as exc:
                self.respond(403, {"error": str(exc)})
            except (ValueError, KeyError, TypeError) as exc:
                self.respond(400, {"error": str(exc)})
            except Exception as exc:
                self.respond(500, {"error": str(exc)})

    return Handler
