// Dispatcher: citation -> resolved context payload for the right-hand pane.

import { resolveCfr, resolveCfrPart, cfrLinks } from './cfr.js';
import { resolveUsc, uscLinks } from './usc.js';
import { findAct } from './popular-names.js';
import { resolveActSection, resolveActTitle } from './act-sections.js';
import { resolvePlaw, resolvePlawDivision } from './plaw.js';

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

/**
 * Does the section the index found sit in the division the bill named?
 *
 * An omnibus Public Law restarts its section numbering in every division, so
 * "section 110 of Public Law 114-113" names two different provisions and the
 * Act index — keyed on the bare number — returns whichever one was codified.
 * That is how "Section 110(a) of the Department of Commerce Appropriations
 * Act, 2016 (Public Law 114-113)", which is division B, resolved to
 * 6 U.S.C. 1509, whose credit reads "Pub. L. 114-113, div. N, title I, § 110".
 * A real provision, about cybersecurity information sharing, and not the one
 * cited.
 *
 * The Code prints the division in the credit, so the check is free: if the
 * credit names one and the citation did not name the same one, the number is
 * ambiguous and this declines. A credit with no division cannot disagree.
 *
 * Only the *enacting* clause may be read, which is the same rule the ingester
 * follows in building the index and it is load-bearing for the same reason.
 * 42 U.S.C. 15883 is credited
 *
 *   (Pub. L. 109–58, title II, § 247, as added Pub. L. 117–58, div. D, …)
 *
 * and the only division named there belongs to Pub. L. 117-58 — the law that
 * *added* the section — not to Pub. L. 109-58, the law being cited. Reading the
 * whole string found "div. D", disagreed with a citation that named no division,
 * and declined a provision it had correctly identified.
 */
function enactingClause(credit) {
  return String(credit || '')
    .replace(/^\s*\(/, '')
    .split(';')[0]
    .split(/,\s*as\s+(?:added|amended|renumbered)\b/)[0];
}

function divisionAgrees(cite, credit) {
  const m = /\bdiv\.?\s+([A-Z]{1,2})\b/.exec(enactingClause(credit));
  if (!m) return true;
  return Boolean(cite.division) && cite.division === m[1].toUpperCase();
}

/**
 * The Public Law behind an Act's name, where the Act *is* one law.
 *
 * Read off whichever field records it: `enactedAs` for the Acts wired to the
 * source-credit index, `range` for the ones that only ever carried it as a
 * note. Acts codified out of many laws (the Clean Air Act, "July 14, 1955,
 * ch. 360") have no single Public Law and correctly return null.
 */
function publawIdOf(act) {
  const m = /Pub\. L\. (\d{1,3})[–—-](\d{1,4})/.exec(`${act.enactedAs || ''} ${act.range || ''}`);
  return m ? { congress: m[1], law: m[2] } : null;
}

/**
 * Where the whole Act sits in the Code, as a phrase a reader can act on.
 *
 * `range` is overloaded across the 182 entries that carry one, and the card that
 * printed it raw said something different — and sometimes untrue — for each
 * shape. "the Act runs to 7401 et seq." drops the title, so it names no
 * provision at all; "the Act runs to Pub. L. 116-136" calls an enacting law a
 * range; and "the Act runs to title 26 generally" reads to anyone not steeped in
 * citation form as though the Act HAS 26 titles, when it means the Internal
 * Revenue Code is classified TO title 26. That last one was misread in exactly
 * that way the first time a reader met it.
 *
 * So each shape gets its own sentence, and a shape with nothing useful to say
 * ("varies", a bare chapter) says nothing. Returning null is a real answer here:
 * the card still names the Act and shows its first section.
 */
function rangeLabel(act) {
  const range = act.range;
  if (!range || range === 'varies') return null;
  // "1531 et seq." already ends in a full stop and "title 26 generally" does
  // not, so the sentence closes itself rather than always appending one.
  const stop = (s) => (/[.]$/.test(s) ? s : `${s}.`);
  // "title 26 generally" — the Act is codified as a whole title.
  if (/^title\s/i.test(range)) return stop(`The whole Act is codified at ${range}`);
  // "1531 et seq." — a section range inside the Act's own title, which the
  // entry records separately and which the phrase is useless without.
  if (/^[0-9]/.test(range) && act.title) {
    return stop(`The whole Act is codified at ${act.title} U.S.C. ${range}`);
  }
  // "Pub. L. 116-136" — not a codification range at all. Say what it is.
  if (/^Pub\. L\./i.test(range)) return stop(`The Act as a whole is ${range}`);
  return null;
}

/** The three places a Public Law can be read outside this app. */
function publawLinks(cite) {
  return [
    { label: 'govinfo (text)', href: `https://www.govinfo.gov/link/plaw/${cite.congress}/public/${cite.law}` },
    { label: 'congress.gov', href: `https://www.congress.gov/public-laws/${cite.congress}th-congress` },
    {
      label: 'Statutes at Large',
      href: `https://www.govinfo.gov/app/search/%7B%22query%22%3A%22${encodeURIComponent(
        `Public Law ${cite.congress}-${cite.law}`
      )}%22%7D`,
    },
  ];
}

function cacheKey(c) {
  // `actSection` is load-bearing: without it "section 1861 of the Social
  // Security Act" and "section 1862 of the Social Security Act" key alike — same
  // kind, same Act, no `section` of their own — and the second citation would be
  // served the first one's provision out of the cache.
  // `division` is load-bearing for the same reason, and was missed for the same
  // reason. "Section 110 of division N of Public Law 114-113" and "Section 110
  // of Public Law 114-113" are the same kind, the same law and the same section
  // — they differ only in whether the division is named, which is precisely
  // what decides whether the answer is 6 U.S.C. 1509 or a decline. Without it
  // the first of the two to be clicked answered for both.
  // `where` for the third time: it is the division plus every level below it, so
  // "section 702 of subtitle A of title VII of division N" and "section 702 of
  // division N" agree on `division` and name different provisions.
  // `shortTitle` for the fourth. It narrows a section to the division whose
  // heading it names, so "section 505 of the Department of Homeland Security
  // Appropriations Act, 2018 (Public Law 115-141)" resolves to division F and a
  // bare "section 505 of Public Law 115-141" must still show all five. Without
  // it the first clicked answered for both — and the wrong way round, since the
  // bare citation would inherit a division nothing in it named.
  return [c.kind, c.title, c.part, c.section, c.subsection, c.congress, c.law, c.volume, c.page,
          c.act && c.act.name, c.actSection, c.division, c.where && c.where.join('>'),
          c.shortTitle, c.actTitle && `t${c.actTitle}`]
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

      // "division J of the …" names a division of the Public Law behind the
      // name. Answered before the Act's codified head, because a division is a
      // far more specific thing than the Act it sits in — and the head would be
      // 630 sections away from what was cited.
      //
      // Only where no section is named. "section 2118(a) of title II of
      // division A of the CARES Act" gives both, and the section is the more
      // specific of the two: answering with division A's contents would hand
      // back a list of 300 sections when the citation named one of them.
      if (cite.division && !cite.actSection) {
        const pl = publawIdOf(act);
        if (pl) {
          const local = await resolvePlawDivision(
            pl.congress,
            pl.law,
            cite.where || [`DIVISION ${cite.division}`]
          );
          if (local) return { ...local, actName: act.name };
        }
      }

      // "title V of the Housing Act of 1949" — a title is a range, like a
      // division, and the credits say which Code sections are in it. Answered
      // before the head of the Act for the same reason: 40 sections beats 44,
      // and the reader named the 40.
      //
      // Only where no section is named, the same rule the division follows.
      if (cite.actTitle && !cite.actSection) {
        const inTitle = await resolveActTitle(act, cite.actTitle);
        if (inTitle) {
          const parts = inTitle.map((w) => {
            const at = w.indexOf(':');
            return { title: w.slice(0, at), section: w.slice(at + 1) };
          });
          const first = await resolveUsc({ ...parts[0], subsection: '' });
          return {
            ...first,
            source: 'Act (title)',
            actName: act.name,
            citation: `${act.name}, title ${cite.actTitle}`,
            actTitle: {
              act: act.name,
              title: cite.actTitle,
              enactedAs: act.enactedAs,
              sections: parts,
            },
            isActStart: false,
          };
        }
      }

      // "Section 1861 of the Social Security Act" names a provision, not a
      // range — but in the Act's own numbering, which is not the Code's. The
      // Act-section table (built by the ingester out of the Code's source
      // credits) is the only thing that can close that gap; where it answers,
      // this is an ordinary U.S. Code resolution with its derivation attached,
      // and where it doesn't we fall through to the head of the Act exactly as
      // before. A miss is common and is never guessed at: the section may have
      // been repealed out of the Code, or two sections may have claimed it.
      if (cite.actSection) {
        const at = await resolveActSection(act, cite.actSection);
        if (at) {
          const res = await resolveUsc({
            title: at.title,
            section: at.section,
            subsection: cite.subsection || '',
          });
          return {
            ...res,
            actName: act.name,
            viaActSection: {
              act: act.name,
              actSection: cite.actSection,
              enactedAs: act.enactedAs,
              codified: `${at.title} U.S.C. ${at.section}`,
            },
          };
        }
      }

      // The Act names a section the Code index cannot place — uncodified, or
      // codified somewhere its credit does not say. Where the Act *is* a Public
      // Law we hold, its own text can still answer, exactly as it does for
      // "section N of Public Law X-Y". Without this the reader was sent to the
      // head of the Act for a section we have sitting on disk.
      if (cite.actSection) {
        const pl = publawIdOf(act);
        if (pl) {
          const local = await resolvePlaw(pl.congress, pl.law, cite.actSection, cite.where, cite.shortTitle);
          if (local) return { ...local, actName: act.name };
        }
      }

      // An Act name on its own points at a range, not a provision. Resolve the
      // Act's first codified section so the pane has something concrete, but
      // label it clearly as the start of the Act rather than "the" provision.
      const start = await resolveUsc({ title: act.title, section: act.section, subsection: '' });
      return {
        ...start,
        source: 'Act (popular name)',
        actName: act.name,
        citation: act.name,
        range: rangeLabel(act),
        offsetNote: act.offsetNote || null,
        isActStart: true,
      };
    }

    case 'publaw': {
      // "division E of Public Law 110-161" — a division with no section is an
      // address, and the same one the named-Act path already answers for
      // "division J of the Infrastructure Investment and Jobs Act". Answered
      // first and only where no section is named, for the reason given there:
      // where the citation gives both, the section is the more specific.
      if (cite.division && !cite.actSection) {
        const local = await resolvePlawDivision(
          cite.congress,
          cite.law,
          cite.where || [`DIVISION ${cite.division}`]
        );
        if (local) return { ...local, links: publawLinks(cite) };
      }

      // "section 12306 of Public Law 113-79" names a provision, and the Code's
      // own source credits say where it landed — 7 U.S.C. 1632c. That table is
      // already on disk for 1,737 Public Laws, built by the ingester alongside
      // the named-Act one, so this costs a static GET and nothing else.
      //
      // A miss is the common case and is never guessed at: most of a Public Law
      // never enters the Code at all (appropriations, effective dates, findings),
      // and an uncodified section has no Code section to point at. Those fall
      // through to the link, exactly as before.
      if (cite.actSection) {
        const enactedAs = `Pub. L. ${cite.congress}-${cite.law}`;
        const at = await resolveActSection({ enactedAs }, cite.actSection);
        if (at) {
          const res = await resolveUsc({
            title: at.title,
            section: at.section,
            subsection: cite.subsection || '',
          });
          if (!res.missing && !res.error && divisionAgrees(cite, res.sourceCredit)) {
            return {
              ...res,
              viaActSection: {
                act: enactedAs,
                actSection: cite.actSection,
                enactedAs,
                codified: `${at.title} U.S.C. ${at.section}`,
              },
            };
          }
        }
      }
      // Not codified, or not codified in a way the index could see. If we hold
      // the law's own text, that is the only thing left that can answer — and
      // for an appropriations line, an effective date or a savings clause it is
      // the *right* answer, since there was never going to be a Code section.
      const local = await resolvePlaw(
        cite.congress,
        cite.law,
        cite.actSection || '',
        cite.where,
        cite.shortTitle
      );
      if (local) return { ...local, links: publawLinks(cite) };

      // "section 6015 of the Farm Security and Rural Investment Act of 2002
      // (Public Law 107-171)" — the bill wrote the Act's name down, and where
      // that name is one we know, the start of the Act is the answer this had
      // before the parenthetical was being read at all. Dropping to the link
      // instead would make the richer citation the poorer answer, which is the
      // wrong way round: this form should never resolve to less than its parts.
      const named = cite.shortTitle && findAct(cite.shortTitle);
      if (named) {
        const start = await resolveUsc({ title: named.title, section: named.section, subsection: '' });
        return {
          ...start,
          source: 'Act (popular name)',
          actName: named.name,
          citation: named.name,
          range: rangeLabel(named),
          offsetNote: named.offsetNote || null,
          isActStart: true,
          links: publawLinks(cite),
        };
      }

      return {
        source: 'Public Law',
        citation: `Pub. L. ${cite.congress}-${cite.law}`,
        external: true,
        note: "Unfortunately, Public Laws don't play nice with our scraper: here's the link",
        // Rendered inside the note's own sentence, not in the row below it —
        // the sentence ends by promising a link, so one has to be right there.
        // The alternatives still appear under "Read elsewhere".
        noteLink: {
          label: `Pub. L. ${cite.congress}-${cite.law} on govinfo`,
          href: `https://www.govinfo.gov/link/plaw/${cite.congress}/public/${cite.law}`,
        },
        links: publawLinks(cite),
      };
    }

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
