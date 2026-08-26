const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SessionJournal } = require('../src/session-journal');

test('persists transcript turns and errors while a session is active', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-session-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = new SessionJournal(root);
  const filePath = await journal.start(new Date('2026-08-24T10:00:00Z'));
  await journal.appendTurn({ channel: 'them', text: 'Обсудим договор.', ts: 123 });
  await journal.appendError({ provider: 'compatible', status: 503, message: 'Unavailable' });
  await journal.mark('finalizing');

  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(saved.status, 'finalizing');
  assert.deepEqual(saved.transcript, [{ channel: 'them', speaker: null, text: 'Обсудим договор.', ts: 123 }]);
  assert.equal(saved.errors[0].provider, 'compatible');
  assert.match(await fs.readFile(path.join(root, 'cue-errors.log'), 'utf8'), /Unavailable/);
});

test('recovers the latest incomplete session and ignores completed sessions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-session-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = new SessionJournal(root);
  await first.start(new Date('2026-08-24T10:00:00Z'));
  await first.appendTurn({ channel: 'you', text: 'Первая встреча', ts: 1 });
  await first.mark('completed');
  const second = new SessionJournal(root);
  const expectedPath = await second.start(new Date('2026-08-24T11:00:00Z'));
  await second.appendTurn({ channel: 'them', text: 'Незавершённая встреча', ts: 2 });

  const restored = await new SessionJournal(root).recoverLatest();
  assert.equal(restored.filePath, expectedPath);
  assert.equal(restored.data.transcript[0].text, 'Незавершённая встреча');
});

test('lists and securely loads incomplete sessions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-session-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = new SessionJournal(root);
  const filePath = await journal.start();
  await journal.appendTurn({ channel: 'them', text: 'Клиент', ts: 7 });
  const sessions = await journal.listIncomplete();
  assert.equal(sessions[0].turnCount, 1);
  assert.equal((await journal.load(filePath)).data.transcript[0].text, 'Клиент');
  await assert.rejects(journal.load(path.join(root, 'outside.json')), /outside/);
});

test('dismisses a recovery card without deleting its raw journal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-session-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = new SessionJournal(root);
  const filePath = await journal.start();
  await journal.appendTurn({ channel: 'them', text: 'Сохранённый RAW', ts: 9 });

  await journal.dismiss(filePath);

  assert.equal((await journal.listIncomplete()).length, 0);
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(saved.status, 'dismissed');
  assert.equal(saved.transcript[0].text, 'Сохранённый RAW');
});
