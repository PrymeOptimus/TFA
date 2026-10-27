"""Pick the compute device and the quality tier it can handle."""

import platform


def detect():
    """Return {"device": "cuda"|"mps"|"cpu", "name": str}."""
    try:
        import torch
    except ImportError:
        return {"device": "cpu", "name": platform.processor() or "CPU"}
    if torch.cuda.is_available():
        return {"device": "cuda", "name": torch.cuda.get_device_name(0)}
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return {"device": "mps", "name": "Apple GPU"}
    return {"device": "cpu", "name": platform.processor() or "CPU"}


def resolve_quality(quality, device):
    """'auto' means best on a GPU and fast on CPU, where RoFormer runs ~10x real time."""
    if quality != "auto":
        return quality
    return "best" if device in ("cuda", "mps") else "fast"
