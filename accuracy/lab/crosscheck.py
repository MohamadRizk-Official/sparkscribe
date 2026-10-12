"""Reference values from pyannote.metrics for the lab's metric cross-check.

Reads cases (JSON) written by accuracy/lab/crosscheck.mjs and prints, per case, pyannote's DER components and JER.
Needs only pyannote.metrics (tested with 4.1) in a SEPARATE Python environment; nothing here is used by the app.

    python -m venv <dir> && <dir>/Scripts/python -m pip install pyannote.metrics==4.1
    <dir>/Scripts/python accuracy/lab/crosscheck.py cases.json > pyannote.json
"""
import json
import sys
import warnings

from pyannote.core import Annotation, Segment
from pyannote.metrics.diarization import DiarizationErrorRate, JaccardErrorRate

warnings.filterwarnings("ignore")  # "uem was approximated by the union of reference and hypothesis extents"


def annotation(segments):
    a = Annotation()
    for i, (start, end, label) in enumerate(segments):
        a[Segment(start, end), f"t{i}"] = label
    return a


out = []
for case in json.load(open(sys.argv[1], encoding="utf-8")):
    ref, hyp = annotation(case["ref"]), annotation(case["hyp"])
    opts = dict(collar=case.get("collar", 0.0), skip_overlap=case.get("skipOverlap", False))
    d = DiarizationErrorRate(**opts)(ref, hyp, detailed=True)
    j = JaccardErrorRate(**opts)(ref, hyp) if len(ref.labels()) else None
    out.append({
        "name": case["name"],
        "total": d["total"], "missed": d["missed detection"], "falseAlarm": d["false alarm"],
        "confusion": d["confusion"], "correct": d["correct"],
        "der": d["diarization error rate"] if d["total"] else None,
        "jer": j,
    })
json.dump(out, sys.stdout)
