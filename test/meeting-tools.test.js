const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { searchCatalog, extractSection } = require('../src/meeting-catalog');
const { exportDocx, exportPdf } = require('../src/meeting-export');

test('indexes meetings and extracts tasks and decisions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-catalog-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'meeting.md');
  await fs.writeFile(source, '# Проект Альфа\n\nКлиент: Ромашка\nТеги: продажи, запуск\n\n## Решения\n- Запуск в пятницу\n\n## Задачи\n- Подготовить договор\n', 'utf8');
  const results = await searchCatalog(root, 'Ромашка договор');
  assert.equal(results.length, 1);
  assert.match(results[0].tasks, /договор/);
  assert.match(extractSection(await fs.readFile(source, 'utf8'), ['Решения']), /пятницу/);
});

test('exports meeting Markdown to non-empty DOCX and PDF files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-export-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'meeting.md');
  await fs.writeFile(source, '# Встреча\n\n## Решения\n- Проверить экспорт\n', 'utf8');
  const docx = await exportDocx(source);
  const pdf = await exportPdf(source);
  assert.ok((await fs.stat(docx)).size > 1000);
  assert.ok((await fs.stat(pdf)).size > 1000);
});
