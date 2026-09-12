"""Offline GigaAM worker. JSON lines over private stdin/stdout; no HTTP server."""
import base64
import json
import os
from pathlib import Path
import sys
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    import numpy as np
    import onnxruntime as ort
    import onnx_asr

    folder = Path(sys.argv[1]).resolve()
    required = ['config.json', 'v3_e2e_rnnt_vocab.txt',
                'v3_e2e_rnnt_encoder.onnx', 'v3_e2e_rnnt_decoder.onnx', 'v3_e2e_rnnt_joint.onnx']
    for name in required:
        file = folder / name
        if not file.is_file() or not file.stat().st_size:
            raise ValueError(f'Не найден файл модели: {name}. Установите GigaAM в настройках.')
        if name.endswith('.onnx'):
            with file.open('rb') as stream:
                if stream.read(1) != b'\x08':
                    raise ValueError(f'Повреждён файл {name}. Установите рабочую копию GigaAM.')
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 2)
    options.inter_op_num_threads = 1
    model = onnx_asr.load_model('gigaam-v3-e2e-rnnt', folder,
                               providers=['CPUExecutionProvider'], sess_options=options)
    emit({'ready': True, 'model': 'GigaAM v3 E2E RNN-T', 'device': 'CPU'})
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 2_000_000:
                raise ValueError('Слишком большой фрагмент аудио.')
            request = json.loads(line)
            pcm = base64.b64decode(request['pcm'], validate=True)
            if len(pcm) % 2 or not 3200 <= len(pcm) <= 16000 * 2 * 20:
                raise ValueError('Ожидается PCM16 mono 16 kHz, от 0,1 до 20 секунд.')
            started = time.perf_counter()
            waveform = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
            text = model.recognize(waveform, sample_rate=16000)
            emit({'id': request['id'], 'text': text, 'elapsedMs': round((time.perf_counter() - started) * 1000)})
        except Exception as error:
            emit({'id': request.get('id'), 'error': str(error)})


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdin.reconfigure(encoding='utf-8')
    try:
        main()
    except Exception as error:
        emit({'fatal': str(error)})
        sys.exit(1)
