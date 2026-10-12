#!/usr/bin/env python3
"""Reproduce pinned local vision assets. Inference sends no card images.

The unmodified Cornelius model is AGPL-3.0; ONNX Runtime is MIT. Preserve
SOURCE.txt, both licenses and runtime notices when redistributing assets.
"""
import hashlib
import io
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "public/vendor/vision/cornelius-2.12-ort-1.30.0"
GPU_DEST = ROOT / "public/vendor/vision/ort-webgpu-1.30.0"
MODEL_REV = "42e9b8dca7ecb09edd13039332ef82620973d238"
MODEL_URL = f"https://huggingface.co/HanClinto/cornelius/resolve/{MODEL_REV}/cornelius-2.12.onnx"
MODEL_SHA = "650da3cc3e9ac778c6951de631f824ec1e63bdabf3aaa39a35d7435af625612e"
ORT_VERSION = "1.30.0"
ORT_URL = f"https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-{ORT_VERSION}.tgz"
ORT_SHA = "d2228df7e4616bc3348bf504ee888f3bec43789a273f0a63f3e68d203ce3bf71"
ORT_FILES = ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]
GPU_FILES = ["ort.webgpu.min.mjs", "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]


def download(url, sha):
    with urllib.request.urlopen(url, timeout=90) as response:
        data = response.read(40_000_001)
    if len(data) > 40_000_000 or hashlib.sha256(data).hexdigest() != sha:
        raise ValueError(f"Size or SHA256 mismatch for {url}")
    return data


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    GPU_DEST.mkdir(parents=True, exist_ok=True)
    model = DEST / "corners.onnx"
    if not model.exists() or hashlib.sha256(model.read_bytes()).hexdigest() != MODEL_SHA:
        model.write_bytes(download(MODEL_URL, MODEL_SHA))
    archive = download(ORT_URL, ORT_SHA)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for filename in ORT_FILES:
            (DEST / filename).write_bytes(tar.extractfile(f"package/dist/{filename}").read())
        for filename in GPU_FILES:
            (GPU_DEST / filename).write_bytes(tar.extractfile(f"package/dist/{filename}").read())
    expected = ["SOURCE.txt", "AGPL-3.0.txt", "ONNX-Runtime-LICENSE.txt", "ONNX-Runtime-ThirdPartyNotices.txt"]
    missing = [name for name in expected if not (DEST / name).is_file()]
    if missing:
        raise ValueError(f"Keep the tracked source/license package alongside these assets: {missing}")
    gpu_expected = ["SOURCE.txt", "ONNX-Runtime-LICENSE.txt", "ONNX-Runtime-ThirdPartyNotices.txt"]
    missing = [name for name in gpu_expected if not (GPU_DEST / name).is_file()]
    if missing:
        raise ValueError(f"Keep the tracked GPU source/license package alongside these assets: {missing}")
    print(f"Pinned local vision assets verified at {DEST}.")


if __name__ == "__main__":
    main()
