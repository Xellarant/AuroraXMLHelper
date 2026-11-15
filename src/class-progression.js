(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AuroraClassProgression = api;
    if (root.window) root.window.AuroraClassProgression = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const key = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = value => String(value || '').trim().replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '')
    .replace(/[’‘]/g, "'").replace(/\s+-\s+/g, '-');
  const title = value => /^[A-Z][A-Za-z'’-]*(?:[ -](?:[A-Z][A-Za-z'’-]*|of|the|and|a))*$/.test(value) && value.length < 65;
  const chrome = value => /^(?:\d+|Mage Hand Press|Complete Witch|©.*)$/.test(value);
  const levels = text => [...new Set([...String(text || '').matchAll(/\b(\d+)(?:st|nd|rd|th)\b/gi)]
    .map(match => Number(match[1])).filter(level => level >= 1 && level <= 20))].sort((a, b) => a - b);

  function rows(progression) {
    // Ambiguous duplicate levels must be repaired before they can generate rules.
    const counts = new Map();
    for (const row of progression || []) counts.set(Number(row.level), (counts.get(Number(row.level)) || 0) + 1);
    return (progression || []).filter(row => Number.isInteger(Number(row.level)) && row.level >= 1 && row.level <= 20
      && counts.get(Number(row.level)) === 1).slice().sort((a, b) => a.level - b.level);
  }

  function deltas(progression, accessor) {
    const result = [];
    let previous = 0;
    for (const row of rows(progression)) {
      const value = accessor(row);
      if (!Number.isInteger(value) || value < 0) continue;
      // Never count a recovered value twice after an OCR-induced decrease.
      if (value > previous) result.push({ level: Number(row.level), count: value - previous });
      previous = Math.max(previous, value);
    }
    return result;
  }

  function featureLevels(cls, feature) {
    const fromTable = rows(cls.progression).filter(row => (row.features || []).some(name => key(name) === key(feature.name))).map(row => Number(row.level));
    const text = String(feature.description || '').replace(/\s+/g, ' ');
    const repeat = [...text.matchAll(/\b(?:again|another)\s+at\s+((?:\d+(?:st|nd|rd|th)(?:\s*,\s*(?:and\s+)?|\s+and\s+)?)+)/gi)].flatMap(match => levels(match[1]));
    return [...new Set([fromTable[0] || Number(feature.level ?? 0), ...fromTable, ...repeat])].sort((a, b) => a - b);
  }

  function events(cls, choice) {
    if (choice.schedule !== undefined) return choice.schedule;
    if (choice.progressionField) return deltas(cls.progression, row => row[choice.progressionField]);
    const feature = (cls.features || []).find(feature => key(feature.name) === key(choice.feature));
    const tableLevel = feature && rows(cls.progression).find(row => (row.features || []).some(name => key(name) === key(feature.name)))?.level;
    return (choice.repeat && feature ? featureLevels(cls, feature) : choice.levels || [tableLevel ?? feature?.level ?? 0])
      .map(level => ({ level: Number(level), count: choice.count ?? 1 }));
  }

  function records(text, options) {
    const pages = options.availabilityPages?.length ? options.availabilityPages : options.pages || [];
    if (!pages.length) return String(text || '').split(/\r?\n/).map((text, index) => ({ text: clean(text), line: index + 1, page: null }));
    return pages.flatMap(page => {
      const fonts = new Map((page.layout?.columns || []).flatMap(column => column.rows || [])
        .map(row => [clean(row.text), Math.max(0, ...(row.items || []).map(item => item.height || 0))]));
      const raw = page.layout?.mainLines || String(page.text || '').split(/\r?\n/);
      const sourceLines = String(page.text || '').split(/\r?\n/).map(clean);
      return raw.map((text, index) => ({ text: clean(text), line: sourceLines.indexOf(clean(text)) + 1 || index + 1, page: page.page, height: fonts.get(clean(text)) || 0 }));
    }).filter(row => row.text && !chrome(row.text));
  }

  function reference(row, options, excerpt) {
    return { kind: options.kind || (row?.page ? 'pdf' : 'pasted'), fileName: options.fileName || '',
      page: row?.page ?? null, line: row?.line ?? null, match: row ? 'heading' : 'unmatched',
      continuation: !!row?.page && !(options.pages || []).some(page => page.page === row.page),
      excerpt: String(excerpt || row?.text || '').slice(0, 800) };
  }

  function inlineOptions(feature) {
    const lines = String(feature.description || '').split(/\r?\n/).map(clean).filter(line => line && !chrome(line));
    const dotted = lines.map((line, index) => ({ index, match: line.match(/^([A-Z][A-Za-z' -]{1,35})\.\s+(.+)/) }))
      .filter(row => row.match && title(row.match[1]) && !/^(?:Additionally|However|Instead|Otherwise)$/.test(row.match[1]));
    if (dotted.length >= 2) return dotted.map((row, index) => ({
      name: row.match[1], description: [row.match[2], ...lines.slice(row.index + 1, dotted[index + 1]?.index ?? lines.length)].join('\n')
    }));
    const starts = lines.map((line, index) => ({ index, name: line })).filter(row => title(row.name)
      && /^(?:You |Your |When |While |As |If |Once |Starting |Beginning )/.test(lines[row.index + 1] || ''));
    return starts.length >= 2 ? starts.map((row, index) => ({
      name: row.name, description: lines.slice(row.index + 1, starts[index + 1]?.index ?? lines.length).join('\n')
    })) : [];
  }

  function catalogue(all, heading) {
    const start = all.findIndex((row, index) => key(row.text) === key(heading)
      && /\b(?:below|following)\b.*\b(?:alphabetical|order)\b/i.test(all.slice(index + 1, index + 4).map(row => row.text).join(' ')));
    if (start < 0) return [];
    let first = start + 1;
    while (first < all.length && !(title(all[first].text)
      && /^(?:As |You |Your |When |While |Once |If |Prerequisites?:)/.test(all[first + 1]?.text || ''))) first++;
    if (first >= all.length) return [];
    const optionHeight = all[first].height;
    const options = [];
    let current;
    let complete = false;
    for (let i = first; i < all.length; i++) {
      const row = all[i];
      if ((row.height > optionHeight + 2 && optionHeight)
        || /^(?:Grand Hexes|Witch's Crafts|[A-Za-z' -]+ (?:Subclasses|Conclaves)|Chapter\b)/.test(row.text)) { complete = true; break; }
      const isOption = title(row.text) && (optionHeight ? Math.abs(row.height - optionHeight) < 0.5
        : /^(?:As |You |Your |When |While |Once |If |Prerequisites?:)/.test(all[i + 1]?.text || ''));
      if (isOption) {
        current = { name: row.text, description: '', row };
        options.push(current);
      } else if (current) current.description += (current.description ? '\n' : '') + row.text;
    }
    const result = options.filter(option => option.description);
    result.incomplete = !complete;
    return result;
  }

  function build(cls, text, options = {}) {
    let all = records(text, options);
    const selected = new Set((options.pages || []).map(page => page.page));
    const introMatch = (row, index) => (!selected.size || selected.has(row.page)) && (
      key(row.text) === key('Core ' + cls.name + ' Traits') && /Primary Ability|Hit Point|Hit Dice|Saving Throw/i.test(all.slice(index + 1, index + 8).map(row => row.text).join(' '))
      || key(row.text).startsWith(key('As a ' + cls.name + ', you gain the following class features'))
      || key(row.text).startsWith(key('As an ' + cls.name + ', you gain the following class features')));
    const intro = all.findIndex(introMatch);
    if (intro >= 0) {
      const next = all.findIndex((row, index) => index > intro && (/^Core .+ Traits$/i.test(row.text) && key(row.text) !== key('Core ' + cls.name + ' Traits')
        || /^As (?:a|an) .+, you (?:gain|have) the following class features\./i.test(row.text)));
      all = all.slice(intro, next < 0 ? all.length : next);
    }
    cls.choices = [];
    function add(feature, choice) {
      choice.feature = feature.name;
      choice.name ||= feature.name;
      choice.options ||= [];
      choice.options = choice.options.map(option => {
        const row = all.find(row => key(row.text.split('.')[0]) === key(option.name));
        option._source ||= reference(row || all.find(row => key(row.text) === key(feature.name)), options, option.name + '\n' + option.description);
        const prerequisite = option.description.replace(/\s+/g, ' ').match(/You must have the (.+?) feature to choose this\b/i)
          || option.description.match(/Prerequisites?:\s*([^\n]+)/i);
        if (prerequisite) {
          option.prerequisite = prerequisite[0];
          const required = (cls.features || []).find(feature => key(feature.name) === key(prerequisite[1]));
          if (required) option.requiredFeature = required.name;
          else {
            const minimum = prerequisite[1].match(/^(\d+)(?:st|nd|rd|th)[- ]level(?:\s+([\w'-]+))?$/i);
            if (minimum && (!minimum[2] || key(minimum[2]) === key(cls.name))) option.minimumLevel = Number(minimum[1]);
            else option.unresolvedPrerequisite = prerequisite[1];
          }
        }
        return option;
      });
      choice._source = reference(all.find(row => key(row.text) === key(feature.name)), options, feature.description);
      choice.replacement = /\breplace\b/i.test(feature.description || '') ? feature.description.replace(/\s+/g, ' ').match(/[^.]*\breplace\b[^.]*\./i)?.[0]?.trim() || '' : '';
      cls.choices.push(choice);
    }
    for (const feature of cls.features || []) {
      const text = feature.description || '';
      const flat = text.replace(/\s+/g, ' ');
      if (/^Spellcasting$/i.test(feature.name)) continue;
      if (/^Ability Score Improvement$/i.test(feature.name)) {
        const increases = /\bincrease\b.*\bability\b|\bability\b.*\bincrease\b/i.test(flat);
        const standardIncrease = /\b(?:by 2|by two)\b/i.test(flat) && /\b(?:two|2) ability scores\b.*\b(?:by 1|by one)\b/i.test(flat);
        const mode = increases ? (standardIncrease ? /\bfeat\b/i.test(text) ? 'asiOrFeat' : 'asi' : 'unresolved') : /\bfeat\b/i.test(text) ? 'feat' : 'unresolved';
        add(feature, { mode, repeat: true });
        continue;
      }
      if (/^Epic Boon$/i.test(feature.name)) { add(feature, { mode: 'feat', supports: /or another feat/i.test(flat) ? '' : 'Epic Boon' }); continue; }
      if (/^Replicate Magic Item$/i.test(feature.name)) {
        const plans = [];
        let minimumLevel = 0;
        let table = false;
        for (const row of all) {
          const header = row.text.match(/^Ma[sgc]ic\s+(?:Item|Tem|rem)\s+P[a-z]+\s*\([^)]*Leve[lti]\s+(\d+)\+\s*\)$/i);
          if (header) { minimumLevel = Number(header[1]); table = false; continue; }
          if (!minimumLevel) continue;
          if (/^Leve[lti]\s+\d+|\(Level \d+\)$/i.test(row.text)) { table = false; minimumLevel = 0; continue; }
          if (/^\|?\s*Magic Item Plan\s*\|/i.test(row.text)) { table = true; continue; }
          if (/^Magic Item Plan\s+Attunement$/i.test(row.text)) { table = true; continue; }
          if (!table || /^\|?\s*[-:]+\s*\|/.test(row.text)) continue;
          const raw = row.text.match(/^(.+?)\s+(No|Yes[:;]?|Varies)$/i);
          const cells = row.text.includes('|') ? row.text.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()) : raw?.slice(1);
          if (!cells || cells.length !== 2 || !/^(?:No|Yes[:;]?|Varies)$/i.test(cells[1])) { table = false; continue; }
          const name = cells[0].replace(/\*+$/, '').trim();
          if (!name) continue;
          plans.push({ name, description: 'Magic item plan: ' + name + '. Attunement: ' + cells[1] + ". Refer to the item's rules; learning a plan does not create or equip the item.",
            minimumLevel, _source: reference(row, options), repeatable: /\*/.test(cells[0]),
            unresolvedPrerequisite: /[!#]|\+\s*[4-9]|\b(?:Toott|Shott|Weaport|Weapont|Patht|Awarenesst|Sharpenert|Shieldt|Ringt)\b/i.test(name) ? 'Check the OCR item name against the source and correct it.' : '' });
        }
        add(feature, { mode: 'options', progressionField: 'plansKnown', options: plans });
        continue;
      }
      if (/^(?:Hexes|Eldritch Invocations|Grand Hex)$/i.test(feature.name)) {
        const catalogueName = /^Grand Hex$/i.test(feature.name) ? 'Grand Hexes' : feature.name;
        const field = /^Hexes$/i.test(feature.name) ? 'hexesKnown' : /^Eldritch Invocations$/i.test(feature.name) ? 'invocationsKnown' : '';
        const found = catalogue(all, catalogueName);
        add(feature, { mode: 'options', ...(field ? { progressionField: field } : { levels: featureLevels(cls, feature) }),
          catalogueIncomplete: !!options.pages?.length && !!found.incomplete,
          options: found.map(option => ({ name: option.name, description: option.description,
            _source: reference(option.row, options, option.name + '\n' + option.description) })) });
        continue;
      }
      if (/choose.*(?:following options|options below|one of the)/i.test(flat) || /Fighting Style$/i.test(feature.name)) {
        const inline = inlineOptions(feature);
        if (inline.length) { add(feature, { mode: 'options', options: inline }); continue; }
      }
      const enemy = flat.replace(/\bo f\b/gi, 'of').replace(/\bc onstructs\b/gi, 'constructs')
        .match(/Choose a type of (?:greater )?favored enemy:\s*([^.]+)/i);
      if (enemy) add(feature, { mode: 'options', options: enemy[1].split(/,\s*(?:or\s+)?|\s+or\s+/i).filter(Boolean)
        .map(name => ({ name: name[0].toUpperCase() + name.slice(1), description: flat })) });
      if (/\blearn (?:one|a) language of your choice\b|\badditional lang\s*u\s*a\s*ge\b/i.test(flat)) add(feature, { mode: 'language', name: feature.name + ': language' });
    }
    return cls;
  }

  function findings(cls) {
    const result = [];
    const issue = (field, msg, source) => result.push({ field, msg, source,
      ...(/source instructions|allows replacement|catalogue ends|absent from the table|out of order/.test(msg) ? { category: 'source-review' } : {}) });
    const table = cls.progression || [];
    const unsupported = [...new Set(table.flatMap(row => Object.keys(row.extraColumns || {})))];
    if (unsupported.length) issue('progressionDraft', 'These progression columns are preserved for review but have no generated rules: ' + unsupported.join(', ') + '. Handle their effects from the source instructions.');
    if (!table.length) issue('progressionDraft', 'No progression table was recovered. Add the class table to restore level-based spell slots, resource counts, and choices.');
    const seen = new Set();
    let previousLevel = 0;
    const previous = {};
    for (const [index, row] of table.entries()) {
      const field = 'progressionDraft';
      if (!Number.isInteger(row.level) || row.level < 1 || row.level > 20) issue(field, 'Table row ' + (index + 1) + ' has an invalid level. Use a whole number from 1 to 20.');
      if (seen.has(row.level)) issue(field, 'Level ' + row.level + ' occurs more than once. Rules for this level are withheld until the duplicate rows are resolved.');
      if (row.level < previousLevel) issue(field, 'Progression rows are out of order. Review the level column; rules use ascending levels.');
      seen.add(row.level); previousLevel = row.level;
      for (const error of row._errors || []) issue(field, 'Level ' + row.level + ': ' + error);
    }
    for (const row of rows(table)) {
      for (const field of ['cantrips', 'prepared', 'spellsKnown', 'hexesKnown', 'invocationsKnown', 'plansKnown', 'magicItems',
        ...Array.from({ length: 9 }, (_, i) => 'slots.' + (i + 1))]) {
        const value = field.startsWith('slots.') ? row.slots?.[Number(field.split('.')[1])] : row[field];
        if (value == null) continue;
        if (!Number.isInteger(value) || value < 0) issue('progressionDraft', 'Level ' + row.level + ': ' + field + ' must be a nonnegative whole number.');
        else if (value < (previous[field] || 0)) issue('progressionDraft', 'Level ' + row.level + ': ' + field + ' decreases. Check the source; no duplicate gains are generated from this decrease.');
        previous[field] = Math.max(previous[field] || 0, value);
      }
    }
    const missing = Array.from({ length: 20 }, (_, i) => i + 1).filter(level => !seen.has(level));
    if (table.length && missing.length) issue('progressionDraft', 'Progression is incomplete. Missing levels: ' + missing.join(', ') + '. Include the missing rows before using the full class.');
    for (const [index, feature] of (cls.features || []).entries()) {
      if (table.length && !table.some(row => (row.features || []).some(name => key(name) === key(feature.name)))) {
        issue('features.' + index + '.level', '"' + feature.name + '" is absent from the table. Its stated level is retained; check the table or feature level.', feature._source);
      }
      const tableLevel = rows(table).find(row => (row.features || []).some(name => key(name) === key(feature.name)))?.level;
      if (tableLevel && Number(feature.level) !== Number(tableLevel)) issue('features.' + index + '.level',
        '"' + feature.name + '" has a stated level that disagrees with the progression table. Its table level (' + tableLevel + ') controls the grant and choices; correct the source mismatch.', feature._source);
      const flat = String(feature.description || '').replace(/\s+/g, ' ');
      if (/\b(?:choose (?:one|two|three|four|a type|the form|the following)|of your choice|learn (?:one|two|three|four))\b/i.test(flat)
        && !/^(?:Spellcasting|Tinker's Magic)$/i.test(feature.name)
        && !/conclave|craft|archetype|subclass/i.test(feature.name)
        && !(cls.choices || []).some(choice => choice.feature === feature.name)) {
        issue('features.' + index + '.description', '"' + feature.name + '" contains a choice that has no generated picker. Add a choice or review the feature instructions before using it.', feature._source);
      }
    }
    for (const [index, choice] of (cls.choices || []).entries()) {
      const field = 'choices.' + index + '.scheduleText';
      if (!choice.name || (cls.choices || []).filter(other => key(other.name) === key(choice.name)).length > 1) issue('choices.' + index + '.name', 'Choice names must be nonempty and unique within the class. Ambiguous choices are withheld from export.');
      if (!['options', 'asi', 'asiOrFeat', 'feat', 'language', 'unresolved'].includes(choice.mode)) issue(field, 'Choose a supported choice type.');
      if (choice.catalogueDraft !== undefined && choice.catalogueDraft !== choice.catalogueAppliedText) issue('choices.' + index + '.catalogueDraft', '"' + choice.name + '" has unapplied option text. Apply the option section before exporting.');
      if (!(cls.features || []).some(feature => key(feature.name) === key(choice.feature))) issue('choices.' + index + '.feature', '"' + choice.name + '" needs an existing parent feature.');
      const schedule = events(cls, choice);
      if (!schedule.length) issue(field, '"' + choice.name + '" has no choice schedule. Add its progression column or enter level:count pairs.', choice._source);
      if (schedule.some(event => !Number.isInteger(event.level) || event.level < 1 || event.level > 20 || !Number.isInteger(event.count) || event.count < 1)) issue(field, '"' + choice.name + '" has an invalid schedule. Use levels 1–20 and positive whole-number counts.', choice._source);
      if (new Set(schedule.map(event => event.level)).size !== schedule.length) issue(field, '"' + choice.name + '" repeats a choice level. Combine counts for that level.', choice._source);
      if (choice.mode === 'unresolved') issue(field, '"' + choice.name + '" needs a choice type. Check its source before adding rules.', choice._source);
      if (choice.mode === 'options') {
        if (choice.catalogueIncomplete) issue('choices.' + index + '.options', '"' + choice.name + '" catalogue ends at the available page boundary. Include the rest of the catalogue or verify it is complete.', choice._source);
        if (!choice.options?.length) issue('choices.' + index + '.options', '"' + choice.name + '" has no option definitions. Include the catalogue pages or add the options; no empty picker is exported.', choice._source);
        if (new Set((choice.options || []).map(option => key(option.name))).size !== choice.options?.length) issue('choices.' + index + '.options', '"' + choice.name + '" has duplicate option names. Rename or remove the duplicate options.');
        for (const [oi, option] of (choice.options || []).entries()) {
          const optionField = 'choices.' + index + '.options.' + oi + '.description';
          if (!option.name || !option.description) issue(optionField, '"' + choice.name + '" has an option missing its name or description.');
          if (option.minimumLevel && (!Number.isInteger(option.minimumLevel) || option.minimumLevel < 1 || option.minimumLevel > 20)) issue(optionField, '"' + option.name + '" needs a minimum level from 1 to 20.');
          if (option.requiredFeature && !(cls.features || []).some(feature => key(feature.name) === key(option.requiredFeature))) issue(optionField, '"' + option.name + '" requires a class feature that was not captured: ' + option.requiredFeature + '.');
          if (option.unresolvedPrerequisite) issue(optionField, '"' + option.name + '" has an unresolved prerequisite (' + option.unresolvedPrerequisite + '); it is withheld from the picker until repaired.', option._source);
        }
        let cumulative = 0;
        for (const event of schedule.slice().sort((a, b) => a.level - b.level)) {
          cumulative += event.count;
          const available = (choice.options || []).filter(option => !option.unresolvedPrerequisite && option.name && option.description
            && (option.minimumLevel || 1) <= event.level
            && (!option.requiredFeature || (cls.features || []).some(feature => key(feature.name) === key(option.requiredFeature) && Number(feature.level) <= event.level)));
          if (available.length < cumulative && !available.some(option => option.repeatable)) issue(field, '"' + choice.name + '" has too few eligible options at level ' + event.level + '. Add the missing options or correct the schedule; that picker is withheld.');
        }
        if (choice.options?.length) issue('choices.' + index + '.options', '"' + choice.name + '": option descriptions are included on the sheet. Situational effects and activated abilities need their source instructions; review them before play.', choice._source);
      }
      if (choice.replacement) issue(field, '"' + choice.name + '" allows replacement: ' + choice.replacement + ' Edit the existing selection in Aurora when replacing an option; extra picks are not granted.', choice._source);
    }
    return result;
  }

  return { key, rows, deltas, featureLevels, events, build, findings };
});
