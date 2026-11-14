const { PDFDocument, StandardFonts } = require('pdf-lib');

const spellHeader = [
  'Summon Brassy Glider', '2nd-level conjuration', 'Casting Time: 1 action',
  'Range: 40 feet', 'Components: V, S', 'Duration: 1 minute'
];
const statBlockLines = [
  'BRASSY GLIDER', 'Medium Construct, Unaligned', 'Armor Class 12 + spell level',
  'Hit Points 18 + 4 per spell level', 'Speed 20 ft., fly 40 ft.',
  'STR DEX CON INT WIS CHA', '12 (+1) 16 (+3) 10 (+0) 4 (-3) 8 (-1) 6 (-2)',
  'Senses darkvision 30 ft., passive Perception 9', 'Languages understands your commands',
  'Shared Charge. The glider emits harmless sparks.', 'ACTIONS',
  'Rend. Melee Weapon Attack: your spell attack modifier to hit.',
  'Hit: ld6 + 2 piercing damage.'
];
const continuationLines = [
  'You call a brassy glider into an open space.',
  'This construct uses the Brassy Glider stat block.',
  'It follows your commands until the spell ends.',
  'At Higher Levels. Its hit points increase by ld8.'
];

async function createSpellAccuracyPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const filler = Array.from({ length: 20 }, (_, i) => `Synthetic layout context ${i + 1}.`);
  const draw = (page, lines, x) => {
    let y = 750;
    for (const line of lines) {
      let offset = 0;
      for (const word of line.split(' ')) {
        const width = font.widthOfTextAtSize(word + ' ', 10);
        if (offset + width > 260) { y -= 17; offset = 0; }
        page.drawText(word, { x: x + offset, y, size: 10, font });
        offset += width;
      }
      y -= 17;
    }
  };
  const first = document.addPage([640, 800]);
  draw(first, filler, 35);
  draw(first, [...filler, ...spellHeader], 335);
  const second = document.addPage([640, 800]);
  draw(second, [...statBlockLines, ...continuationLines], 35);
  draw(second, ['Outside Range Spark', '1st-level evocation', 'Casting Time: 1 action', 'Range: 20 feet', 'Components: V', 'Duration: Instantaneous', 'This unselected spell must stay out of the result.', ...filler], 335);
  return document.save();
}

module.exports = { createSpellAccuracyPdf, spellHeader, statBlockLines, continuationLines };
