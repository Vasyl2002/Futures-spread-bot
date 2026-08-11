import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("ws")


class WSManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message, default=str)
        async with self._lock:
            connections = list(self._connections)
        for ws in connections:
            try:
                await ws.send_text(data)
            except Exception:
                await self.disconnect(ws)


ws_manager = WSManager()
