import asyncio
import json
import urllib.request
import urllib.error
from aioesphomeapi import APIClient

ESPHOME_HOST = "192.168.178.136"
ESPHOME_PORT = 6053
ESPHOME_PASSWORD = ""
SERVER_URL = "http://192.168.178.10:5000/api/esphome"
POST_INTERVAL = 5  # seconds between pushes

latest = {}  # key: entity_key, value: {name, value, unit}

async def main():
    print(f"[ESPHome] Connecting to {ESPHOME_HOST}:{ESPHOME_PORT}...")
    cli = APIClient(ESPHOME_HOST, ESPHOME_PORT, password=ESPHOME_PASSWORD)
    await cli.connect(login=True)
    print("[ESPHome] Connected.")

    entities, _ = await cli.list_entities_services()
    print(f"[ESPHome] Found {len(entities)} entities: {[e.name for e in entities]}")
    key_to_entity = {e.key: e for e in entities}

    device_name = getattr(entities[0], "device_id", None) or ESPHOME_HOST

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
        print(f"[ESPHome] {entity.name} = {value}{unit}")

    cli.subscribe_states(on_state)
    print(f"[ESPHome] Subscribed to states. Posting every {POST_INTERVAL}s to {SERVER_URL}")

    while True:
        await asyncio.sleep(POST_INTERVAL)
        if not latest:
            print("[ESPHome] No sensor data yet, skipping POST.")
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
                print(f"[ESPHome] Posted {len(latest)} sensors → HTTP {resp.status}")
        except urllib.error.URLError as e:
            print(f"[ESPHome] POST failed: {e}")

asyncio.run(main())
