const fs = require('fs/promises');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const PDFDocument = require('pdfkit');

function cleanInline(value) { return String(value || '').replace(/[*_`~]/g, '').trim(); }
function parseMarkdown(markdown) {
  return String(markdown || '').split(/\r?\n/).map((line) => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return { type: 'heading', level: heading[1].length, text: cleanInline(heading[2]) };
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) return { type: 'bullet', text: cleanInline(bullet[1]) };
    return { type: 'text', text: cleanInline(line) };
  });
}
function exportBasePath(sourcePath, extension) {
  return path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.${extension}`);
}

async function exportDocx(sourcePath) {
  const markdown = await fs.readFile(sourcePath, 'utf8');
  const children = parseMarkdown(markdown).map((part) => {
    if (part.type === 'heading') return new Paragraph({ text: part.text, heading: [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2][part.level - 1] });
    if (part.type === 'bullet') return new Paragraph({ text: part.text, bullet: { level: 0 }, spacing: { after: 80 } });
    return new Paragraph({ children: [new TextRun({ text: part.text, font: 'Arial', size: 22 })], spacing: { after: part.text ? 100 : 40 } });
  });
  const document = new Document({ sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }] });
  const outputPath = exportBasePath(sourcePath, 'docx');
  await fs.writeFile(outputPath, await Packer.toBuffer(document));
  return outputPath;
}

async function exportPdf(sourcePath) {
  const markdown = await fs.readFile(sourcePath, 'utf8');
  const outputPath = exportBasePath(sourcePath, 'pdf');
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 54, right: 54, bottom: 54, left: 54 }, info: { Title: path.basename(sourcePath, '.md'), Creator: 'Cue' } });
    const stream = require('fs').createWriteStream(outputPath);
    stream.on('finish', resolve); stream.on('error', reject); doc.on('error', reject); doc.pipe(stream);
    const arial = process.platform === 'win32' ? 'C:\\Windows\\Fonts\\arial.ttf' : null;
    const arialBold = process.platform === 'win32' ? 'C:\\Windows\\Fonts\\arialbd.ttf' : null;
    if (arial) doc.registerFont('CueBody', arial);
    if (arialBold) doc.registerFont('CueBold', arialBold);
    for (const part of parseMarkdown(markdown)) {
      const bodyFont = arial ? 'CueBody' : 'Helvetica';
      const boldFont = arialBold ? 'CueBold' : 'Helvetica-Bold';
      if (part.type === 'heading') doc.font(boldFont).fontSize(part.level === 1 ? 22 : part.level === 2 ? 16 : 13).fillColor('#1f2937').text(part.text, { paragraphGap: 8 });
      else if (part.type === 'bullet') doc.font(bodyFont).fontSize(10.5).fillColor('#111827').text(`• ${part.text}`, { indent: 12, paragraphGap: 5 });
      else if (part.text) doc.font(bodyFont).fontSize(10.5).fillColor('#111827').text(part.text, { lineGap: 2, paragraphGap: 5 });
      else doc.moveDown(0.35);
    }
    doc.end();
  });
  return outputPath;
}

module.exports = { exportDocx, exportPdf, parseMarkdown };
