# Pinhão: learned segmentation and the AI that runs in the browser

Offline steps for the Pinhão drone incident (phase 7). The app never runs them; it ships what they produce.

| Step | Command | Output |
|---|---|---|
| Fine-tune the burned-area segmenter | `python -m pipeline.pinhao.segmenter train` | `data/processed/models/burned-lraspp-mnv3.onnx` (13 MB) |
| Re-run the recorded pipeline with it | `cd backend && python -m firescope.pipeline` | `data/processed/drone_replay_01/*.json` |
| Frames for visual search | `python -m pipeline.pinhao.frames` | `data/cache/pinhao/frames/`, `visual_sprite.jpg` |
| Image vectors (both incidents) | `cd frontend && node scripts/ai/embed.mjs` | `visual_index.bin` + `.json` per incident |
| References for the live check | `python -m pipeline.pinhao.live_ref` | `data/cache/pinhao/live_ref*.npy` |

## The segmenter

- **Model:** LR-ASPP with a MobileNetV3-Large backbone (torchvision, pretrained on COCO), with one output class, "burned or burning ground". It has 3.2 M parameters, takes 512×288 input, and runs in 6 ms on CPU (ONNX Runtime) and 7 ms with WebGPU in the browser.
- **Training:**
  - **Data:** the BurnedAreaUAV hand-drawn polygons, rasterised.
  - **Augmentation:** random crops, flips, colour and blur.
  - **Loss and schedule:** BCE + Dice loss, 60 epochs, AdamW with a one-cycle schedule, about 7 min on an M5 Pro (MPS).
- **Split by time.** No test frame is close to a training frame:

| Set | Frames | Use |
|---|---|---|
| train | 0 – 17,900 (180) | fitting |
| validation | 18,000 – 22,500 (46) | choosing the epoch |
| test | 20,250 – 22,450 (23, the dataset's own test split) | reported only |

### Results

| | IoU | Precision | Recall |
|---|---|---|---|
| Raw per-frame mask, test split | **0.943** | 0.957 | 0.985 |
| Recorded pipeline (vote of 3 frames, largest regions, holes filled), held-out frames, image | **0.920** | 0.963 | 0.953 |
| Same, both projected onto the ground | **0.903** | | |
| Colour rules it replaces (all 226 frames) | 0.68 (image), 0.71 (ground) | 0.76 | 0.85 |

### Post-processing choices

**Temporal accumulation is dropped.** The colour-rule pipeline OR-ed masks over time, so ground never "unburned". With the learned mask that drops the held-out IoU from 0.92 to 0.87. The camera drifts during the flight, so masks accumulated in image space smear, and the model already outputs the whole burned area in each frame.

**Flames and smoke stay on the colour rules.** The dataset has no masks for them.

## The browser checks

The browser runs the same ONNX file on the published H.264 video. Over 22 frames, one every 40 s, its burned mask agrees at:
- **IoU 0.99** with Python on the same file;
- **IoU 0.98** with the recorded pipeline, which read the original recording.

The check is `frontend/scripts/audit/live.mjs`.

## Georeferencing error: not measured, and why

Two automatic attempts were made against the DGT Ortos 2018 orthophoto (25 cm, CC BY 4.0, a year before the burn), both matched with SIFT + RANSAC:
- the frames orthorectified with our camera model;
- the orthophoto rendered into the camera view.

Neither found reliable correspondences. The view is oblique from 25 m, half of it is smoke, and the near field is shrubland that changed in a year.

Picking points by hand gave two findings:
- **Bearing:** the bearings to the far track and the ruins match within about 2°.
- **Distance:** the model puts them at about half their distance. The gimbal pitch or the height of the photo pose (the source of the pose) likely differs during the video.

There is no ground control and the far features are too ambiguous, so no RMSE is claimed. The far field (above 21% of the frame) stays excluded.
