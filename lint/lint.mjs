/**
 * PR lint: title, required body sections, and base-branch rules.
 *
 * Pure — no GitHub calls — so the same function runs in CI, in the backtest
 * over old PRs, and in unit tests. All policy lives in pr-rules.json; this file
 * only knows how to read it.
 *
 * lintPr({ repo, title, body, base, files, labels }, rules)
 *   → { type, problems: [{ rule, message }] }   (empty problems = pass)
 */

const NONE = /^(none|n\/a|无)\b/i;

export function parseTitle(title, rules) {
  const types = Object.keys(rules.types).join('|');
  const m = new RegExp(`^(${types})(\\(([A-Za-z0-9][A-Za-z0-9._/-]*)\\))?(!)?: +(\\S.*)$`).exec(title.trim());
  return m ? { type: m[1], scope: m[3] ?? null, breaking: Boolean(m[4]), description: m[5] } : null;
}

/** `## Heading` → section text, HTML comments removed and trimmed. Headings match case-insensitively. */
export function parseSections(body) {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n');
  const sections = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = h[1].toLowerCase();
      sections.set(current, []);
    } else if (/^#\s/.test(line)) {
      current = null;
    } else if (current) {
      sections.get(current).push(line);
    }
  }
  return new Map([...sections].map(([k, lines]) => [k, lines.join('\n').trim()]));
}

function sectionText(sections, heading) {
  const want = heading.toLowerCase();
  for (const [k, v] of sections) if (k === want || k.startsWith(`${want} `) || k.startsWith(`${want}(`)) return v;
  return undefined;
}

function fileRuleApplies(rule, { repo, type, files }) {
  if (rule.repos && !rule.repos.includes(repo)) return false;
  if (rule.types && !rule.types.includes(type)) return false;
  return files.some((f) =>
    (rule.files ?? [null]).some((prefix) => prefix === null || f.startsWith(prefix) || f.split('/').pop().startsWith(prefix)) &&
    (!rule.suffix || f.endsWith(rule.suffix)),
  );
}

export function lintPr({ repo, title, body = '', base, files = [], labels = [] }, rules) {
  const problems = [];
  const add = (rule, message) => problems.push({ rule, message });

  if (labels.includes(rules.skipLabel)) return { type: null, skipped: true, problems };

  // Title
  const parsed = parseTitle(title, rules);
  if (!parsed) {
    add('title', `Title must be \`type(scope): description\` with type one of: ${Object.keys(rules.types).join(', ')}. Scope is optional.`);
  } else if (title.trim().length > rules.titleMaxLength) {
    add('title-length', `Title is ${title.trim().length} characters; keep it under ${rules.titleMaxLength}.`);
  }
  const type = parsed?.type ?? null;
  const spec = type ? rules.types[type] : null;

  // Base branch
  if (type && rules.mainOnlyTypes.includes(type) && base !== rules.defaultBranch) {
    add('base', `\`${type}\` PRs go to \`${rules.defaultBranch}\`; this one targets \`${base}\`.`);
  }
  if (type && rules.releaseRepos.includes(repo) && base === rules.defaultBranch && !rules.mainAllowedTypesInReleaseRepos.includes(type)) {
    add('base', `In ${repo}, \`main\` is prod. Day-to-day \`${type}\` changes go to the current version branch; only ${rules.mainAllowedTypesInReleaseRepos.map((t) => `\`${t}\``).join(', ')} target \`main\`.`);
  }

  // Body sections
  if (spec) {
    const sections = parseSections(body);
    const noneOk = (key) => (rules.noneAllowedSections ?? []).includes(key);
    const required = new Map(spec.required.map((key) => [key, { noneAllowed: noneOk(key), why: null }]));
    for (const rule of rules.fileRules) {
      if (fileRuleApplies(rule, { repo, type, files })) {
        const prev = required.get(rule.require);
        required.set(rule.require, { noneAllowed: noneOk(rule.require) && rule.noneAllowed && (prev ? prev.noneAllowed : true), why: rule.why });
      }
    }
    for (const [key, { noneAllowed, why }] of required) {
      const heading = rules.sections[key];
      const text = sectionText(sections, heading);
      if (!text) {
        add(`section:${key}`, why ? `Missing \`## ${heading}\` — ${why}` : `Missing \`## ${heading}\` (required for \`${type}\`).`);
        continue;
      }
      if (NONE.test(text)) {
        if (!noneAllowed) add(`section:${key}`, `\`## ${heading}\` can't be None here${why ? ` — ${why}` : '.'}`);
        else if ((spec.noneNeedsReason ?? []).includes(key) && text.replace(NONE, '').replace(/^[\s—–:-]+/, '').length < 8) {
          add(`section:${key}`, `\`## ${heading}\` says None — add one line on why there's no ticket.`);
        }
      }
    }
    if (spec.verifiedMustMention) {
      const text = sectionText(sections, rules.sections.verified) ?? '';
      const missing = spec.verifiedMustMention.filter((w) => !new RegExp(`\\b${w}\\b`, 'i').test(text));
      if (text && missing.length) add('section:verified', `\`${type}\` changes output: \`## ${rules.sections.verified}\` needs a ${spec.verifiedMustMention.join(' / ')} comparison (missing: ${missing.join(', ')}).`);
    }
  }

  return { type, problems };
}
