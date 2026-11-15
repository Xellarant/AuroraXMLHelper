// Original test prose, independent of the private source books.
function classChoiceSource() {
  const names = level => [
    ...(level === 1 ? ['Spellcasting', 'Mist Curse', 'Hexes'] : []),
    ...(level === 2 ? ['Familiar'] : []),
    ...([4, 8, 12, 16, 19].includes(level) ? ['Ability Score Improvement'] : []),
    ...([11, 13, 15, 18].includes(level) ? ['Grand Hex'] : [])
  ].join(', ') || '—';
  return [
    'The Mistkeeper',
    '| Level | Proficiency Bonus | Features | Hexes Known | Cantrips | Spells Known | 1st | 9th |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Array.from({ length: 20 }, (_, i) => {
      const level = i + 1;
      return '| ' + level + ' | +2 | ' + names(level) + ' | ' + (level < 5 ? 2 : 3)
        + ' | ' + (level < 4 ? 2 : 4) + ' | ' + (level < 5 ? 2 : 4) + ' | 2 | ' + (level < 17 ? '—' : 1) + ' |';
    }),
    'Class Features', 'As a mistkeeper, you gain the following class features.',
    'Hit Dice: 1d8 per mistkeeper level', 'Saving Throws: Wisdom, Charisma',
    'Skills: Choose two from Arcana and Survival',
    'Spellcasting', 'Charisma is your spellcasting ability for your spells.',
    'You know two spells. When you gain a level, you can replace one spell you know with another spell.',
    'Mist Curse', 'Choose the form of your curse from the options below.',
    'Ember. You learn the produce flame cantrip, which does not count against your cantrips known.',
    'Wanderer. You can move quietly when there is mist.',
    'Hexes', 'At 1st level, you gain two hexes of your choice, as shown in the Hexes Known column.',
    'When you gain a level, you can replace one hex you know with another hex.',
    'Familiar', 'At 2nd level, you learn the find familiar spell and can cast it as a ritual.',
    'Ability Score Improvement', 'When you reach 4th level, and again at 8th, 12th, 16th, and 19th level,',
    'you can increase one ability score by 2 or two ability scores by 1, to a maximum of 20.',
    'Grand Hex', 'By 11th level you learn one Grand Hex, and another at 13th, 15th, and 18th level.',
    'Hexes', 'The Hexes below are presented in alphabetical order.',
    'Fog Bell', 'As an action, you make a sound in the fog.',
    'Mist Anchor', 'You can anchor your familiar in a patch of mist.',
    'You must have the Familiar feature to choose this hex.',
    'Rain Shield', 'You can protect one creature from rain.',
    'Soft Steps', 'You can cross a puddle silently.',
    'Grand Hexes', 'The Grand Hexes below are presented in alphabetical order.',
    'Cloud Seat', 'You can rest on a small cloud.',
    'Deep Mist', 'You can make a bank of mist.',
    'Distant Bell', 'You can sound a bell in the distance.',
    'Fog House', 'You can shelter in a house of fog.',
    'Mistkeeper Subclasses', 'Cloud Guild', 'A separate subclass description.'
  ].join('\n');
}
module.exports = { classChoiceSource };
