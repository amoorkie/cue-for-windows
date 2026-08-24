const fs = require('fs/promises');
const path = require('path');

function extractTitle(markdown, fallback) {
  const match = String(markdown).match(/^#\s+(.+)$/m);
  return (match && match[1].trim()) || fallback;
}

function extractSection(markdown, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const lines = String(markdown).split(/\r?\n/);
  let collecting = false;
  const result = [];
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (collecting) break;
      collecting = wanted.has(heading[1].trim().toLowerCase());
      continue;
    }
    if (collecting) result.push(line);
  }
  return result.join('\n').trim();
}

function inferClient(markdown) {
  const explicit = String(markdown).match(/^(?:клиент|client)\s*:\s*(.+)$/im);
  if (explicit) return explicit[1].trim();
  const speaker = String(markdown).match(/\*\*(Клиент\s+\d+|Собеседник)\*\*/i);
  return speaker ? speaker[1] : '';
}

function inferTags(markdown) {
  const match = String(markdown).match(/^(?:теги|tags)\s*:\s*(.+)$/im);
  return match ? match[1].split(/[,#]/).map((tag) => tag.trim()).filter(Boolean) : [];
}

async function buildCatalog(directory) {
  await fs.mkdir(directory, { recursive: true });
  const names = (await fs.readdir(directory)).filter((name) => name.toLowerCase().endsWith('.md'));
  const items = [];
  for (const name of names) {
    const filePath = path.join(directory, name);
    try {
      const [markdown, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      items.push({
        filePath,
        title: extractTitle(markdown, path.basename(name, '.md')),
        client: inferClient(markdown),
        tags: inferTags(markdown),
        date: stat.mtime.toISOString(),
        text: markdown,
        tasks: extractSection(markdown, ['Задачи', 'Action items', 'Действия', 'Следующие шаги']),
        decisions: extractSection(markdown, ['Решения', 'Decisions', 'Принятые решения'])
      });
    } catch (_) {}
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

async function searchCatalog(directory, query = '') {
  const items = await buildCatalog(directory);
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = [item.title, item.client, item.tags.join(' '), item.text].join('\n').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).map(({ text, ...item }) => ({ ...item, snippet: text.replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').slice(0, 220) }));
}

module.exports = { buildCatalog, searchCatalog, extractSection };
