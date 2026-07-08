# -*- coding: utf-8 -*-
"""启动冷库数字孪生服务器: python run.py [端口]"""
import sys
import threading
import webbrowser

import uvicorn

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8017

if __name__ == "__main__":
    threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    uvicorn.run("backend.server:app", host="127.0.0.1", port=PORT, log_level="info")
