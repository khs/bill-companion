// Popular-name table: Act name -> where it lives in the U.S. Code.
//
// Bills overwhelmingly cite Acts by name ("the Social Security Act") rather than
// by code, and the name alone doesn't tell you the codified location. `pattern`
// is a regex fragment spliced into a \b...\b match, so keep it anchored and
// avoid capturing groups.
//
// `title`/`section` point at the *start* of the Act in the Code. Where an Act's
// internal numbering differs from its codified numbering (Social Security Act
// § 1861 is 42 U.S.C. 1395x, not 42 U.S.C. 1861), `offsetNote` explains the gap
// so the UI can warn instead of silently resolving to the wrong provision.
//
// `enactedAs` closes that gap rather than describing it. It is the Act as its
// own sections' source credits name it — "Aug. 14, 1935, ch. 531" for the SSA —
// and it is the key into `data/usc/acts/`, the Act-section → Code-section table
// the ingester derives from those credits. With it, "Section 1861 of the Social
// Security Act" resolves to 42 U.S.C. 1395x; without it the citation still lands
// on the head of the Act, carrying `offsetNote` as before.
//
// It must be spelled exactly as the Code spells it, EN DASH and all — the value
// is slugged, so "Pub. L. 89–10" and "Pub. L. 89-10" agree, but a wrong date or
// chapter number silently indexes nothing. Verify a new one against a shard's
// `sourceCredit` before adding it.

export const POPULAR_NAMES = [
  {
    name: 'Social Security Act',
    pattern: 'Social\\s+Security\\s+Act',
    title: '42',
    section: '301',
    range: '301 et seq.',
    enactedAs: 'Aug. 14, 1935, ch. 531',
    offsetNote:
      'Social Security Act section numbers do NOT match their 42 U.S.C. numbers ' +
      '(e.g. SSA § 1861 = 42 U.S.C. 1395x). Use the parenthetical U.S.C. cite in the bill.',
  },
  { name: 'Clean Air Act', pattern: 'Clean\\s+Air\\s+Act', title: '42', section: '7401', range: '7401 et seq.' },
  { name: 'Clean Water Act', pattern: '(?:Clean\\s+Water\\s+Act|Federal\\s+Water\\s+Pollution\\s+Control\\s+Act)', title: '33', section: '1251', range: '1251 et seq.' },
  // The one Act in this table whose own section numbers ARE the Code's: IRC § 45K
  // is 26 U.S.C. 45K. `sectionsMatchCode` lets the citation extractor resolve
  // "section 45K(c)(3) of the Internal Revenue Code of 1986" to the provision
  // itself instead of dumping the reader at the head of title 26. Do NOT set this
  // on an Act unless the numbering really is 1:1 — for the SSA, PHSA and INA it
  // emphatically is not, and a wrong section is worse than no section.
  { name: 'Internal Revenue Code of 1986', pattern: 'Internal\\s+Revenue\\s+Code(?:\\s+of\\s+1986)?', title: '26', section: '1', range: 'title 26 generally', sectionsMatchCode: true, offsetNote: 'IRC section numbers map 1:1 onto 26 U.S.C. section numbers.' },
  { name: 'Endangered Species Act of 1973', pattern: 'Endangered\\s+Species\\s+Act(?:\\s+of\\s+1973)?', title: '16', section: '1531', range: '1531 et seq.' },
  { name: 'National Environmental Policy Act of 1969', pattern: 'National\\s+Environmental\\s+Policy\\s+Act(?:\\s+of\\s+1969)?', title: '42', section: '4321', range: '4321 et seq.' },
  { name: 'Fair Labor Standards Act of 1938', pattern: 'Fair\\s+Labor\\s+Standards\\s+Act(?:\\s+of\\s+1938)?', title: '29', section: '201', range: '201 et seq.' },
  { name: 'Employee Retirement Income Security Act of 1974', pattern: '(?:Employee\\s+Retirement\\s+Income\\s+Security\\s+Act(?:\\s+of\\s+1974)?|ERISA)', title: '29', section: '1001', range: '1001 et seq.' },
  { name: 'Americans with Disabilities Act of 1990', pattern: 'Americans\\s+with\\s+Disabilities\\s+Act(?:\\s+of\\s+1990)?', title: '42', section: '12101', range: '12101 et seq.' },
  { name: 'Civil Rights Act of 1964', pattern: 'Civil\\s+Rights\\s+Act\\s+of\\s+1964', title: '42', section: '2000a', range: '2000a et seq.' },
  { name: 'Administrative Procedure Act', pattern: 'Administrative\\s+Procedure\\s+Act', title: '5', section: '551', range: '551 et seq.' },
  { name: 'Freedom of Information Act', pattern: 'Freedom\\s+of\\s+Information\\s+Act', title: '5', section: '552' },
  { name: 'Securities Exchange Act of 1934', pattern: 'Securities\\s+Exchange\\s+Act\\s+of\\s+1934', title: '15', section: '78a', range: '78a et seq.' },
  { name: 'Securities Act of 1933', pattern: 'Securities\\s+Act\\s+of\\s+1933', title: '15', section: '77a', range: '77a et seq.' },
  { name: 'Communications Act of 1934', pattern: 'Communications\\s+Act\\s+of\\s+1934', title: '47', section: '151', range: '151 et seq.' },
  { name: 'Federal Food, Drug, and Cosmetic Act', pattern: 'Federal\\s+Food,?\\s+Drug,?\\s+and\\s+Cosmetic\\s+Act', title: '21', section: '301', range: '301 et seq.' },
  { name: 'Public Health Service Act', pattern: 'Public\\s+Health\\s+Service\\s+Act', title: '42', section: '201', range: '201 et seq.', enactedAs: 'July 1, 1944, ch. 373', offsetNote: 'PHSA section numbers differ from their 42 U.S.C. numbers (e.g. PHSA § 330 = 42 U.S.C. 254b).' },
  { name: 'Higher Education Act of 1965', pattern: 'Higher\\s+Education\\s+Act(?:\\s+of\\s+1965)?', title: '20', section: '1001', range: '1001 et seq.' },
  { name: 'Elementary and Secondary Education Act of 1965', pattern: 'Elementary\\s+and\\s+Secondary\\s+Education\\s+Act(?:\\s+of\\s+1965)?', title: '20', section: '6301', range: '6301 et seq.' },
  { name: 'Immigration and Nationality Act', pattern: 'Immigration\\s+and\\s+Nationality\\s+Act', title: '8', section: '1101', range: '1101 et seq.', enactedAs: 'June 27, 1952, ch. 477', offsetNote: 'INA section numbers differ from 8 U.S.C. numbers (e.g. INA § 212 = 8 U.S.C. 1182).' },
  { name: 'National Labor Relations Act', pattern: 'National\\s+Labor\\s+Relations\\s+Act', title: '29', section: '151', range: '151 et seq.' },
  { name: 'Energy Policy Act of 2005', pattern: 'Energy\\s+Policy\\s+Act\\s+of\\s+2005', title: '42', section: '15801' },
  { name: 'Federal Advisory Committee Act', pattern: 'Federal\\s+Advisory\\s+Committee\\s+Act', title: '5', section: '1001', range: 'ch. 10' },
  { name: 'Paperwork Reduction Act', pattern: 'Paperwork\\s+Reduction\\s+Act', title: '44', section: '3501', range: '3501 et seq.' },
  { name: 'Congressional Budget Act of 1974', pattern: 'Congressional\\s+Budget\\s+Act\\s+of\\s+1974', title: '2', section: '621', range: '621 et seq.' },
  { name: 'Small Business Act', pattern: 'Small\\s+Business\\s+Act', title: '15', section: '631', range: '631 et seq.' },
  { name: 'Truth in Lending Act', pattern: 'Truth\\s+in\\s+Lending\\s+Act', title: '15', section: '1601', range: '1601 et seq.' },
  { name: 'Bank Secrecy Act', pattern: 'Bank\\s+Secrecy\\s+Act', title: '31', section: '5311', range: '5311 et seq.' },
  { name: 'Controlled Substances Act', pattern: 'Controlled\\s+Substances\\s+Act', title: '21', section: '801', range: '801 et seq.' },
  { name: 'Farm Security and Rural Investment Act of 2002', pattern: 'Farm\\s+Security\\s+and\\s+Rural\\s+Investment\\s+Act\\s+of\\s+2002', title: '7', section: '7901' },
  { name: 'Food and Nutrition Act of 2008', pattern: 'Food\\s+and\\s+Nutrition\\s+Act\\s+of\\s+2008', title: '7', section: '2011', range: '2011 et seq.' },
  { name: 'Defense Production Act of 1950', pattern: 'Defense\\s+Production\\s+Act(?:\\s+of\\s+1950)?', title: '50', section: '4501', range: '4501 et seq.' },
  { name: 'Federal Election Campaign Act of 1971', pattern: 'Federal\\s+Election\\s+Campaign\\s+Act(?:\\s+of\\s+1971)?', title: '52', section: '30101', range: '30101 et seq.' },
  { name: 'Voting Rights Act of 1965', pattern: 'Voting\\s+Rights\\s+Act(?:\\s+of\\s+1965)?', title: '52', section: '10301', range: '10301 et seq.' },
  { name: 'Older Americans Act of 1965', pattern: 'Older\\s+Americans\\s+Act(?:\\s+of\\s+1965)?', title: '42', section: '3001', range: '3001 et seq.' },
  { name: 'Rehabilitation Act of 1973', pattern: 'Rehabilitation\\s+Act\\s+of\\s+1973', title: '29', section: '701', range: '701 et seq.' },
  { name: 'Individuals with Disabilities Education Act', pattern: 'Individuals\\s+with\\s+Disabilities\\s+Education\\s+Act', title: '20', section: '1400', range: '1400 et seq.' },
  { name: 'Resource Conservation and Recovery Act', pattern: 'Resource\\s+Conservation\\s+and\\s+Recovery\\s+Act', title: '42', section: '6901', range: '6901 et seq.' },
  { name: 'Comprehensive Environmental Response, Compensation, and Liability Act of 1980', pattern: '(?:Comprehensive\\s+Environmental\\s+Response,?\\s+Compensation,?\\s+and\\s+Liability\\s+Act(?:\\s+of\\s+1980)?|CERCLA)', title: '42', section: '9601', range: '9601 et seq.' },
  { name: 'Safe Drinking Water Act', pattern: 'Safe\\s+Drinking\\s+Water\\s+Act', title: '42', section: '300f', range: '300f et seq.' },
  { name: 'Toxic Substances Control Act', pattern: 'Toxic\\s+Substances\\s+Control\\s+Act', title: '15', section: '2601', range: '2601 et seq.' },
  { name: 'National Defense Authorization Act', pattern: 'National\\s+Defense\\s+Authorization\\s+Act(?:\\s+for\\s+Fiscal\\s+Year\\s+\\d{4})?', title: '10', section: '101', range: 'varies' },
  { name: 'Balanced Budget and Emergency Deficit Control Act of 1985', pattern: 'Balanced\\s+Budget\\s+and\\s+Emergency\\s+Deficit\\s+Control\\s+Act\\s+of\\s+1985', title: '2', section: '900', range: '900 et seq.' },
  { name: 'Inflation Reduction Act of 2022', pattern: 'Inflation\\s+Reduction\\s+Act\\s+of\\s+2022', title: '26', section: '1', range: 'Pub. L. 117-169' },
  { name: 'Infrastructure Investment and Jobs Act', pattern: 'Infrastructure\\s+Investment\\s+and\\s+Jobs\\s+Act', title: '23', section: '101', range: 'Pub. L. 117-58' },
  { name: 'CARES Act', pattern: 'CARES\\s+Act', title: '15', section: '9001', range: 'Pub. L. 116-136' },
  {
    name: 'National Artificial Intelligence Initiative Act of 2020',
    pattern: '(?:National\\s+Artificial\\s+Intelligence\\s+Initiative\\s+Act(?:\\s+of\\s+2020)?|National\\s+AI\\s+Initiative\\s+Act(?:\\s+of\\s+2020)?)',
    title: '15',
    section: '9401',
    range: '9401 et seq.',
    offsetNote:
      'National AI Initiative Act section numbers do NOT match their 15 U.S.C. numbers ' +
      '(e.g. § 5002 = 15 U.S.C. 9401). Use the parenthetical U.S.C. cite in the bill.',
  },
  { name: 'Dodd-Frank Wall Street Reform and Consumer Protection Act', pattern: '(?:Dodd[–—-]Frank\\s+Wall\\s+Street\\s+Reform\\s+and\\s+Consumer\\s+Protection\\s+Act|Dodd[–—-]Frank\\s+Act)', title: '12', section: '5301', range: '5301 et seq.' },
  { name: 'Patient Protection and Affordable Care Act', pattern: '(?:Patient\\s+Protection\\s+and\\s+Affordable\\s+Care\\s+Act|Affordable\\s+Care\\s+Act)', title: '42', section: '18001', range: '18001 et seq.' },
  {
    // The Act every digital-commodity bill is built on, and the single most-cited
    // Act across all three CLARITY Act texts — without it those amendments
    // resolved to nothing at all.
    name: 'Commodity Exchange Act',
    pattern: 'Commodity\\s+Exchange\\s+Act',
    title: '7',
    section: '1',
    range: '1 et seq.',
    enactedAs: 'Sept. 21, 1922, ch. 369',
    offsetNote:
      'Commodity Exchange Act section numbers do NOT match their 7 U.S.C. numbers ' +
      '(e.g. CEA § 4 = 7 U.S.C. 6, CEA § 5 = 7 U.S.C. 7). Use the parenthetical U.S.C. cite in the bill.',
  },
];

/** Look up an Act by a name the bill used. Returns the table entry or null. */
export function findAct(name) {
  if (!name) return null;
  const norm = name.trim().replace(/\s+/g, ' ');
  return (
    POPULAR_NAMES.find((e) => new RegExp(`^${e.pattern}$`, 'i').test(norm)) ||
    POPULAR_NAMES.find((e) => new RegExp(e.pattern, 'i').test(norm)) ||
    null
  );
}
