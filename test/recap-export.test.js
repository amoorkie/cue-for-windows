const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { saveRecap } = require('../src/recap-export');

test('saves recap Markdown directly in the configured Cue Documents directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-recap-'));
  const outputDirectory = path.join(root, 'Cue Documents');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await saveRecap({
    outputDirectory,
    summary: '# Обсуждение запуска\n\nРешили выпустить обновление в пятницу.',
    transcript: [{ channel: 'them', text: 'Выпускаем в пятницу.', ts: Date.now() }]
  });

  assert.equal(path.dirname(result.filePath), path.resolve(outputDirectory));
  assert.match(result.fileName, /Обсуждение запуска\.md$/);
  const saved = await fs.readFile(result.filePath, 'utf8');
  assert.match(saved, /## Итог разговора/);
  assert.match(saved, /## Транскрипция/);
  assert.ok(saved.includes('- **Собеседник:** Выпускаем в пятницу.'));
});

test('requires an explicit output directory', async () => {
  await assert.rejects(
    saveRecap({ summary: 'Итог', transcript: [] }),
    /outputDirectory is required/
  );
});
