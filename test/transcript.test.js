const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TranscriptLedger, speechRange, cleanSpeakerMarkers } = require('../src/transcript');
const { SessionJournal } = require('../src/session-journal');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const speech = 'Давайте обсудим сроки следующей встречи';
const you = { id: 'mic', channel: 'you', source: 'mic', text: speech, ts: 1000, endTs: 3500 };
const them = { id: 'system', channel: 'them', source: 'system', text: speech, ts: 900, endTs: 3400 };
test('echo attribution is independent of which STT request finishes first', () => {
  const results = [];
  for (const order of [[you, them], [them, you]]) {
    const ledger = new TranscriptLedger();
    for (const turn of order) ledger.append(turn);
    assert.equal(ledger.source.length, 2);
    assert.equal(ledger.turns.length, 1);
    assert.equal(ledger.turns[0].channel, 'them');
    results.push(ledger.turns);
  }
  assert.deepEqual(...results);
});
test('a delayed system result removes only the previously displayed echo', () => {
  const ledger = new TranscriptLedger(); ledger.append(you);
  const changes = ledger.append(them);
  assert.deepEqual(changes.removed, ['mic']);
  assert.equal(changes.upserts[0].id, 'system');
});
test('real repetitions, including by the same speaker, remain outside overlapping audio', () => {
  const ledger = new TranscriptLedger(); ledger.append(them);
  ledger.append({ ...you, ts: 4000, endTs: 6000 });
  ledger.append({ ...you, id: 'repeat', ts: 7000, endTs: 9000 });
  assert.equal(ledger.turns.length, 3);
});
test('mixed microphone speech retains the unique words and original punctuation', () => {
  const ledger = new TranscriptLedger();
  ledger.append({ ...you, text: speech + '. Я подготовлю расчёты, хорошо?' });
  ledger.append(them);
  assert.equal(ledger.turns.find(t => t.channel === 'you').text, 'Я подготовлю расчёты, хорошо?');
  assert.equal(ledger.source.find(t => t.channel === 'you').text, speech + '. Я подготовлю расчёты, хорошо?');
});
test('double talk with different words preserves both speakers', () => {
  const ledger = new TranscriptLedger(); ledger.append(them);
  ledger.append({ ...you, text: 'Подождите, я сейчас проверю календарь.' });
  assert.equal(ledger.turns.length, 2);
});
test('short ambiguous words and legacy turns are not destructively deduplicated', () => {
  const ledger = new TranscriptLedger();
  ledger.append({ ...them, text: 'Да' }); ledger.append({ ...you, text: 'Да' });
  assert.equal(ledger.turns.length, 2);
  ledger.reset([{ channel: 'you', text: speech, ts: 1000 }, { channel: 'them', text: speech, ts: 1000 }]);
  assert.equal(ledger.turns.length, 2);
});
test('mixed tagged and untagged API lines preserve all words', () => {
  assert.equal(cleanSpeakerMarkers('[SPEAKER_1] Встреча завтра.\nПришлю документы.\n[SPEAKER_2]: Спасибо.'), 'Встреча завтра.\nПришлю документы.\nСпасибо.');
});
test('speech timestamps exclude leading and trailing silence', () => {
  const pcm = Buffer.alloc(32000);
  for (let i = 6400; i < 19200; i += 2) pcm.writeInt16LE(2000, i);
  assert.deepEqual(speechRange(pcm, 1000), { ts: 1200, endTs: 1600 });
});
test('journal persists both source recognitions and the canonical transcript across recovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-reconcile-'));
  const ledger = new TranscriptLedger(); ledger.append(you); ledger.append(them);
  const journal = new SessionJournal(root); await journal.start();
  await journal.recordRecognition(ledger.source, ledger.turns, ledger.revision);
  const recovered = await new SessionJournal(root).recoverLatest();
  assert.equal(recovered.data.version, 2);
  assert.equal(recovered.data.sourceTranscript.length, 2);
  assert.equal(recovered.data.transcript.length, 1);
  const restored = new TranscriptLedger(); restored.reset(recovered.data.sourceTranscript);
  assert.deepEqual(restored.turns, ledger.turns);
});
