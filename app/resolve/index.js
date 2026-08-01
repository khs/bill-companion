// Dispatcher: citation -> resolved context payload for the right-hand pane.

import { resolveCfr, resolveCfrPart, cfrLinks } from './cfr.js';
import { resolveUsc, uscLinks } from './usc.js';
import { findAct } from './popular-names.js';

const cache = new Map();

export async function resolve(cite) {
  const key = cacheKey(cite);
  if (cache.has(key)) return cache.get(key);
  const p = dispatch(cite).catch((err) => {
    cache.delete(key);
    return {
      source: 'error',
      citation: cite.text,
      error: err.message || String(err),
      links: fallbackLinks(cite),
    };
  });
  cache.set(key, p);
  return p;
}

function cacheKey(c) {
  return [c.kind, c.title, c.part, c.section, c.subsection, c.congress, c.law, c.volume, c.page, c.act && c.act.name]
    .filter(Boolean)
    .join('|');
}

async function dispatch(cite) {
  switch (cite.kind) {
    case 'cfr':
      return resolveCfr(cite);

    case 'usc':
      return resolveUsc(cite);

    case 'act': {
      const act = cite.act;
      // An Act name on its own points at a range, not a provision. Resolve the
      // Act's first codified section so the pane has something concrete, but
      // label it clearly as the start of the Act rather than "the" provision.
      const start = await resolveUsc({ title: act.title, section: act.section, subsection: '' });
      return {
        ...start,
        source: 'Act (popular name)',
        actName: act.name,
        citation: act.name,
        range: act.range || null,
        offsetNote: act.offsetNote || null,
        isActStart: true,
      };
    }

    case 'publaw':
      return {
        source: 'Public Law',
        citation: `Pub. L. ${cite.congress}-${cite.law}`,
        external: true,
        note:
          'Public Laws are served by govinfo and congress.gov, neither of which allows ' +
          'cross-origin browser requests. Opening the text requires following a link.',
        links: [
          { label: 'govinfo (text)', href: `https://www.govinfo.gov/link/plaw/${cite.congress}/public/${cite.law}` },
          { label: 'congress.gov', href: `https://www.congress.gov/public-laws/${cite.congress}th-congress` },
          {
            label: 'Statutes at Large',
            href: `https://www.govinfo.gov/app/search/%7B%22query%22%3A%22${encodeURIComponent(
              `Public Law ${cite.congress}-${cite.law}`
            )}%22%7D`,
          },
        ],
      };

    case 'stat':
      return {
        source: 'Statutes at Large',
        citation: `${cite.volume} Stat. ${cite.page}`,
        external: true,
        links: [
          {
            label: 'govinfo',
            href: `https://www.govinfo.gov/app/search/%7B%22query%22%3A%22${encodeURIComponent(
              `${cite.volume} Stat. ${cite.page}`
            )}%22%7D`,
          },
          { label: 'Library of Congress', href: 'https://www.loc.gov/collections/united-states-statutes-at-large/' },
        ],
      };

    case 'internal':
      // The note is only ever seen when the reference could NOT be located —
      // main.js attaches `target` and the pane shows that instead. Saying
      // "points at another part of the provision currently being amended" as
      // the normal answer just repeated the words the reader had clicked.
      return {
        source: 'Internal reference',
        citation: cite.text,
        internal: true,
        note:
          cite.scope === 'act'
            ? `This points at ${cite.section ? `section ${cite.section}` : 'another section'} of this same ` +
              `bill, which isn't in the text loaded here — bills often cite sections of an Act they are ` +
              `only one division of.`
            : `This points at another part of the provision being amended, but no ${cite.subsection || 'matching'} ` +
              `appears at the head of a line anywhere in this section of the bill, so there is nothing to show. ` +
              `That usually means the provision it refers to lives in the U.S. Code rather than in the bill text.`,
        links: [],
      };

    default:
      return { source: 'unknown', citation: cite.text, links: [] };
  }
}

function fallbackLinks(cite) {
  if (cite.kind === 'cfr') return cfrLinks(cite);
  if (cite.kind === 'usc') return uscLinks(cite);
  return [];
}

export { resolveCfrPart, findAct };
