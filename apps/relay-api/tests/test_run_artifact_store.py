from __future__ import annotations

import hashlib
import io
from uuid import uuid4

import pytest

from relay_backend.document_store import MAX_RUN_SCREENSHOT_BYTES, S3RunArtifactStore
from relay_backend.errors import InternalPersistenceError


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], tuple[bytes, str]] = {}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, ContentType: str) -> None:
        self.objects[(Bucket, Key)] = (Body, ContentType)

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        body, content_type = self.objects[(Bucket, Key)]
        return {"Body": io.BytesIO(body), "ContentType": content_type}


def test_run_artifact_store_publishes_and_reads_immutable_webp() -> None:
    client = FakeS3Client()
    store = S3RunArtifactStore(client, bucket="relay-workflows")
    namespace_id = uuid4()
    run_id = uuid4()
    image = b"RIFF-safe-terminal-webp"

    object_key = store.put(namespace_id=namespace_id, run_id=run_id, body=image)

    assert object_key == (
        f"run-artifacts/{namespace_id}/{run_id}/{hashlib.sha256(image).hexdigest()}.webp"
    )
    assert client.objects[("relay-workflows", object_key)] == (image, "image/webp")
    restarted_store = S3RunArtifactStore(client, bucket="relay-workflows")
    assert restarted_store.get(object_key) == image


@pytest.mark.parametrize("body", [b"", b"x" * (MAX_RUN_SCREENSHOT_BYTES + 1)])
def test_run_artifact_store_rejects_empty_or_oversized_images(body: bytes) -> None:
    store = S3RunArtifactStore(FakeS3Client(), bucket="relay-workflows")

    with pytest.raises(InternalPersistenceError):
        store.put(namespace_id=uuid4(), run_id=uuid4(), body=body)
