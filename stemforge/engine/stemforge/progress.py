"""Progress reporting: human-readable lines, or JSON lines for the Ableton device."""

import json
import sys


class Reporter:
    def __init__(self, json_mode=False, stream=None):
        self.json_mode = json_mode
        self.stream = stream or sys.stdout

    def _emit(self, event, **fields):
        if self.json_mode:
            self.stream.write(json.dumps({"event": event, **fields}) + "\n")
        else:
            text = fields.get("message", "")
            if event == "progress":
                text = "[%3d%%] %s" % (fields["percent"], text)
            elif event == "error":
                text = "ERROR: " + text
            elif event == "done":
                text = "Done: " + fields["manifest"]
            self.stream.write(text + "\n")
        self.stream.flush()

    def progress(self, percent, message):
        self._emit("progress", percent=int(max(0, min(100, percent))), message=message)

    def log(self, message):
        self._emit("log", message=message)

    def done(self, manifest_path, song_dir):
        self._emit("done", manifest=str(manifest_path), song_dir=str(song_dir))

    def error(self, message):
        self._emit("error", message=message)
