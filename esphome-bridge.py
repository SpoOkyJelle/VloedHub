import asyncio
import json
import urllib.request
import urllib.error
from aioesphomeapi import APIClient

ESPHOME_HOST = "192.168.178.136"
ESPHOME_PORT = 6053
ESPHOME_PASSWORD = ""
SERVER_URL = "http://localhost:5000/api/esphome"
POST_INTERVAL = 30  # seconds between pushes

latest = {}  # key: entity_key, value: {name, value, unit}

async def main():
    cli = APIClient(ESPHOME_HOST, ESPHOME_PORT, password=ESPHOME_PASSWORD)
    await cli.connect(login=True)

    entities, _ = await cli.list_entities_services()
    key_to_entity = {e.key: e for e in entities}

    def on_state(state):
        entity = key_to_entity.get(state.key)
        if entity is None:
            return
        value = getattr(state, "state", None)
        if value is None:
            return
        unit = getattr(entity, "unit_of_measurement", "") or ""
        latest[state.key] = {
            "name": entity.name,
            "value": float(value) if isinstance(value, (int, float)) else value,
            "unit": unit,
        }

    cli.subscribe_states(on_state)

    device_name = (await cli.device_info()).name

    while True:
        await asyncio.sleep(POST_INTERVAL)
        if not latest:
            continue
        payload = json.dumps({
            "device": device_name,
            "sensors": list(latest.values()),
        }).encode("utf-8")
        req = urllib.request.Request(
            SERVER_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                print(f"[ESPHome] Posted {len(latest)} sensors → {resp.status}")
        except urllib.error.URLError as e:
            print(f"[ESPHome] POST failed: {e}")

asyncio.run(main())
