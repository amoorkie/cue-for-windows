"""Explicit setup only. Download pinned weights and verify published hashes."""
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
REPO = 'istupakov/gigaam-v3-onnx'
REVISION = '322c3b29492673eb7d0b434bfa9dfb8653e34d02'
FILES = ['config.json', 'v3_e2e_rnnt_vocab.txt', 'v3_e2e_rnnt_encoder.onnx',
         'v3_e2e_rnnt_decoder.onnx', 'v3_e2e_rnnt_joint.onnx']


def digest(file, lfs):
    value = hashlib.sha256() if lfs else hashlib.sha1()
    if not lfs:
        value.update(f'blob {file.stat().st_size}\0'.encode())
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def main():
    from huggingface_hub import HfApi, hf_hub_download
    folder = Path(sys.argv[1]).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    info = HfApi(token=False).model_info(REPO, revision=REVISION, files_metadata=True)
    metadata = {file.rfilename: file for file in info.siblings}
    verified = {}
    for name in FILES:
        item = metadata[name]
        expected = item.lfs.sha256 if item.lfs else item.blob_id
        destination = folder / name
        valid = destination.is_file() and destination.stat().st_size == item.size and digest(destination, item.lfs) == expected
        print(json.dumps({'message': f'{"Проверен" if valid else "Скачиваю"}: {name}'}), flush=True)
        if not valid:
            hf_hub_download(REPO, name, revision=REVISION, local_dir=folder, token=False, force_download=True)
        if destination.stat().st_size != item.size or digest(destination, item.lfs) != expected:
            raise ValueError(f'Контрольная сумма не совпала: {name}')
        verified[name] = expected
    (folder / 'cue-model.json').write_text(json.dumps({'repo': REPO, 'revision': REVISION, 'hashes': verified}, indent=2))
    print(json.dumps({'message': 'Файлы GigaAM скачаны и проверены.'}), flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
