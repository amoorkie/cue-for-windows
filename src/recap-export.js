const fs = require('fs/promises');
const path = require('path');

const GENERIC_TITLE = /^(итог(и)?( созвон(а|у)?| разговора)?|резюме|summary|recap|ключевые моменты|основные темы|тема разговора)\s*[:.!-]?$/i;

function stripMarkdown(value) {
  return String(value || '')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(value, max = 90) {
  if (value.length <= max) return value;
  const clipped = value.slice(0, max - 1).replace(/\s+\S*$/, '').trim();
  return (clipped || value.slice(0, max - 1)).trim() + '…';
}

function safeTitle(value) {
  return shorten(stripMarkdown(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()) || 'Созвон';
}

function extractTitle(summary, transcript) {
  const lines = String(summary || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  if (heading) {
    const value = safeTitle(heading.replace(/^#{1,6}\s+/, ''));
    if (!GENERIC_TITLE.test(value)) return value;
  }
  for (const line of lines) {
    const value = safeTitle(line.replace(/^(тема|название|topic)\s*:\s*/i, ''));
    if (value && !GENERIC_TITLE.test(value) && value.length >= 8) return value;
  }
  const firstTurn = transcript && transcript.find((turn) => turn && turn.text);
  if (firstTurn) return shorten(safeTitle(firstTurn.text));
  return 'Созвон';
}

function removeLeadingTitle(summary) {
  const lines = String(summary || '').split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim());
  if (index >= 0 && /^#{1,6}\s+/.test(lines[index].trim())) lines.splice(index, 1);
  return lines.join('\n').replace(/^\s+/, '').trim();
}

function formatTranscript(transcript) {
  return (transcript || [])
    .filter((turn) => turn && turn.text && turn.text.trim())
    .map((turn) => `- **${turn.speaker || (turn.channel === 'them' ? 'Собеседник' : 'Вы')}:** ${turn.text.trim().replace(/\r?\n/g, ' ')}`)
    .join('\n');
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

async function uniquePath(directory, baseName) {
  let candidate = path.join(directory, `${baseName}.md`);
  let suffix = 2;
  while (true) {
    try { await fs.access(candidate); candidate = path.join(directory, `${baseName} (${suffix++}).md`); }
    catch (error) { if (error.code === 'ENOENT') return candidate; throw error; }
  }
}

async function saveRecap({ outputDirectory, summary, transcript }) {
  if (!outputDirectory) throw new Error('outputDirectory is required.');
  const directory = path.resolve(outputDirectory);
  await fs.mkdir(directory, { recursive: true });
  const title = extractTitle(summary, transcript);
  const filePath = await uniquePath(directory, `${timestamp()} — ${title}`);
  const recap = removeLeadingTitle(summary) || 'Итог не сформирован.';
  const transcriptMarkdown = formatTranscript(transcript);
  const content = [
    `# ${title}`, '', `> Созвон завершён ${new Date().toLocaleString('ru-RU')}`, '',
    '## Итог разговора', '', recap,
    transcriptMarkdown ? ['', '## Транскрипция', '', transcriptMarkdown].join('\n') : '', ''
  ].join('\n');
  await fs.writeFile(filePath, content, 'utf8');
  return { filePath, fileName: path.basename(filePath), title };
}

async function saveTranscriptFallback({ outputDirectory, transcript, reason = 'Сырой текст сохранён до генерации итога.' }) {
  if (!outputDirectory) throw new Error('outputDirectory is required.');
  const directory = path.resolve(outputDirectory);
  await fs.mkdir(directory, { recursive: true });
  const title = extractTitle('', transcript);
  const filePath = await uniquePath(directory, `${timestamp()} — RAW — ${title}`);
  const transcriptMarkdown = formatTranscript(transcript);
  const content = [
    `# ${title}`, '', `> Сырая расшифровка сохранена ${new Date().toLocaleString('ru-RU')}`, '',
    `> ${reason}`, '', '## Транскрипция', '', transcriptMarkdown || '_Речь не распознана._', ''
  ].join('\n');
  await fs.writeFile(filePath, content, 'utf8');
  return { filePath, fileName: path.basename(filePath), title };
}

module.exports = { saveRecap, saveTranscriptFallback };
