const { PDFDocument, StandardFonts } = require('pdf-lib');

// Original synthetic content: no excerpts or embedded source-book fonts.
async function createClassLayoutPdf() {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.TimesRoman);
  const header = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const text = (str, x, y, font = body, size = 10) => page.drawText(str, { x, y, font, size });
  text('The Wayfinder', 54, 740, header, 14);
  text('Proficiency', 94, 720, header, 8);
  text('Spells', 320, 720, header, 8);
  [['Level', 54], ['Bonus', 94], ['Features', 145], ['Known', 320], ['1st', 380], ['2nd', 430], ['9th', 480]].forEach(([label, x]) => text(label, x, 708, header, 8));
  for (let level = 1; level <= 20; level++) {
    const ordinal = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
    const feature = level === 1 ? 'Trail Lore, Spellcasting' : level === 2 ? 'Travelers Guild' : '-';
    [[`${level}${ordinal}`, 54], ['+2', 94], [feature, 145], ['3', 320], ['2', 380], ['-', 430], [level === 20 ? '1' : '-', 480]]
      .forEach(([value, x]) => text(value, x, 694 - (level - 1) * 11, header, 8));
  }
  const left = [
    'Class Features', 'As a wayfinder, you gain the following class features.',
    'Hit Points', 'Hit Dice: 1d8 per wayfinder level',
    'Hit Points at 1st Level: 8 + Constitution modifier', 'Proficiencies',
    'Armor: Light armor', 'Weapons: Simple weapons,', 'shortswords, and whips', 'Tools: None',
    'Saving Throws: Wisdom, Dexterity', 'Skills: Choose three from Arcana, Nature,', 'Stealth, and Survival',
    'Equipment', 'You start with a copper compass', 'and a walking staff.',
    'Trail Lore', 'You can follow tracks through harmless mist.'
  ];
  left.forEach((line, i) => text(line, 54, 450 - i * 15));
  const right = ['Spellcasting', 'Wisdom is your spellcasting ability.', 'Spell Slots',
    'You regain expended slots after a long rest.', ...Array.from({ length: 12 }, (_, i) => `A synthetic spellcasting rule paragraph ${i}.`)];
  right.forEach((line, i) => text(line, 320, 450 - i * 15));
  const second = pdf.addPage([612, 792]);
  ['Travelers Guild', 'At 2nd level, you choose a travelers guild.', 'Your guild helps you travel safely.',
    'Wayfinder Subclasses', 'Copper Guild', 'This subclass is outside the base class.'].forEach((line, i) => second.drawText(line, { x: 54, y: 720 - i * 16, size: 10, font: body }));
  return pdf.save();
}

module.exports = { createClassLayoutPdf };
