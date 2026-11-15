(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AuroraSpellAvailability = api;
    if (root.window) root.window.AuroraSpellAvailability = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const classes = ['Artificer', 'Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];
  const school = '(?:Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation)';
  const key = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = value => String(value || '').replace(/[’‘]/g, "'").replace(/\\f(?=\s+you\s+have\b)/gi, 'If').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
  const heading = value => clean(value).replace(/^#{1,6}\s*/, '').replace(/^(?:Feat|Background|Race|Species|Subclass|Class):\s*/i, '');
  const unique = values => [...new Map(values.map(value => [key(value), value])).values()];
  const kindLine = value => new RegExp(`^(?:${school} cantrip|\\d+(?:st|nd|rd|th)-level ${school}|Level \\d+ ${school})\\b`, 'i').test(clean(value));
  const levelLine = value => /^(?:Cantrips?\b|\d+(?:st|nd|rd|th)?(?:[- ]Level|\s*\())/i.test(clean(value));
  const cells = value => clean(value).replace(/^\|/, '').replace(/\|$/, '').split('|').map(value => value.trim());
  function containsName(value, name) {
    const escaped = clean(name).replace(/[.*+?^{}()|[\]\\$]/g, '\\$&').replace(/\s+/g, '\\s+');
    // A conjunction inside a spell name is part of its identity, not a list separator.
    return new RegExp('(?:^|[,;]|\\.\\s*|\\band\\s+)\\s*' + escaped + '(?=$|\\s*[,;.]|\\s+and\\b)', 'i').test(clean(value));
  }
  function tableLevel(value, field) {
    const text = clean(value);
    const number = /^(?:Cantrips?)$/i.test(text) ? 0 : /^\d+(?:st|nd|rd|th)?$/i.test(text) ? parseInt(text, 10) : null;
    const minimum = field === 'spellLevel' ? 0 : 1;
    const maximum = field === 'spellLevel' ? 9 : 20;
    return Number.isInteger(number) && number >= minimum && number <= maximum
      ? { [field]: number } : { levelUnclear: true, levelField: field };
  }
  const tableAccess = text => /added to|add.*spell list|expanded spell list/i.test(text) ? 'expanded-list'
    : /always.*prepared|domain spells|oath spells/i.test(text) ? 'prepared'
    : /spells? known|you (?:learn|know)/i.test(text) ? 'known' : 'review';
  function tableCondition(text, sourceRow, access) {
    if (access === 'review') return sourceRow;
    text = clean(text);
    const starts = [...text.matchAll(/\b(?:If you have\b|For you,|You always have\b|These spells (?:are|count)\b|The spells (?:are|on)\b)/gi)];
    const prerequisite = [...text.matchAll(/\b(?:Prerequisite:|If you have\b|Provided that\b)/gi)].at(-1);
    const forYou = [...text.matchAll(/\bFor you,/gi)].at(-1);
    const start = prerequisite?.index ?? forYou?.index ?? starts.at(-1)?.index ?? Math.max(0, text.length - 700);
    return `${text.slice(start).replace(/^\S*\s+/, match => starts.length || prerequisite ? match : '')}\n${sourceRow}`;
  }
  const baseHeading = value => heading(value).match(/^(?:Level \d+\s+)?([A-Za-z][A-Za-z' -]{1,35}?)\s+(?:Spell List|Spells)$/i);
  const conditionalHeading = value => /\b(?:expanded|bonus|domain|oath|craft|circle|patron|guild|additional|origin|bloodline)\s+spells?\b|^Spells of (?:the|your)\b/i.test(heading(value))
    || /(?:expandedspelllist|bonusspells|domainspells|oathspells|craftspells|guildspells)$/.test(key(value));

  function recordsFor(pages) {
    return pages.flatMap((page, pageIndex) => {
      const rows = (page.layout?.columns || []).flatMap(column => column.rows || []);
      const fonts = new Map();
      for (const row of rows) for (const item of row.items || []) fonts.set(Math.round(item.height * 10) / 10, (fonts.get(Math.round(item.height * 10) / 10) || 0) + String(item.str || '').length);
      const bodySize = [...fonts].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
      return String(page.text || rows.map(row => row.text).join('\n')).split(/\r?\n/).map((text, index) => {
        const row = rows.find(row => clean(row.text) === clean(text));
        const size = row ? Math.max(0, ...(row.items || []).map(item => item.height || 0)) : 0;
        return { text: text.trim(), page: page.page ?? null, line: index + 1, pageIndex, size, bodySize };
      }).filter(row => row.text);
    });
  }

  function classNames(value) {
    return unique(String(value || '').split(/[,;/]|\band\b/i).map(clean).filter(Boolean).map(value =>
      classes.find(name => key(name) === key(value)) || (/^[A-Z][A-Za-z' -]{1,30}$/.test(value) ? value : '')).filter(Boolean));
  }

  function reference(record, context, excerpt = record.text) {
    return { kind: context.kind || 'pdf', fileName: context.fileName || '', page: context.kind === 'pasted' ? null : record.page,
      line: record.line, match: 'availability', availabilityContext: !context.selected.has(record.page), excerpt: excerpt.slice(0, 800) };
  }

  function ownerKind(value) {
    if (/\bfeats?\b/i.test(value)) return 'feat';
    if (/\bbackgrounds?\b|\bguild\b/i.test(value)) return 'background';
    if (/\braces?\b|\bspecies\b|\bgenasi\b/i.test(value)) return 'race';
    if (/\bsubclass(?:es)?\b|\bdomain\b|\boath\b|\bcircle\b|\bcrafts?\b|\bpatron\b/i.test(value)) return 'subclass';
    return 'feature';
  }

  function ownerContexts(records) {
    const result = [];
    let stack = [];
    let category = 'feature';
    let inDefinition = false;
    for (let index = 0; index < records.length; index++) {
      const row = records[index];
      const raw = row.text;
      const text = heading(raw);
      if (/^(?:Chapter\s+\d+.*|Spells?|Spell Lists?|Spell Descriptions)$/i.test(text)) category = 'feature';
      const markdown = raw.match(/^(#{1,6})\s+/);
      const typedMatch = raw.match(/^([^:]{3,20}):\s*(.+)$/);
      const classMetadata = inDefinition && typedMatch && key(typedMatch[1]) === 'class'
        && !/\b(?:Hit Dice|Hit Point Die|Hit Points|Primary Ability)\s*[:|]/i.test(records.slice(index + 1, index + 8).map(row => row.text).join(' '));
      const typed = !classMetadata && typedMatch && ['feat', 'background', 'race', 'species', 'subclass', 'class', 'feature'].includes(key(typedMatch[1])) ? typedMatch : null;
      const capitals = text === text.toUpperCase() && /[A-Z]/.test(text) && text.split(' ').length < 9;
      const pdfHeading = row.size > 0 && (row.size >= row.bodySize * 1.25 || capitals) && text.length < 75 && /[A-Za-z]/.test(text)
        && !/[.!?:]$/.test(text) && !/https?:|www\.|\d+\/\d+(?:\/\d+)?/.test(text);
      if (kindLine(records[index + 1]?.text)) inDefinition = true;
      else if (!classMetadata && (markdown || typed || pdfHeading) && !kindLine(text) && !bySpellHeading(text)) inDefinition = false;
      const section = /^(?:.* Feats|Feats|Backgrounds|Races|Species|Witch's Crafts|.* Subclasses)$/i.test(text);
      if (section) category = ownerKind(text);
      const previous = stack[stack.length - 1];
      if (pdfHeading && capitals && previous?.typed && index === previous.recordIndex + 1 && Math.abs(row.size - previous.size) < 0.5 && text.split(' ').length < 4) {
        previous.name += ' ' + text;
        result.push(previous);
        continue;
      }
      if (!classMetadata && (markdown || typed || pdfHeading)) {
        let depth = markdown ? markdown[1].length : typed ? key(typed[1]) === 'feature' ? 4 : 3 : section || row.size >= row.bodySize * 1.7 ? 2 : 3;
        if (pdfHeading && !markdown && !typed && stack.some(entry => entry.depth === 3)
          && /^(?:spelllevel|[a-z]+level)spells$/.test(key(records[index + 1]?.text))) depth = 4;
        const explicit = text.length < 75 && text.match(/^(.+?)\s+\((?:[A-Za-z' -]+\s+)?(Subclass|Feat|Background|Species|Race)\)$/i);
        if (explicit) depth = 3;
        if (!levelLine(text) && !baseHeading(text) && !conditionalHeading(text) && !kindLine(text) && !bySpellHeading(text) && !/^\d+$/.test(text)) {
          while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
          const type = typed ? ownerKind(key(typed[1])) : explicit ? ownerKind(explicit[2]) : ownerKind(text) !== 'feature' ? ownerKind(text) : category;
          if (typed && key(typed[1]) !== 'feature') category = type;
          stack.push({ name: typed ? clean(typed[2]) : explicit ? explicit[1] : text, depth, kind: type, pageIndex: row.pageIndex, recordIndex: index, typed: Boolean(typed), size: row.size });
        }
      }
      const parent = stack.findLast(entry => entry.depth <= 3);
      result.push(inDefinition ? { name: '', kind: category } : parent || { name: '', kind: category });
    }
    return result;
  }

  function bySpellHeading(text) {
    return /^(?:Casting Time|Range|Components|Duration|At Higher Levels?|Using a Higher-Level Spell Slot)\b/i.test(text);
  }

  function resolve(spells, options = {}) {
    if (!spells.length) return spells;
    const pages = options.availabilityPages?.length ? options.availabilityPages : options.pages?.length ? options.pages : [{ page: null, text: options.text || '' }];
    const context = { ...options, kind: options.kind || (options.pages?.length ? 'pdf' : 'pasted'), selected: new Set((options.pages || []).map(page => page.page)) };
    const records = recordsFor(pages);
    const owners = ownerContexts(records);
    const customClasses = new Set();
    records.forEach((row, index) => {
      const explicit = row.text.match(/^(?:#{1,6}\s*)?Class:\s*(.+)$/i) || heading(row.text).match(/^Core (.+) Traits$/i);
      if (explicit) customClasses.add(key(explicit[1]));
      if (/^Class Features$/i.test(heading(row.text))) {
        const intro = clean(records[index + 1]?.text).match(/^As (?:a|an) (.+?), you (?:gain|have)\b/i);
        if (intro) customClasses.add(key(intro[1]));
      }
    });
    const byKey = new Map(spells.map(spell => [key(spell.name), spell]));
    const findings = new Map(spells.map(spell => [key(spell.name), { base: [], conditional: [], conflicts: [] }]));
    const addBase = (spell, name, record, method, excerpt) => {
      const entry = findings.get(key(spell.name));
      if (!entry.base.some(candidate => key(candidate.name) === key(name) && candidate._source.page === record.page && candidate.method === method))
        entry.base.push({ name, method, _source: reference(record, context, excerpt) });
    };
    const addConditional = (spell, owner, access, condition, record, extra = {}) => {
      if (!owner?.name) return;
      const entry = findings.get(key(spell.name));
      const candidate = { owner: owner.name, kind: owner.kind, access, condition: clean(condition).slice(0, 1600), ...extra, _source: reference(record, context, condition) };
      if (!entry.conditional.some(previous => key(previous.owner) === key(candidate.owner) && previous.access === access && previous._source.page === record.page
        && previous.level === candidate.level && previous.spellLevel === candidate.spellLevel && previous.levelUnclear === candidate.levelUnclear)) entry.conditional.push(candidate);
    };

    // Definition metadata belongs to this spell, never to preceding spell prose.
    for (let i = 0; i < records.length - 1; i++) {
      const spell = byKey.get(key(heading(records[i].text)));
      if (!spell || !kindLine(records[i + 1].text)) continue;
      const kind = clean(records[i + 1].text);
      const inline = kind.match(/^Level \d+ [A-Za-z]+\s*\(([^)]+)\)/i);
      if (inline) for (const name of classNames(inline[1]).filter(name => !/^ritual$/i.test(name))) addBase(spell, name, records[i + 1], 'definition');
      for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
        if (kindLine(records[j].text)) break;
        const introduction = clean(records[j].text).match(/^(?:This (?:new )?spell|(?:The )?(?:following|these) (?:new )?spells) (?:appears?|are|appear) (?:on|in) (?:the )?(.+?) spell lists?\.$/i);
        if (introduction) for (const name of classNames(introduction[1].replace(/'s\b/g, ''))) addBase(spell, name, records[j], 'definition');
      }
      let end = i + 2;
      while (end < records.length && !kindLine(records[end + 1]?.text)) end++;
      for (let j = i + 2; j < end; j++) {
        const match = clean(records[j].text).match(/^(?:Spell Lists?|Class(?:es)?)\s*[.:]\s*(.+)$/i);
        if (match) for (const name of classNames(match[1])) addBase(spell, name, records[j], 'definition');
      }
    }

    // Explicit class lists may continue into the next column and physical page.
    let active = null;
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const text = heading(row.text);
      const list = baseHeading(text);
      if (list && !conditionalHeading(text)) {
        const conditionalOwner = owners[i].pageIndex === row.pageIndex && ['feat', 'background', 'race', 'subclass'].includes(owners[i].kind);
        const name = conditionalOwner ? '' : classes.find(name => key(name) === key(list[1])) || (customClasses.has(key(list[1])) ? list[1] : '');
        active = name ? { name, pageIndex: row.pageIndex, page: row.page } : null;
        continue;
      }
      if (active && (row.pageIndex > active.pageIndex + 1 || Number.isInteger(row.page) && Number.isInteger(active.page) && row.page > active.page + 1 || conditionalHeading(text) || kindLine(records[i + 1]?.text)
        || /^(?:Spell Descriptions|Chapter\s+\d+|Feats|Backgrounds|Races|Species|Class Features)\b/i.test(text))) active = null;
      if (!active) continue;
      if (levelLine(text)) { active.pageIndex = row.pageIndex; active.page = row.page; }
      const entryName = text.replace(new RegExp(`\\s*\\(${school}(?:,\\s*ritual)?\\)$`, 'i'), '').replace(/^[-•]\s*/, '');
      const spell = byKey.get(key(entryName));
      if (spell) addBase(spell, active.name, row, 'class-list', `${active.name} spell list\n${row.text}`);
    }

    // Spell catalogue tables: ordinary Markdown tables and split PDF columns.
    for (const page of pages) {
      const local = records.filter(row => row.page === (page.page ?? null));
      let header = null;
      for (const row of local) {
        const columns = cells(row.text);
        if (columns.length < 2) { header = null; continue; }
        const spellColumn = columns.findIndex(value => /^(?:Spell|Name)$/i.test(value));
        const classColumn = columns.findIndex(value => /^(?:Classes?|Spell Lists?)$/i.test(value));
        if (spellColumn >= 0 && classColumn >= 0) { header = { spellColumn, classColumn }; continue; }
        if (header) {
          const spell = byKey.get(key(columns[header.spellColumn]));
          if (spell) for (const name of classNames(columns[header.classColumn])) addBase(spell, name, row, 'catalogue');
        }
      }
      const left = page.layout?.columns?.find(column => column.side === 'left');
      const right = page.layout?.columns?.find(column => column.side === 'right');
      if (left?.rows.some(row => /^Level\s+Spell\s+School$/i.test(row.text)) && right?.rows.some(row => /Ritual\s+Class$/i.test(row.text))) {
        for (const row of left.rows) {
          const match = clean(row.text).match(new RegExp(`^\\d+(?:st|nd|rd|th)\\s+(.+?)\\s+${school}$`, 'i'));
          const spell = match && byKey.get(key(match[1]));
          if (!spell) continue;
          const partner = right.rows.filter(other => Math.abs(other.y - row.y) < 4).sort((a, b) => Math.abs(a.y - row.y) - Math.abs(b.y - row.y))[0];
          const metadata = clean(partner?.text).match(/^(?:Yes|No)\s+(?:Yes|No)\s+(.+)$/i);
          const record = local.find(candidate => clean(candidate.text) === clean(row.text));
          if (metadata && record) for (const name of classNames(metadata[1])) addBase(spell, name, record, 'catalogue', `${row.text}\n${partner.text}`);
        }
      }
    }

    // Conditional tables retain their owner, grant semantics, and row level.
    let table = null;
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const columns = cells(row.text);
      const spellColumn = columns.findIndex(value => /^Spells?$/i.test(value));
      if (columns.length >= 2 && spellColumn >= 0 && columns.some(value => /level/i.test(value))) {
        const nearby = records.slice(Math.max(0, i - 18), i).map(record => record.text).join(' ');
        const access = tableAccess(nearby);
        table = { owner: owners[i], access, spellColumn, levelColumn: columns.findIndex(value => /level/i.test(value)),
          spellLevel: /spell level/i.test(columns.find(value => /level/i.test(value))), condition: clean(nearby).slice(-1000) };
        continue;
      }
      if (columns.length < 2) { table = null; continue; }
      if (!table || /^:?-{3,}:?$/.test(columns[table.levelColumn])) continue;
      const listed = columns[table.spellColumn];
      for (const spell of spells) if (containsName(listed, spell.name)) {
        addConditional(spell, table.owner, table.access, tableCondition(table.condition, row.text, table.access), row,
          tableLevel(columns[table.levelColumn], table.spellLevel ? 'spellLevel' : 'level'));
      }
    }

    // Some PDF layouts split a narrow table into a main and reference column.
    for (const page of pages) {
      const rows = (page.layout?.columns || []).flatMap(column => column.rows || []);
      for (const header of rows.filter(row => /^(?:spelllevel|[a-z]+level)(?:spells)?$/i.test(key(row.text)))) {
        const originX = Math.min(...header.items.map(item => item.x));
        const otherHeader = rows.find(row => /^Spells$/i.test(clean(row.text)) && Math.abs(row.y - header.y) < 4
          && Math.min(...row.items.map(item => item.x)) > originX);
        if (!/\bSpells$/i.test(header.text) && !otherHeader) continue;
        const recordIndex = records.findIndex(row => row.page === page.page && row.text === header.text);
        if (recordIndex < 0) continue;
        const nearby = records.slice(Math.max(0, recordIndex - 18), recordIndex).map(row => row.text).join(' ');
        const owner = owners[recordIndex];
        if (!owner.name || !/\bspells\b/i.test(nearby)) continue;
        for (const row of rows) {
          if (row.y >= header.y || row.y < header.y - 100 || Math.abs(Math.min(...row.items.map(item => item.x)) - originX) > 30) continue;
          const match = clean(row.text).match(/^(\d+|Cantrips?|[%?IlOS])(?:st|nd|rd|th)?(?:\s+(.+))?$/i);
          if (!match || Number(match[1]) > 20) continue;
          const companion = otherHeader && rows.find(other => Math.abs(other.y - row.y) < 4
            && Math.abs(Math.min(...other.items.map(item => item.x)) - Math.min(...otherHeader.items.map(item => item.x))) < 5);
          const spellsX = companion ? Math.min(...companion.items.map(item => item.x)) : row.items.find(item => /[A-Za-z]{3}/.test(item.str) && !/^Cantrips?$/i.test(item.str))?.x;
          const nextLevelRow = rows.filter(next => next.y < row.y && next.y > row.y - 32 && /^\d+(?:st|nd|rd|th)?\s/.test(next.text)
            && Math.abs(Math.min(...next.items.map(item => item.x)) - Math.min(...row.items.map(item => item.x))) < 5).sort((a, b) => b.y - a.y)[0];
          const wrapped = Number.isFinite(spellsX) ? rows.filter(next => next.y < row.y - 3 && next.y > (nextLevelRow ? nextLevelRow.y : row.y - 22)
            && Math.abs(Math.min(...next.items.map(item => item.x)) - spellsX) < 5).map(next => next.text) : [];
          const listed = [match[2] || companion?.text, ...wrapped].filter(Boolean).join(' ');
          if (!listed) continue;
          const record = records.find(record => record.page === page.page && record.text === row.text);
          if (!record) continue;
          const levelField = key(header.text).startsWith('spelllevel') ? 'spellLevel' : 'level';
          for (const spell of spells) if (containsName(listed, spell.name))
            addConditional(spell, owner, tableAccess(nearby), tableCondition(nearby, `${row.text}\n${companion?.text || ''}\n${wrapped.join('\n')}`, tableAccess(nearby)), record,
              tableLevel(match[1], levelField));
        }
      }
    }

    for (const spell of spells) spell.classes = unique(findings.get(key(spell.name)).base.map(entry => entry.name).concat(spell.classes || []));

    // Named grants and list-based choices require explicit granting language.
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      if (row.text.includes('|') || kindLine(row.text) || !owners[i]?.name
        || /^(?:Class Features|Spellcasting|Pact Magic|Spells Known.*|Spell Slots|Spell Descriptions|Spell Lists?|Cantrips)$/i.test(owners[i].name)) continue;
      const block = [row];
      for (let j = i + 1; j < Math.min(records.length, i + 24); j++) {
        const next = records[j];
        if (owners[j]?.name !== owners[i].name || next.text.includes('|') || kindLine(next.text) || kindLine(records[j + 1]?.text)
          || /^(?:[-•]\s*)?[A-Z][a-z'’]+(?:\s+(?:[A-Z][a-z'’]+|of|the|to|and|a|an)){0,5}\.\s/.test(next.text)) break;
        block.push(next);
      }
      const previous = records[i - 1];
      const prefixLine = previous && owners[i - 1]?.name === owners[i].name && /(?:when you reach|at \d+(?:st|nd|rd|th)? level|provided|if)\b/i.test(previous.text) && /,$/.test(previous.text) ? previous.text + ' ' : '';
      const window = prefixLine + block.map(next => clean(next.text)).join(' ');
      if (!/\b(?:you (?:always have|know|learn|can cast)|you also (?:always have|know|learn|can cast))\b/i.test(window)) continue;
      const grant = window.match(/\byou (?:also )?(?:always have|know|learn|can cast)\b/i);
      if (grant.index > prefixLine.length + clean(row.text).length) continue;
      if (/\bfor example\b|\bsuppose\b|\bif\s*$/i.test(window.slice(0, grant.index))) continue;
      const condition = window;
      for (const spell of spells) {
        const name = clean(spell.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        const sentence = condition.split(/(?<=[.!?])\s+/).find(sentence => new RegExp(`\\b${name}\\b`, 'i').test(sentence)
          && /\byou (?:also )?(?:always have|know|learn|can cast)\b/i.test(sentence));
        const namedMatch = sentence && new RegExp(`\\b${name}\\b`, 'i').exec(sentence);
        const named = Boolean(namedMatch);
        const choice = /\bchoice\b|\bchoose\b/i.test(condition) && /spell list/i.test(condition)
          && spell.classes.some(name => new RegExp(`\\b${name}\\b`, 'i').test(condition))
          && (/cantrip/i.test(condition) && Number(spell.level) === 0 || new RegExp(`(?:level ${spell.level}|${spell.level}(?:st|nd|rd|th)[- ]level) spell`, 'i').test(condition));
        const sentenceOffset = sentence ? window.indexOf(sentence) : 0;
        const prefix = namedMatch ? window.slice(sentenceOffset > 0 ? window.lastIndexOf('.', sentenceOffset - 1) + 1 : 0, sentenceOffset + namedMatch.index) : window;
        const level = prefix.match(/(?:character level|reach(?:es)?(?: character)?|at)\s+(\d+)(?:st|nd|rd|th)?(?:\s+level)?/i);
        const access = choice && !named ? 'choice' : /always have.*prepared/i.test(sentence || '') ? 'prepared' : /\bknow\b|\blearn\b/i.test(sentence || '') ? 'known' : 'innate';
        if (named || choice) addConditional(spell, owners[i], access, condition, row, level ? { level: Number(level[1]) } : {});
      }
    }

    for (const spell of spells) {
      const entry = findings.get(key(spell.name));
      if (spell.classes?.length) {
        const definition = records.find((row, i) => key(heading(row.text)) === key(spell.name) && kindLine(records[i + 1]?.text));
        for (const name of spell.classes) if (!entry.base.some(entry => key(entry.name) === key(name)))
          addBase(spell, name, definition || { page: null, line: null, text: `${spell.name}: ${name} (parsed definition metadata)` }, 'definition');
      }
      spell.classes = unique(entry.base.map(candidate => candidate.name));
      const definitive = ['definition', 'catalogue'].map(method => unique(entry.base.filter(candidate => candidate.method === method).map(candidate => candidate.name)).sort().join(','));
      if (definitive.every(Boolean) && definitive[0] !== definitive[1]) entry.conflicts.push({ message: 'The definition and spell catalogue disagree about the base class lists. Compare both sources before exporting.' });
      spell.availability = entry;
    }
    return spells;
  }

  function contextPages(spells) {
    return [...new Set((spells || []).flatMap(spell => [...(spell.availability?.base || []), ...(spell.availability?.conditional || [])])
      .filter(entry => entry._source?.availabilityContext && Number.isInteger(entry._source.page)).map(entry => entry._source.page))].sort((a, b) => a - b);
  }

  return { resolve, recordsFor, classNames, contextPages };
});
