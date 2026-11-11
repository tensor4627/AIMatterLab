import sys,json,importlib.util,tempfile,threading
from pathlib import Path
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
root=Path(__file__).resolve().parents[2];worker_source=root/'backend'/'worker';sys.path.insert(0,str(worker_source))
from studio_worker.store import Store
from studio_worker.service import Service
from studio_worker.server import dispatch
with tempfile.TemporaryDirectory()as directory:
 (Path(directory)/'connection.json').write_text(json.dumps({'admin':'synthetic-admin','mcp':'synthetic-mcp'}),encoding='utf-8');store=Store(Path(directory));store.put('project',{'id':'owned','name':'synthetic'});service=SimpleNamespace(root=Path(directory),store=store,input_name=Service.input_name)
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_POST(self):
   try:
    data=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))));value=dispatch(service,'POST',self.path,data,admin=self.headers.get('Authorization')=='Bearer synthetic-admin');self.send_response(200)
   except PermissionError as e:value={'error':str(e)};self.send_response(403)
   except Exception as e:value={'error':str(e)};self.send_response(400)
   body=json.dumps(value).encode();self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever);thread.start();print(json.dumps({'port':server.server_port,'root':directory,'relay':str(worker_source/'relay.py')}),flush=True)
 try:sys.stdin.readline()
 finally:server.shutdown();thread.join();server.server_close();store.db.close()
