"""Optional zero-shot classifier used to supplement keyword classification.

Inference runs locally. The model weights are downloaded from the Hugging Face
Hub the first time a document is classified, then cached and reused offline.
Set KIROKU_DISABLE_ML=1 to skip the model entirely and use keywords only.

This classifier must never hold up an import. Even with the weights cached,
Transformers contacts the Hub to revalidate them, so the timeouts below are kept
short and a single failure disables the model for the rest of the process:
importing a document has to work the same offline as on.
"""

from __future__ import annotations

import logging
import os
import platform
import threading
from typing import Optional, Tuple

# Must be set before huggingface_hub is imported. Defaults are 10s per request,
# which an unreachable Hub turns into a hang on the import path.
os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "2")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "5")

log = logging.getLogger("kiroku.ai_engine")

_ENGINE_INSTANCE: Optional[LocalAiEngine] = None


class LocalAiEngine:
    """Loads a zero-shot classification pipeline in the background, if it can.

    The load is never awaited. Classification is an enhancement on top of keyword
    matching, so a slow or unreachable Hub must not stall a document import —
    callers get None until the model is ready, and forever if it never loads.
    """

    def __init__(self):
        self.enabled = os.environ.get("KIROKU_DISABLE_ML", "") not in ("1", "true", "True")
        self.device = self._detect_device()
        self._hf_classifier = None
        self._load_started = False

    @staticmethod
    def _detect_device() -> str:
        """Return the torch device string for the classification pipeline."""
        try:
            import torch
            if torch.backends.mps.is_available() and platform.processor() == "arm":
                return "mps"
            if torch.cuda.is_available():
                return "cuda"
        except Exception as e:
            log.debug("Device detection failed, using CPU: %s", e)
        return "cpu"

    def _load(self) -> None:
        """Build the pipeline. Runs on a worker thread; failure disables the model."""
        model_name = os.environ.get("HF_CLASSIFIER_MODEL", "typeform/distilbert-base-uncased-mnli")
        try:
            from transformers import pipeline
            log.info("Loading classifier %s in the background", model_name)
            self._hf_classifier = pipeline(
                "zero-shot-classification",
                model=model_name,
                device=self.device if self.device != "cpu" else -1,
            )
            log.info("Classifier ready")
        except Exception as e:
            self.enabled = False
            log.warning("Classifier unavailable, using keywords only: %s", e)

    def classify(self, text: str) -> Optional[Tuple[str, float]]:
        """Return (doc_type, confidence), or None when the model is not ready.

        Kicks off the load on first use and returns None straight away; documents
        imported before the model is warm are classified by keyword alone.
        """
        if not self.enabled or not text or len(text.strip()) < 15:
            return None

        if not self._load_started:
            self._load_started = True
            threading.Thread(target=self._load, name="kiroku-classifier", daemon=True).start()

        classifier = self._hf_classifier
        if classifier is None:
            return None

        try:
            labels = ["invoice", "receipt", "utility bill", "credit note"]
            result = classifier(text[:1000], labels)
            label = result["labels"][0]
            if "bill" in label:
                label = "bill"
            elif "note" in label:
                label = "credit_note"
            return label, float(result["scores"][0])
        except Exception as e:
            self.enabled = False
            log.warning("Classification failed, using keywords from now on: %s", e)
            return None


def get_ai_engine() -> LocalAiEngine:
    """Return the process-wide engine, creating it on first use."""
    global _ENGINE_INSTANCE
    if _ENGINE_INSTANCE is None:
        _ENGINE_INSTANCE = LocalAiEngine()
    return _ENGINE_INSTANCE
