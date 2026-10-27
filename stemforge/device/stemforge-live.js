// StemForge device, Max js side: creates one audio track per stem with the clip in slot 1.
// Receives (deferred to the low-priority thread): tempo <bpm> | stem <name> <path> <rgb> | built <n>
autowatch = 0;
inlets = 1;
outlets = 1;

function tempo(bpm) {
  new LiveAPI("live_set").set("tempo", bpm);
}

function stem(name, filePath, rgb) {
  var song = new LiveAPI("live_set");
  song.call("create_audio_track", -1);
  var index = song.getcount("tracks") - 1;
  var track = new LiveAPI("live_set tracks " + index);
  track.set("name", name);
  track.set("color", rgb);
  // ClipSlot.create_audio_clip needs Live 12; on older versions drag the stems in from the folder
  new LiveAPI("live_set tracks " + index + " clip_slots 0").call("create_audio_clip", filePath);
  outlet(0, "set", "Added " + name);
}

function built(count) {
  post("StemForge: added " + count + " stem tracks\n");
}
