// CFR resolution against the live eCFR API.
//
// eCFR serves `access-control-allow-origin: *`, so we query it straight from the
// browser — no proxy, and no reason to pre-ingest 5GB of regulation that goes
// stale the moment you snapshot it. The one thing we cache is the per-title
// "latest issue date", which every content request needs as a path segment.

import { buildTree } from './provision-tree.js';

const API = 'https://www.ecfr.gov/api/versioner/v1';
const WEB = 'https://www.ecfr.gov/current';

let titleDatesPromise = null;
const contentCache = new Map();

/** Map of title number -> latest issue date (YYYY-MM-DD). Fetched once. */
function titleDates() {
  if (!titleDatesPromise) {
    titleDatesPromise = fetch(`${API}/titles.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`eCFR titles ${r.status}`);
        return r.json();
      })
      .then((j) => {
        const map = new Map();
        for (const t of j.titles || []) {
          if (t.latest_issue_date) map.set(String(t.number), t.latest_issue_date);
        }
        return map;
      })
      .catch((err) => {
        titleDatesPromise = null; // let a later call retry
        throw err;
      });
  }
  return titleDatesPromise;
}

function textOf(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Pull the paragraph run out of an eCFR <DIV8> section element. */
function sectionFromDiv(div) {
  const head = div.querySelector(':scope > HEAD');
  const headText = head ? textOf(head) : '';
  const paras = [];
  for (const p of div.querySelectorAll(':scope > P, :scope > FP')) {
    const t = textOf(p);
    if (t) paras.push(t);
  }
  // Section headings arrive as "§ 60.1 Applicability." — split number from title.
  const hm = headText.match(/^§+\s*([\d.\w-]+)\s*(.*)$/);
  return {
    number: hm ? hm[1] : div.getAttribute('N') || '',
    heading: hm ? hm[2].replace(/\.$/, '') : headText,
    paragraphs: paras,
    tree: buildTree(paras),
  };
}

async function fetchXml(url) {
  if (contentCache.has(url)) return contentCache.get(url);
  const p = fetch(url)
    .then(async (r) => {
      if (!r.ok) throw new Error(`eCFR ${r.status} for ${url}`);
      const xml = await r.text();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('eCFR returned unparseable XML');
      return doc;
    })
    .catch((err) => {
      contentCache.delete(url);
      throw err;
    });
  contentCache.set(url, p);
  return p;
}

/**
 * Resolve a CFR citation to its text plus the ancestry chain above it.
 *
 * @param {{title:string, part:string, section:string, subsection:string}} cite
 */
export async function resolveCfr(cite) {
  const { title, part, section } = cite;
  const dates = await titleDates();
  const date = dates.get(String(title));
  if (!date) throw new Error(`CFR title ${title} not found in eCFR`);

  const q = new URLSearchParams({ part });
  if (section) q.set('section', section);

  const [doc, ancestry] = await Promise.all([
    fetchXml(`${API}/full/${date}/title-${title}.xml?${q}`),
    fetch(`${API}/ancestry/${date}/title-${title}.json?${q}`)
      .then((r) => (r.ok ? r.json() : { ancestors: [] }))
      .catch(() => ({ ancestors: [] })),
  ]);

  const root = doc.documentElement;
  let sections;
  if (root.getAttribute('TYPE') === 'SECTION') {
    sections = [sectionFromDiv(root)];
  } else {
    // A whole part came back — collect its sections so the UI can show siblings.
    sections = Array.from(doc.querySelectorAll('DIV8[TYPE="SECTION"]')).map(sectionFromDiv);
  }

  const crumbs = (ancestry.ancestors || []).map((a) => ({
    type: a.type,
    label: (a.label || '').trim(),
    short: (a.label_level || '').trim(),
    identifier: a.identifier,
  }));

  return {
    source: 'eCFR',
    asOf: date,
    upToDate: true,
    citation: section ? `${title} CFR ${section}` : `${title} CFR part ${part}`,
    crumbs,
    sections,
    // The section the citation actually names, when we fetched a whole part.
    focus: section ? sections.find((s) => s.number === section) || sections[0] : sections[0],
    links: cfrLinks(cite),
  };
}

/** Fetch the parent part of a section — the "zoom out one level" action. */
export async function resolveCfrPart(cite) {
  return resolveCfr({ ...cite, section: '' });
}

export function cfrLinks(cite) {
  const { title, part, section } = cite;
  const out = [
    {
      label: 'eCFR',
      href: section ? `${WEB}/title-${title}/section-${section}` : `${WEB}/title-${title}/part-${part}`,
    },
    {
      label: 'Cornell LII',
      href: section
        ? `https://www.law.cornell.edu/cfr/text/${title}/${section}`
        : `https://www.law.cornell.edu/cfr/text/${title}/part-${part}`,
    },
    {
      label: 'govinfo',
      href: `https://www.govinfo.gov/app/search/%7B%22query%22%3A%22${encodeURIComponent(
        `${title} CFR ${section || part}`
      )}%22%7D`,
    },
  ];
  return out;
}
