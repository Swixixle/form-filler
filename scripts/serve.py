"""Serve Form Filler on this computer only, and open it in the browser.

Usage: python3 serve.py [port]   (default 8771)

Nothing is uploaded: the page reads the form and your answers in the browser itself. (Reading handwriting
downloads its model from Hugging Face the first time; your pages never leave the computer.)
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys, threading, webbrowser

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8771
root = Path(__file__).resolve().parent / "app"
Handler = partial(SimpleHTTPRequestHandler, directory=str(root))
Handler.extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".wasm": "application/wasm", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".json": "application/json"}
server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
url = f"http://127.0.0.1:{port}/"
print(f"Form Filler is at {url}  (Ctrl+C to stop)")
threading.Timer(0.6, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
