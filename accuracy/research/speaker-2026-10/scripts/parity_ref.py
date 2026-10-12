"""Parity checks of our JS port against the Apache-2.0 `transformers` reference code (copied below, torch only).

1. Front end: NemotronAsrStreamingFeatureExtractor (preemphasis, torch.stft, slaney mel, log guard) on the same audio.
2. Speaker cache: Nemotron3DiarizationSpeakerCache replayed with the JS run's own step logits; at every step the
   cached frames the reference would feed must equal the ones the JS fed.

    python parity_ref.py <audio.f32 raw 16k> <js_features.bin> <dump.json> <silence_embeds.bin> <mel_filters.bin>
"""
import json
import math
import sys

import numpy as np
import torch
from torch import nn

audio_f, feats_f, dump_f, silence_f, mel_f = sys.argv[1:6]

# ---------------- 1. front end (reference code, feature_extraction_nemotron_asr_streaming.py) ----------------
LOG_ZERO_GUARD_VALUE = 2**-24
x = torch.from_numpy(np.fromfile(audio_f, dtype="<f4")).float()[None, :]
mel_filters = torch.from_numpy(np.fromfile(mel_f, dtype="<f4").reshape(128, 257))  # librosa slaney, float32
pre = torch.cat([x[:, :1], x[:, 1:] - 0.97 * x[:, :-1]], dim=1)
window = torch.hann_window(400, periodic=False)
stft = torch.stft(pre, 512, hop_length=160, win_length=400, window=window, return_complex=True, pad_mode="constant", center=True)
mag = torch.view_as_real(stft)
mag = torch.sqrt(mag.pow(2).sum(-1)).pow(2)
mel = torch.log(mel_filters @ mag + LOG_ZERO_GUARD_VALUE).permute(0, 2, 1)[0]  # (frames, 128)
n_valid = x.shape[1] // 160
ref_feats = mel[:n_valid].numpy()
js_feats = np.fromfile(feats_f, dtype="<f4").reshape(-1, 128)
print(f"front end: frames ref {ref_feats.shape[0]} js {js_feats.shape[0]}; max |diff| {np.abs(ref_feats - js_feats).max():.2e}; "
      f"mean |diff| {np.abs(ref_feats - js_feats).mean():.2e} (feature range {ref_feats.min():.1f}..{ref_feats.max():.1f})")


# ---------------- 2. speaker cache (reference class, modeling_nemotron3_diarization.py; torch only) ----------------
class Cfg:
    fifo_length, speaker_cache_update_period = 264, 222  # streaming defaults; offline overrides below
    speaker_cache_length, speaker_cache_silence_frames_per_speaker = 264, 1
    prediction_score_threshold, latest_frames_score_boost = 0.25, 0.05
    num_speakers, subsampling_factor = 8, 8
    min_positive_scores_rate, strong_boost_rate, weak_boost_rate = 0.5, 0.75, 1.5


class SpeakerCache:
    def __init__(self, config, fifo_length=None, speaker_cache_update_period=None):
        self.fifo_length = fifo_length if fifo_length is not None else config.fifo_length
        self.speaker_cache_update_period = speaker_cache_update_period if speaker_cache_update_period is not None else config.speaker_cache_update_period
        self.speaker_cache_length = config.speaker_cache_length
        self.num_silence_frames = config.speaker_cache_silence_frames_per_speaker
        self.prediction_score_threshold = config.prediction_score_threshold
        self.latest_frames_score_boost = config.latest_frames_score_boost
        self.num_speakers = config.num_speakers
        self.subsampling_factor = config.subsampling_factor
        budget = self.speaker_cache_length // self.num_speakers - self.num_silence_frames
        self.min_positive_scores = math.floor(budget * config.min_positive_scores_rate)
        self.num_strong_boosted_frames = math.floor(budget * config.strong_boost_rate)
        self.num_weak_boosted_frames = math.floor(budget * config.weak_boost_rate)
        self.embeds = self.probs = self.fifo = None
        self.num_cache_frames = self.num_fifo_frames = 0
        self.is_compressed = self.is_initialized = False

    def lazy_initialization(self, chunk_embeds):
        b, _, h = chunk_embeds.shape
        self.embeds = torch.zeros(b, self.speaker_cache_length, h)
        self.probs = torch.zeros(b, self.speaker_cache_length, self.num_speakers)
        self.fifo = torch.zeros(b, self.fifo_length, h)
        self.is_initialized = True

    def get_embeds(self, chunk_embeds):
        if not self.is_initialized:
            self.lazy_initialization(chunk_embeds)
        return torch.cat([self.embeds[:, : self.num_cache_frames], self.fifo[:, : self.num_fifo_frames]], dim=1)

    def _pool_probs(self, logits, mask):
        f = self.subsampling_factor
        return nn.functional.avg_pool1d(logits.sigmoid().transpose(1, 2), f, f).transpose(1, 2).to(self.probs)

    def _num_popped_frames(self, n):
        if n <= self.fifo_length:
            return 0
        return min(max(self.speaker_cache_update_period, n - self.fifo_length), n)

    def update(self, chunk_input_embeds, chunk_logits, silence_embeds, num_chunk_frames, mask=None):
        if not self.is_initialized:
            self.lazy_initialization(chunk_input_embeds)
        num_cache_frames, num_fifo_frames = self.num_cache_frames, self.num_fifo_frames
        probs = self._pool_probs(chunk_logits, mask)
        chunk_start = num_cache_frames + num_fifo_frames
        chunk_embeds = chunk_input_embeds[:, chunk_start : chunk_start + num_chunk_frames]
        fifo_embeds = torch.cat([self.fifo[:, :num_fifo_frames], chunk_embeds], dim=1)
        num_popped = self._num_popped_frames(fifo_embeds.shape[1])
        if num_popped:
            fifo_probs = probs[:, num_cache_frames : num_cache_frames + fifo_embeds.shape[1]]
            stored_probs = self.probs[:, :num_cache_frames] if self.is_compressed else probs[:, :num_cache_frames]
            cache_embeds = torch.cat([self.embeds[:, :num_cache_frames], fifo_embeds[:, :num_popped]], dim=1)
            cache_probs = torch.cat([stored_probs, fifo_probs[:, :num_popped]], dim=1)
            fifo_embeds = fifo_embeds[:, num_popped:]
            if cache_embeds.shape[1] > self.speaker_cache_length:
                cache_embeds, cache_probs = self._compress(cache_embeds, cache_probs, silence_embeds)
                self.is_compressed = True
            self.num_cache_frames = cache_embeds.shape[1]
            idx = torch.arange(self.num_cache_frames)
            self.embeds.index_copy_(1, idx, cache_embeds)
            self.probs.index_copy_(1, idx, cache_probs)
        self.num_fifo_frames = fifo_embeds.shape[1]
        self.fifo.index_copy_(1, torch.arange(self.num_fifo_frames), fifo_embeds)

    def _get_frame_scores(self, probs):
        thr = self.prediction_score_threshold
        lp = torch.log(probs.clamp(min=thr))
        lc = torch.log((1.0 - probs).clamp(min=thr))
        scores = lp - lc + lc.sum(dim=-1, keepdim=True) - math.log(0.5)
        is_speech = probs > 0.5
        scores = scores.masked_fill(~is_speech, float("-inf"))
        is_positive = scores > 0
        enough = is_positive.sum(dim=1, keepdim=True) >= self.min_positive_scores
        return scores.masked_fill(~is_positive & is_speech & enough, float("-inf"))

    def _boost_scores(self, scores, n, boost):
        _, ti = torch.topk(scores, n, dim=1, sorted=False)
        return scores.scatter_add(1, ti, scores.new_full(ti.shape, boost))

    def _compress(self, embeds, probs, silence_embeds):
        b, nf, ns = probs.shape
        scores = self._get_frame_scores(probs)
        scores[:, self.speaker_cache_length :] += self.latest_frames_score_boost
        scores = self._boost_scores(scores, self.num_strong_boosted_frames, boost=-2.0 * math.log(0.5))
        scores = self._boost_scores(scores, self.num_weak_boosted_frames, boost=-math.log(0.5))
        scores = nn.functional.pad(scores, (0, 0, 0, self.num_silence_frames), value=float("inf"))
        embeds = torch.cat([embeds, silence_embeds.view(1, 1, -1).expand(b, 1, -1)], dim=1)
        probs = nn.functional.pad(probs, (0, 0, 0, 1))
        nsf = nf + self.num_silence_frames
        sentinel = nsf * ns
        flat = scores.transpose(1, 2).reshape(b, -1)
        ts, ti = torch.topk(flat, self.speaker_cache_length, dim=1, sorted=False)
        ti = ti.masked_fill(ts == float("-inf"), sentinel)
        ti, _ = torch.sort(ti, dim=1)
        fi = torch.where(ti == sentinel, nf, (ti % nsf).clamp(max=nf))
        bi = torch.arange(b)[:, None]
        return embeds[bi, fi], probs[bi, fi]


dump = json.load(open(dump_f))
silence = torch.from_numpy(np.fromfile(silence_f, dtype="<f4"))
cache = SpeakerCache(Cfg, fifo_length=40, speaker_cache_update_period=300)  # offline sizes
worst = 0.0
for k, st in enumerate(dump["steps"]):
    inp = torch.tensor(st["input"], dtype=torch.float32).view(1, st["inputRows"], 512)
    js_cached = inp[:, : st["cached"]]
    ref_cached = cache.get_embeds(inp[:, st["cached"] :])
    if ref_cached.shape[1] != js_cached.shape[1]:
        print(f"step {k}: cached length differs (ref {ref_cached.shape[1]} vs js {js_cached.shape[1]})"); sys.exit(1)
    diff = (ref_cached - js_cached).abs().max().item() if ref_cached.shape[1] else 0.0
    if ref_cached.shape[1]:
        rowdiff = (ref_cached - js_cached).abs().amax(dim=-1)[0]
        bad = (rowdiff > 1e-6).nonzero().flatten().tolist()
        if bad:
            # which input rows (frames) does each side hold at the differing slots?
            def find(rowvec):
                for j in range(prev_inp.shape[1]):
                    if torch.equal(prev_inp[0, j], rowvec): return j
                return -1 if not torch.equal(rowvec, silence) else 'silence'
            print('   differing slots', bad[:8], '... ref frames', [find(ref_cached[0, i]) for i in bad[:4]], 'js frames', [find(js_cached[0, i]) for i in bad[:4]])
    worst = max(worst, diff)
    logits = torch.tensor(st["logits"], dtype=torch.float32).view(1, st["inputRows"] * 8, 8)
    cache.update(inp, logits, silence, st["chunk"])
    prev_inp = inp
    print(f"step {k}: cached frames {st['cached']:4d} (ref {ref_cached.shape[1]:4d}), max |diff| {diff:.2e}, compressed {cache.is_compressed}")
print(f"speaker cache: worst difference over {len(dump['steps'])} steps = {worst:.2e}")
