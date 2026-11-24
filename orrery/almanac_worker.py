"""The almanac worker process: `python -m orrery.almanac_worker`.

One JSON request per line on stdin: {"t": <unix seconds>, "place": {...}}.
One JSON reply per line on stdout: [sun, moon, tonight]. Exits on EOF.

It exists so the ~100 ms of pure-Python searching never holds the app's GIL
(see Sky._request_almanac)."""

import json
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .almanac import compute_almanac


def main() -> None:
    for line in sys.stdin:
        try:
            req = json.loads(line)
            t = datetime.fromtimestamp(req["t"], timezone.utc)
            reply = compute_almanac(t, req["place"], ZoneInfo(req["place"]["tz"]))
        except Exception as e:  # never die on one bad request; the app falls back
            reply = {"error": repr(e)}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
