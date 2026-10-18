/** The in-browser models, pinned. Sizes are what the browser downloads the first time (then cached). */
export const CLIP_MODEL = 'Xenova/mobileclip_s0';
export const CLIP_REVISION = '757d59c9c6870a76a4b0306f05f5061bca15c39f';
/** folder under <site>/models/ (scripts/export-static.mjs puts the pinned files there) */
export const CLIP_LOCAL = 'mobileclip_s0';
/** text encoder (int8, 43 MB) + tokenizer (2 MB) + ONNX Runtime WebAssembly (7 MB compressed) */
export const CLIP_DOWNLOAD_MB = 52;
