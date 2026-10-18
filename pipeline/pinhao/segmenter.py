"""A learned burned-area segmenter for the Pinhão drone footage, small enough to run live in a browser.

    python -m pipeline.pinhao.segmenter train      # fine-tune, evaluate on the held-out test split, export ONNX
    python -m pipeline.pinhao.segmenter eval       # re-evaluate the exported model (ONNX Runtime, as in the browser)

Model: LR-ASPP with a MobileNetV3-Large backbone (torchvision, pretrained on COCO), fine-tuned to one class, "burned or
burning ground", on the BurnedAreaUAV manual masks. 3.2 M parameters: ~13 ms per frame at 512×288 on a laptop GPU.
Split, by time so no test frame is near a training frame:
    train  frames 0 – 17 900   (180 annotated frames)
    val    frames 18 000 – 22 500 of the train/valid set (early stopping only)
    test   frames 20 250 – 22 450, the dataset's own test split (23 frames), never seen during training
The HSV baseline it replaces scored IoU 0.68 on the same masks (backend/firescope/segment.py).
"""
from __future__ import annotations

import json
import math
import random
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "data" / "raw" / "burnedareauav" / "BurnedAreaUAV_dataset"
CACHE = ROOT / "data" / "cache" / "pinhao"
OUT = ROOT / "data" / "processed" / "drone_replay_01"
MODEL_OUT = ROOT / "data" / "processed" / "models"
W, H = 512, 288                     # inference size (16:9, multiple of 32)
MEAN = np.array([0.485, 0.456, 0.406], "float32")
STD = np.array([0.229, 0.224, 0.225], "float32")
VAL_FROM = 18000


def load_split(split: str):
    """(frame number, RGB uint8 1280×720, mask uint8 0/1) for one dataset split, masks rasterised from the polygons."""
    jdir = DATASET / "JSON" / ("train_valid_json" if split == "train" else "test_json")
    fdir = DATASET / "PNG" / ("train" if split == "train" else "test") / "frames"
    out = []
    for jp in sorted(jdir.glob("frame_*.json")):
        d = json.loads(jp.read_text())
        n = int(jp.stem.split("_")[1])
        m = np.zeros((d["imageHeight"], d["imageWidth"]), np.uint8)
        for s in d["shapes"]:
            cv2.fillPoly(m, [np.round(np.array(s["points"])).astype(np.int32)], 1)
        img = cv2.cvtColor(cv2.imread(str(fdir / f"frame_{n:06d}.png")), cv2.COLOR_BGR2RGB)
        out.append((n, img, m))
    return out


def to_input(rgb: np.ndarray) -> np.ndarray:
    """RGB uint8 (any size) → normalised float32 NCHW at W×H, exactly what the browser does."""
    x = cv2.resize(rgb, (W, H), interpolation=cv2.INTER_AREA).astype("float32") / 255.0
    return ((x - MEAN) / STD).transpose(2, 0, 1)[None]


def iou(p, g):
    p, g = p.astype(bool), g.astype(bool)
    u = (p | g).sum()
    return float((p & g).sum() / u) if u else 1.0


def prf(p, g):
    p, g = p.astype(bool), g.astype(bool)
    tp, fp, fn = (p & g).sum(), (p & ~g).sum(), (~p & g).sum()
    return {"iou": float(tp / (tp + fp + fn + 1e-9)), "precision": float(tp / (tp + fp + 1e-9)), "recall": float(tp / (tp + fn + 1e-9))}


def build():
    import torch
    from torchvision.models.segmentation import LRASPP_MobileNet_V3_Large_Weights, lraspp_mobilenet_v3_large

    m = lraspp_mobilenet_v3_large(weights=LRASPP_MobileNet_V3_Large_Weights.COCO_WITH_VOC_LABELS_V1)
    # one output class: replace both heads of the LR-ASPP classifier
    m.classifier.low_classifier = torch.nn.Conv2d(m.classifier.low_classifier.in_channels, 1, 1)
    m.classifier.high_classifier = torch.nn.Conv2d(m.classifier.high_classifier.in_channels, 1, 1)
    return m


class Wrapped:
    """The exported graph: normalised image in, burned probability (0–1) at the input size out."""

    @staticmethod
    def make(model):
        import torch

        class Net(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.m = m

            def forward(self, x):
                return torch.sigmoid(self.m(x)["out"])
        return Net(model)


def augment(img, msk, rng):
    """Random scale/crop, flip, colour and blur — the footage is one flight, so the model must not memorise it."""
    h, w = img.shape[:2]
    s = rng.uniform(0.7, 1.0)
    ch, cw = int(h * s), int(w * s)
    y, x = rng.randint(0, h - ch), rng.randint(0, w - cw)
    img, msk = img[y:y + ch, x:x + cw], msk[y:y + ch, x:x + cw]
    if rng.random() < 0.5:
        img, msk = img[:, ::-1], msk[:, ::-1]
    img = cv2.resize(np.ascontiguousarray(img), (W, H), interpolation=cv2.INTER_AREA).astype("float32") / 255.0
    msk = cv2.resize(np.ascontiguousarray(msk), (W, H), interpolation=cv2.INTER_NEAREST).astype("float32")
    # brightness, contrast, saturation, hue-ish channel gains
    img = img * rng.uniform(0.75, 1.25) + rng.uniform(-0.08, 0.08)
    gray = img.mean(2, keepdims=True)
    img = gray + (img - gray) * rng.uniform(0.7, 1.3)
    img = img * np.array([rng.uniform(0.92, 1.08) for _ in range(3)], "float32")
    if rng.random() < 0.3:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.5, 1.5))
    img = np.clip(img, 0, 1)
    return ((img - MEAN) / STD).transpose(2, 0, 1), msk[None]


def train(epochs=60, seed=7):
    import torch
    import torch.nn.functional as F

    torch.manual_seed(seed); random.seed(seed); np.random.seed(seed)
    dev = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    data = load_split("train")
    test = load_split("test")
    tr = [d for d in data if d[0] < VAL_FROM - 100]       # 100-frame gap before validation
    va = [d for d in data if d[0] >= VAL_FROM]
    print(f"train {len(tr)}  val {len(va)}  test {len(test)}  on {dev}", flush=True)
    model = build().to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=4e-4, weight_decay=1e-4)
    steps = epochs * math.ceil(len(tr) / 8)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=4e-4, total_steps=steps, pct_start=0.1)
    rng = random.Random(seed)

    def evaluate(ds):
        model.eval()
        out = []
        with torch.no_grad():
            for n, img, msk in ds:
                p = torch.sigmoid(model(torch.from_numpy(to_input(img)).to(dev))["out"])[0, 0].cpu().numpy()
                p = cv2.resize(p, (msk.shape[1], msk.shape[0]), interpolation=cv2.INTER_LINEAR) > 0.5
                out.append(iou(p, msk))
        model.train()
        return float(np.mean(out))

    best, best_state, t0 = -1, None, time.time()
    for ep in range(epochs):
        rng.shuffle(tr)
        tot = 0
        for i in range(0, len(tr), 8):
            b = [augment(img, msk, rng) for _, img, msk in tr[i:i + 8]]
            x = torch.from_numpy(np.stack([a for a, _ in b])).to(dev)
            y = torch.from_numpy(np.stack([m for _, m in b])).to(dev)
            logit = model(x)["out"]
            p = torch.sigmoid(logit)
            dice = 1 - (2 * (p * y).sum((1, 2, 3)) + 1) / (p.sum((1, 2, 3)) + y.sum((1, 2, 3)) + 1)
            loss = F.binary_cross_entropy_with_logits(logit, y) + dice.mean()
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            tot += float(loss) * len(b)
        v = evaluate(va)
        if v > best:
            best, best_state = v, {k: t.detach().cpu().clone() for k, t in model.state_dict().items()}
        print(f"  epoch {ep + 1:2d}  loss {tot / len(tr):.3f}  val IoU {v:.3f}  ({time.time() - t0:.0f} s)", flush=True)
    model.load_state_dict(best_state)
    model = model.to("cpu").eval()
    MODEL_OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    torch.save(best_state, CACHE / "segmenter.pt")
    export(model)
    return best


def export(model):
    import torch
    net = Wrapped.make(model).eval()
    dest = MODEL_OUT / "burned-lraspp-mnv3.onnx"
    torch.onnx.export(net, torch.zeros(1, 3, H, W), str(dest), input_names=["image"], output_names=["burned"], opset_version=17,
                      dynamic_axes=None, dynamo=False)
    # fp16 weights halve the download; the graph still computes in fp32 on WASM (ORT upcasts) and fp16 on WebGPU
    print(f"exported {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


def session():
    import onnxruntime as ort
    return ort.InferenceSession(str(MODEL_OUT / "burned-lraspp-mnv3.onnx"), providers=["CPUExecutionProvider"])


def predict(sess, rgb: np.ndarray) -> np.ndarray:
    """Burned probability at W×H for one RGB frame."""
    return sess.run(None, {"image": to_input(rgb)})[0][0, 0]


def evaluate():
    sess = session()
    res = {}
    for split in ("train", "test"):
        ds = load_split(split)
        if split == "train":
            ds = [d for d in ds if d[0] >= VAL_FROM]
        rows = []
        for n, img, msk in ds:
            p = cv2.resize(predict(sess, img), (msk.shape[1], msk.shape[0]), interpolation=cv2.INTER_LINEAR) > 0.5
            rows.append({"frame": n, **prf(p, msk)})
        res["val" if split == "train" else "test"] = {k: round(float(np.mean([r[k] for r in rows])), 4) for k in ("iou", "precision", "recall")} | {"frames": len(rows)}
        print(split, res["val" if split == "train" else "test"])
    t = time.time()
    for _ in range(20):
        sess.run(None, {"image": np.zeros((1, 3, H, W), "float32")})
    res["cpu_ms_per_frame"] = round((time.time() - t) / 20 * 1000, 1)
    (CACHE / "segmenter_eval.json").write_text(json.dumps(res, indent=1))
    print(res)
    return res


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "train"
    if cmd == "train":
        train()
        evaluate()
    else:
        evaluate()
