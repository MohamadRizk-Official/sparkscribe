# Audio decoding (`src/audio.js`)

Turns any audio or video file into what the speech models expect: **16 kHz mono Float32 samples** (`SAMPLE_RATE = 16000`). `decodeToMono16k(file, onStatus, { forceFFmpeg })` returns `{ samples, duration }`. Browser only (it uses `<audio>`, `AudioContext` and a WebAssembly FFmpeg), so it has no unit test; `peaks` is covered by `tests/audio-peaks-test.mjs`.

## Which path is used
```
probeDuration(file)  → seconds, or null if the browser can't read the header
fast path  if  !forceFFmpeg  and  duration known  and  duration <= 15 min  and  size <= 40 MB
otherwise  FFmpeg path
```
- **Fast path** (`decodeWithBrowser`): the browser's own `decodeAudioData`, then an `OfflineAudioContext` at 16 kHz with one channel, which resamples and mixes down. It unpacks the whole file into memory at once, so it is only used for short files and codecs the browser ships.
- If the fast path throws, the error is only logged (`console.warn`) and the FFmpeg path runs instead. The user never sees a fast-path failure.
- **Robust path**: FFmpeg compiled to WebAssembly handles every format and streams the conversion, so an hour-long voice message is fine.

## `probeDuration`
Asks a temporary `<audio preload="metadata">` element for the duration without decoding the file. It resolves `null` on an error, when the duration is not finite, or after **6 seconds**, and always releases the object URL.

## The FFmpeg path
- **One-time download**: about 31 MB of WebAssembly (about 9 MB over the network when compressed). `getFFmpeg` loads `ffmpeg-core.js` and `ffmpeg-core.wasm` from the site's own `/ffmpeg` folder with progress, then starts it with a **90 second** limit (compiling ~32 MB of WebAssembly can be slow on a weak device, but not forever). The loaded converter is cached in a module variable, so later files reuse it; a failed load clears the cache so the next try starts clean.
- A stalled download is reported as "The audio converter couldn't load: …" with the hint that recordings under 15 minutes in MP3, WAV, M4A or WebM usually don't need it.
- **Input**: the file is mounted straight from disk (`WORKERFS`), so a 1 GB video is not copied into memory first. Browsers without it fall back to writing one in-memory copy (`in.<ext>`).
- **Command**: `-i <input> -vn -ac 1 -ar 16000 -f f32le out.f32`: drop video, mono, 16 kHz, raw 32-bit float samples (no WAV header to parse).
- **Output**: the bytes are viewed in place as a `Float32Array` when aligned to four bytes (no second copy, which would be ~230 MB per hour of audio); otherwise a trimmed copy is made.
- **Failures**: a non-zero exit code is "FFmpeg could not read this file (exit code N)."; zero samples is "FFmpeg produced no audio. Is there an audio track in this file?"
- **Cleanup**: in `finally`, the mount (or the written input) and `out.f32` are removed and the progress listener detached.

Progress is shown as `Converting audio… NN%`, only for the conversion that is currently running (`busyFF`), so a cancelled conversion never updates the screen of the next file.

## Cancelling: `abortDecode()`
Terminates the running FFmpeg worker (if any) and clears the cached converter, because a terminated worker cannot be reused. The next file loads a fresh one, usually from the HTTP cache. The interrupted decode rejects with an error whose `code` is `cancelled` ("Cancelled."), so callers can tell it from a real failure.

## `peaks(samples, n = 400)`
Reduces the samples to `n` values for drawing a waveform. Each value is the largest absolute sample in its block; the block size is `floor(length / n)` and never below 1. Consequences: a very short clip fills the first values and leaves the rest at 0, and a few samples left over after the last full block are not drawn.
