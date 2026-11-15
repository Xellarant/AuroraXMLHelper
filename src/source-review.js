(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AuroraSourceReview = api;
    if (root.window) root.window.AuroraSourceReview = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const key = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const compact = value => key(value).replace(/\s/g, '');
  const heading = value => String(value || '').trim().replace(/^#{1,6}\s*/, '')
    .replace(/^(?:Feat|Background|Race|Species|Class|Subclass|Archetype|Feature)\s*:\s*/i, '')
    .replace(/^Level\s+\d+\s*[:;.]\s*/i, '').replace(/\s*\(\s*(?:Level\s+\d+|\d+(?:st|nd|rd|th)[- ]level.*?)\s*\)$/i, '');

  function pageLabel(pages) {
    const numbers = [...new Set(pages || [])].filter(Number.isInteger).sort((a, b) => a - b);
    const ranges = [];
    for (let i = 0; i < numbers.length; i++) {
      const first = numbers[i];
      while (numbers[i + 1] === numbers[i] + 1) i++;
      ranges.push(first === numbers[i] ? String(first) : `${first}–${numbers[i]}`);
    }
    return ranges.join(', ');
  }

  function sourceLineRecords(pages) {
    return (pages || []).flatMap(page => String(page.text || '').split(/\r?\n/)
      .map((text, index) => ({ page: page.page ?? null, line: index + 1, text: text.trim() })).filter(row => row.text));
  }

  function location(records, name, type = '', start = 0, end = records.length) {
    const wanted = compact(name);
    if (!wanted) return -1;
    if (type === 'class') {
      const index = records.findIndex((row, i) => i >= start && i < end && /^Class Features$/i.test(row.text)
        && new RegExp(`^as (?:a|an) ${key(name)} `).test(key(records[i + 1]?.text)));
      if (index >= 0) return index;
      const core = records.findIndex((row, i) => i >= start && i < end && compact(row.text) === compact(`Core ${name} Traits`));
      if (core >= 0) return core;
    }
    const matches = [];
    for (let index = start; index < end; index++) if (compact(heading(records[index].text)) === wanted) matches.push(index);
    if (type === 'spell') {
      const definition = matches.find(index => /(?:[1-9](?:st|nd|rd|th)[- ]level|cantrip|Casting Time)/i.test(records.slice(index + 1, index + 4).filter(row => row.page === records[index].page).map(row => row.text).join(' ')));
      if (definition !== undefined) return definition;
    }
    if (type === 'magic') {
      const definition = matches.find(index => /,\s*(?:common|uncommon|rare|very rare|legendary|artifact|varies)\b/i.test(records[index + 1]?.text || ''));
      if (definition !== undefined) return definition;
    }
    if (type === 'item') {
      const row = records.findIndex((record, i) => i >= start && i < end && record.text.includes('|')
        && compact(record.text.split('|').filter(cell => cell.trim())[0]) === wanted);
      if (row >= 0) return row;
    }
    return matches[0] ?? -1;
  }

  function attachSourceReferences(data, context = {}) {
    const pages = context.pages || [];
    const continuation = context.continuationPages || [];
    const selected = new Set(pages.map(page => page.page));
    const records = sourceLineRecords([...pages, ...continuation].sort((a, b) => (a.page || 0) - (b.page || 0)));
    const base = { kind: context.kind || 'pdf', fileName: context.fileName || '' };
    function reference(index, match = 'heading') {
      if (index < 0) return { ...base, match: 'unmatched', page: null, line: null, excerpt: '' };
      const row = records[index];
      return { ...base, match, page: base.kind === 'pdf' ? row.page : null, line: row.line,
        continuation: base.kind === 'pdf' && !selected.has(row.page),
        excerpt: records.slice(index, index + 8).filter(next => next.page === row.page).map(next => next.text).join('\n').slice(0, 800) };
    }
    for (const [type, items] of Object.entries(data || {})) {
      if (!Array.isArray(items)) continue;
      const positions = items.map(item => location(records, item.name, type));
      items.forEach((item, index) => {
        const start = positions[index];
        item._source = reference(start);
        const end = positions.filter(position => position > start).sort((a, b) => a - b)[0] ?? records.length;
        for (const collection of ['features', 'traits', 'actions', 'reactions']) {
          for (const child of item[collection] || []) {
            if (child && typeof child === 'object') child._source = reference(location(records, child.name, '', Math.max(0, start), end));
          }
        }
        if (item.statBlockName) {
          const block = location(records, item.statBlockName, '', Math.max(0, start));
          if (block >= 0) item._source.related = [{ label: 'Creature statistics', ...reference(block) }];
        }
        if (type === 'class') {
          let tableStart = Math.max(0, start);
          for (let i = start - 1; i >= Math.max(0, start - 80); i--) {
            if (compact(records[i].text) === compact(`The ${item.name}`)) { tableStart = i; break; }
          }
          const names = [...new Set((item.progression || []).flatMap(row => row.features || []))];
          item._source.progression = names.map(name => {
            const row = records.findIndex((record, i) => i >= tableStart && i < end && /^\|\s*\d+(?:st|nd|rd|th)?\s*\|/i.test(record.text)
              && record.text.split('|').some(cell => cell.split(',').some(value => compact(value) === compact(name))));
            return { name, ...reference(row, 'table') };
          });
        }
      });
    }
    return data;
  }

  function artifactFindings(text) {
    const value = String(text || '');
    return [
      [/\uFFFD|\u00c2|\u00c3|\u00e2\u20ac|\u25a1/, 'encoding artifact'],
      [/\bCant rip\b/i, 'OCR split for Cantrip'],
      [/\b[lI]d(?:100|20|12|10|8|6|4)\b|\bd[lI](?:0|2)s?\b/, 'ambiguous dice notation'],
      [/\b\d+\s+CHAPTER\s+\d+\s+I\s+[A-Z][A-Z\s]+\b/i, 'PDF page header/footer artifact'],
      [/\b(?:Conc\.|Concentration|Cone\.)?\s*Ritual\s+Class\b/i, 'spell table class-column artifact'],
      [/[<{~][^A-Za-z0-9]{0,4}|[-–]?nzban\b/i, 'sidebar OCR artifact'],
      [/<\/?[A-Za-z][^>]*>/, 'raw tag artifact']
    ].filter(([pattern]) => pattern.test(value)).map(([, label]) => label);
  }

  function manualMechanicFinding(text) {
    const value = String(text || '').replace(/\s+/g, ' ');
    const permanentBenefit = /\b(?:have|gain)\b[^.!?]{0,100}\b(?:resistance|proficiency|darkvision)\b|\bspeed increases\b|\bincrease\b[^.!?]{0,70}\b(?:score|scores)\b/i;
    const condition = /\b(?:if|when|whenever|while|unless|until|during)\b|for (?:the next |a |one |\d+\s*)(?:round|minute|hour|day)/i;
    const unsupportedChoice = /\bresistance\b[^.!?]{0,80}\b(?:or|choice|choose)\b/i.test(value)
      || /\bincrease (?:your (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?: score)?(?:\s*,|\s+or\b)|one ability score of your choice by (?!1\b)\d+)/i.test(value);
    const conditionalSpell = /\byou (?:can cast|learn|know)\b[^.!?]{0,90}\b(?:spell|cantrip)\b/i.test(value);
    if ((permanentBenefit.test(value) && (condition.test(value) || unsupportedChoice) || conditionalSpell && condition.test(value))
      && !/\byou (?:do not|don't|never|cannot|can't) (?:have|gain)\b/i.test(value)) {
      return 'contains a conditional or chosen benefit. Its source instructions remain on the sheet; automatic rules do not model every condition or choice. Review the effect in Aurora before play.';
    }
    if (/\b(?:allies|another creature|target|companion)\b[^.!?]{0,100}\b(?:resistance|proficiency|darkvision|speed)\b/i.test(value)) {
      return 'describes a benefit for another creature. It is kept as sheet text rather than a permanent bonus to this character.';
    }
    return '';
  }

  function hasModeledAbilityChoice(item, feature) {
    if (!/^Ability Score Improvement$/i.test(feature.name || '')
      || !Number.isInteger(Number(feature.level)) || Number(feature.level) < 1 || Number(feature.level) > 20) return false;
    const text = String(feature.description || '').replace(/\s+/g, ' ');
    if (/\b(?:if|while|unless|until|during|whenever|transformed|transformation|activate|activated)\b|\bwhen (?!you reach\b)/i.test(text)) return false;
    const choices = (item.choices || []).filter(choice => compact(choice.feature) === compact(feature.name));
    if (choices.length !== 1 || !['asi', 'asiOrFeat'].includes(choices[0].mode)) return false;
    const choice = choices[0];
    if (!choice.name || (item.choices || []).filter(other => compact(other.name) === compact(choice.name)).length !== 1) return false;
    const api = globalThis.AuroraClassProgression;
    if (!api?.events) return false;
    const schedule = api.events(item, choice);
    return schedule.length > 0 && new Set(schedule.map(event => event.level)).size === schedule.length
      && schedule.every(event => Number.isInteger(event.level) && event.level >= 1 && event.level <= 20
        && Number.isInteger(event.count) && event.count > 0);
  }

  function namedCantripStatements(text) {
    const result = [];
    for (const statement of String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) {
      const match = statement.match(/^You (?:know|learn)\s+(?:the\s+)?cantrip\s+([A-Za-z][A-Za-z'’ -]+?)(?=[,.!?]|$)/i)
        || statement.match(/^You (?:know|learn)\s+(?:the\s+)?([A-Za-z][A-Za-z'’ -]+?)\s+cantrip\b/i);
      if (match && !/^(?:a|one|two|three|four|any|another|additional|this|that)\b/i.test(match[1])) result.push({ name: match[1].trim(), text: statement });
    }
    return result;
  }

  const spellReferenceCache = new WeakMap();
  function availableSpellNames(data) {
    const result = new Set((data.spell || []).map(spell => compact(spell.name)));
    const reference = globalThis.AuroraReferenceIndex || globalThis.AuroraLookupIndex;
    if (reference) {
      if (!spellReferenceCache.has(reference)) spellReferenceCache.set(reference, Object.values(reference.ids || {})
        .filter(entry => reference.types?.[entry[0]] === 'Spell').map(entry => compact(entry[1])));
      for (const name of spellReferenceCache.get(reference)) result.add(name);
    }
    return result;
  }

  function findings(data) {
    const issues = [];
    const knownSpells = availableSpellNames(data || {});
    for (const [type, items] of Object.entries(data || {})) {
      if (!Array.isArray(items)) continue;
      items.forEach((item, i) => {
        const add = (field, msg, category = 'missing-info', source = item._source) => issues.push({ type, i, field, msg, category, source });
        const checkCantrips = (text, field) => {
          for (const candidate of namedCantripStatements(text)) {
            if (!knownSpells.has(compact(candidate.name))) add(field, (item.name || 'Feat') + ': no bundled or exported spell definition was found for "' + candidate.name + '". Include that spell or add its exact Aurora grant manually.', 'source-review');
            else add(field, (item.name || 'Feat') + ': knowing ' + candidate.name + ' does not create a spellcasting feature or choose a casting ability. Verify the intended casting feature and ability in Aurora; a spell grant alone does not establish them.', 'source-review');
          }
        };
        if (item._error) add('description', `${item.name || 'Entry'} could not be parsed. Paste its source text or complete it manually.`);
        if (['feat', 'race', 'background', 'magic'].includes(type)) {
          const manual = manualMechanicFinding(item.description);
          if (manual) add('description', (item.name || 'Entry') + ': ' + manual, 'source-review');
        }
        if (type === 'feat') for (const [index, benefit] of (item.benefits || []).entries()) {
          const manual = manualMechanicFinding(typeof benefit === 'string' ? benefit : benefit?.text);
          if (manual) add('benefits.' + index, (item.name || 'Feat') + ': ' + manual, 'source-review');
          checkCantrips(typeof benefit === 'string' ? benefit : benefit?.text, 'benefits.' + index);
        }
        if (type === 'feat') checkCantrips(item.description, 'description');
        if (type === 'magic' && !Number(item.charges) && /\b(?:expend|spend|regain|recover)s?\b[^.!?]{0,60}\bcharges?\b/i.test(item.description || '')) {
          add('charges', (item.name || 'Magic item') + ': charge costs or recharge text were found, but its charge capacity is missing. Enter the total capacity from the source; spending costs are not the maximum.', 'missing-info');
        }
        if (type === 'spell') {
          if (!(item.classes || []).length && !(item.availability?.conditional?.length && item.availability._conditionalOnlyConfirmed)) add('classes', `${item.name || 'Spell'}: no spell lists assigned. Check the source's class spell-list pages.`);
          const accessLabels = { 'expanded-list': 'the spell list expansion', prepared: 'always prepared access', known: 'known spell access', innate: 'the granted casting', choice: 'the spell choice', review: 'the grant conditions' };
          for (const [index, entry] of (item.availability?.conditional || []).entries()) if (!entry._reviewed)
            add(`availability.conditional.${index}.condition`, `${item.name || 'Spell'}: review ${accessLabels[entry.access] || 'the grant conditions'} from ${entry.owner}. Access requires that feature; it is not a base class list.`, 'source-review', entry._source);
          for (const [index, entry] of (item.availability?.conditional || []).entries()) if (entry.levelUnclear)
            add(`availability.conditional.${index}.${entry.levelField || 'spellLevel'}`, `${item.name || 'Spell'}: the table level for ${entry.owner} is unreadable. Enter the level shown in the source.`, 'missing-info', entry._source);
          if (!item.availability?._conflictsReviewed) for (const conflict of item.availability?.conflicts || []) add('availability', `${item.name || 'Spell'}: ${conflict.message}`, 'source-review');
          for (const field of ['castingTime', 'range', 'duration']) if (!String(item[field] || '').trim()) add(field, `${item.name || 'Spell'}: ${field === 'castingTime' ? 'casting time' : field} is missing.`);
        }
        if (item._source?.kind === 'pdf' && item._source.match === 'unmatched' && !item._source.checked) {
          issues.push({ type, i, field: null, category: 'source-review', action: 'check-source',
            msg: `${item.name || 'Entry'}: a source heading was not located automatically. Compare this entry with the PDF.`, source: item._source });
        }
        const textFields = ['description', 'higherLevels', 'statBlock', 'fullText'];
        for (const field of textFields) for (const artifact of artifactFindings(item[field])) add(field, `${item.name || 'Entry'}: possible ${artifact}; compare with the source.`, 'source-review');
        for (const collection of ['features', 'traits', 'actions', 'reactions']) {
          (item[collection] || []).forEach((child, index) => {
            if (!child || typeof child !== 'object') return;
            const prefix = `${collection}.${index}`;
            if (!String(child.name || '').trim()) add(`${prefix}.name`, `${item.name || 'Entry'}: ${collection} entry ${index + 1} needs a name.`, 'missing-info', child._source || item._source);
            if (!String(child.description || '').trim()) add(`${prefix}.description`, `${item.name || 'Entry'}: ${child.name || collection + ' entry ' + (index + 1)} needs its description.`, 'missing-info', child._source || item._source);
            if (['class', 'archetype'].includes(type) && (!Number.isInteger(Number(child.level)) || Number(child.level) < 1 || Number(child.level) > 20)) add(`${prefix}.level`, `${item.name || 'Entry'}: ${child.name || 'feature'} needs a level from 1 to 20.`, 'missing-info', child._source || item._source);
            if (!/^(?:Spellcasting|Pact Magic)$/i.test(child.name || '')) {
              const manual = manualMechanicFinding(child.description);
              if (manual && !(type === 'class' && hasModeledAbilityChoice(item, child))) add(prefix + '.description', (child.name || 'Feature') + ': ' + manual, 'source-review', child._source || item._source);
            }
            if (['class', 'archetype'].includes(type) && /^Steel Defender$/i.test(child.name || '')) add(prefix + '.description',
              (child.name || 'Companion') + ': companion statistics and a compatible picker are not generated. Install the source-correct Companion definition and add its Aurora selection rule before using this feature.', 'source-review', child._source || item._source);
            for (const artifact of artifactFindings(child.description)) add(`${prefix}.description`, `${child.name || 'Feature'}: possible ${artifact}; compare with the source.`, 'source-review', child._source || item._source);
          });
        }
        for (const [ci, choice] of (item.choices || []).entries()) for (const [oi, option] of (choice.options || []).entries()) {
          for (const artifact of artifactFindings(option.description)) add('choices.' + ci + '.options.' + oi + '.description',
            (option.name || 'Choice option') + ': possible ' + artifact + '; compare with the source.', 'source-review', option._source || choice._source || item._source);
        }
      });
    }
    return issues;
  }

  function withoutReferences(value) {
    if (Array.isArray(value)) return value.map(withoutReferences);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([name]) => name !== '_source').map(([name, child]) => [name, withoutReferences(child)]));
  }

  function applyContentCorrection(current, correction) {
    const result = withoutReferences(correction);
    if (current.availability) {
      result.availability = JSON.parse(JSON.stringify(current.availability));
      for (const entry of result.availability.conditional || []) {
        const previous = correction.availability?.conditional?.find(candidate => key(candidate.owner) === key(entry.owner)
          && candidate.access === entry.access && key(candidate.condition) === key(entry.condition));
        const field = entry.levelField === 'level' ? 'level' : 'spellLevel';
        if (entry.levelUnclear && previous?.levelUnclear === false && Number.isInteger(previous[field])
          && previous[field] >= (field === 'level' ? 1 : 0) && previous[field] <= (field === 'level' ? 20 : 9)) {
          entry[field] = previous[field]; entry.levelUnclear = false;
        }
      }
    }
    else delete result.availability;
    if (current._source) result._source = JSON.parse(JSON.stringify(current._source));
    for (const collection of ['features', 'traits', 'actions', 'reactions']) {
      for (const child of result[collection] || []) {
        const original = (current[collection] || []).find(candidate => key(candidate.name) === key(child.name));
        if (original?._source) child._source = JSON.parse(JSON.stringify(original._source));
      }
    }
    for (const choice of result.choices || []) {
      const original = (current.choices || []).find(candidate => key(candidate.name) === key(choice.name) && key(candidate.feature) === key(choice.feature));
      if (original?._source) choice._source = JSON.parse(JSON.stringify(original._source));
      for (const option of choice.options || []) {
        const source = (original?.options || []).find(candidate => key(candidate.name) === key(option.name))?._source;
        if (source) option._source = JSON.parse(JSON.stringify(source));
      }
    }
    return result;
  }

  return { sourceLineRecords, pageLabel, attachSourceReferences, artifactFindings, findings, namedCantripStatements, withoutReferences, applyContentCorrection };
});
