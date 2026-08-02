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
  { name: 'Clean Air Act', pattern: 'Clean\\s+Air\\s+Act', title: '42', section: '7401', enactedAs: 'July 14, 1955, ch. 360', range: '7401 et seq.' },
  { name: 'Clean Water Act', pattern: '(?:Clean\\s+Water\\s+Act|Federal\\s+Water\\s+Pollution\\s+Control\\s+Act)', title: '33', section: '1251', enactedAs: 'June 30, 1948, ch. 758', range: '1251 et seq.' },
  // The one Act in this table whose own section numbers ARE the Code's: IRC § 45K
  // is 26 U.S.C. 45K. `sectionsMatchCode` lets the citation extractor resolve
  // "section 45K(c)(3) of the Internal Revenue Code of 1986" to the provision
  // itself instead of dumping the reader at the head of title 26. Do NOT set this
  // on an Act unless the numbering really is 1:1 — for the SSA, PHSA and INA it
  // emphatically is not, and a wrong section is worse than no section.
  { name: 'Internal Revenue Code of 1986', pattern: 'Internal\\s+Revenue\\s+Code(?:\\s+of\\s+1986)?', title: '26', section: '1', range: 'title 26 generally', sectionsMatchCode: true, offsetNote: 'IRC section numbers map 1:1 onto 26 U.S.C. section numbers.' },
  { name: 'Endangered Species Act of 1973', pattern: 'Endangered\\s+Species\\s+Act(?:\\s+of\\s+1973)?', title: '16', section: '1531', enactedAs: 'Pub. L. 93–205', range: '1531 et seq.' },
  { name: 'National Environmental Policy Act of 1969', pattern: 'National\\s+Environmental\\s+Policy\\s+Act(?:\\s+of\\s+1969)?', title: '42', section: '4321', enactedAs: 'Pub. L. 91–190', range: '4321 et seq.' },
  { name: 'Fair Labor Standards Act of 1938', pattern: 'Fair\\s+Labor\\s+Standards\\s+Act(?:\\s+of\\s+1938)?', title: '29', section: '201', enactedAs: 'June 25, 1938, ch. 676', range: '201 et seq.' },
  { name: 'Employee Retirement Income Security Act of 1974', pattern: '(?:Employee\\s+Retirement\\s+Income\\s+Security\\s+Act(?:\\s+of\\s+1974)?|ERISA)', title: '29', section: '1001', enactedAs: 'Pub. L. 93–406', range: '1001 et seq.' },
  { name: 'Americans with Disabilities Act of 1990', pattern: 'Americans\\s+with\\s+Disabilities\\s+Act(?:\\s+of\\s+1990)?', title: '42', section: '12101', enactedAs: 'Pub. L. 101–336', range: '12101 et seq.' },
  { name: 'Civil Rights Act of 1964', pattern: 'Civil\\s+Rights\\s+Act\\s+of\\s+1964', title: '42', section: '2000a', enactedAs: 'Pub. L. 88–352', range: '2000a et seq.' },
  { name: 'Administrative Procedure Act', pattern: 'Administrative\\s+Procedure\\s+Act', title: '5', section: '551', range: '551 et seq.' },
  { name: 'Freedom of Information Act', pattern: 'Freedom\\s+of\\s+Information\\s+Act', title: '5', section: '552' },
  { name: 'Securities Exchange Act of 1934', pattern: 'Securities\\s+Exchange\\s+Act\\s+of\\s+1934', title: '15', section: '78a', enactedAs: 'June 6, 1934, ch. 404', range: '78a et seq.' },
  { name: 'Securities Act of 1933', pattern: 'Securities\\s+Act\\s+of\\s+1933', title: '15', section: '77a', enactedAs: 'May 27, 1933, ch. 38', range: '77a et seq.' },
  { name: 'Communications Act of 1934', pattern: 'Communications\\s+Act\\s+of\\s+1934', title: '47', section: '151', enactedAs: 'June 19, 1934, ch. 652', range: '151 et seq.' },
  { name: 'Federal Food, Drug, and Cosmetic Act', pattern: 'Federal\\s+Food,?\\s+Drug,?\\s+and\\s+Cosmetic\\s+Act', title: '21', section: '301', enactedAs: 'June 25, 1938, ch. 675', range: '301 et seq.' },
  { name: 'Public Health Service Act', pattern: 'Public\\s+Health\\s+Service\\s+Act', title: '42', section: '201', range: '201 et seq.', enactedAs: 'July 1, 1944, ch. 373', offsetNote: 'PHSA section numbers differ from their 42 U.S.C. numbers (e.g. PHSA § 330 = 42 U.S.C. 254b).' },
  { name: 'Higher Education Act of 1965', pattern: 'Higher\\s+Education\\s+Act(?:\\s+of\\s+1965)?', title: '20', section: '1001', enactedAs: 'Pub. L. 89–329', range: '1001 et seq.' },
  { name: 'Elementary and Secondary Education Act of 1965', pattern: 'Elementary\\s+and\\s+Secondary\\s+Education\\s+Act(?:\\s+of\\s+1965)?', title: '20', section: '6301', enactedAs: 'Pub. L. 89–10', range: '6301 et seq.' },
  { name: 'Immigration and Nationality Act', pattern: 'Immigration\\s+and\\s+Nationality\\s+Act', title: '8', section: '1101', range: '1101 et seq.', enactedAs: 'June 27, 1952, ch. 477', offsetNote: 'INA section numbers differ from 8 U.S.C. numbers (e.g. INA § 212 = 8 U.S.C. 1182).' },
  { name: 'National Labor Relations Act', pattern: 'National\\s+Labor\\s+Relations\\s+Act', title: '29', section: '151', enactedAs: 'July 5, 1935, ch. 372', range: '151 et seq.' },
  { name: 'Energy Policy Act of 2005', pattern: 'Energy\\s+Policy\\s+Act\\s+of\\s+2005', title: '42', section: '15801', enactedAs: 'Pub. L. 109–58' },
  { name: 'Federal Advisory Committee Act', pattern: 'Federal\\s+Advisory\\s+Committee\\s+Act', title: '5', section: '1001', range: 'ch. 10' },
  { name: 'Paperwork Reduction Act', pattern: 'Paperwork\\s+Reduction\\s+Act', title: '44', section: '3501', range: '3501 et seq.' },
  { name: 'Congressional Budget Act of 1974', pattern: 'Congressional\\s+Budget\\s+Act\\s+of\\s+1974', title: '2', section: '621', enactedAs: 'Pub. L. 93–344', range: '621 et seq.' },
  { name: 'Small Business Act', pattern: 'Small\\s+Business\\s+Act', title: '15', section: '631', range: '631 et seq.' },
  { name: 'Truth in Lending Act', pattern: 'Truth\\s+in\\s+Lending\\s+Act', title: '15', section: '1601', enactedAs: 'Pub. L. 90–321', range: '1601 et seq.' },
  { name: 'Bank Secrecy Act', pattern: 'Bank\\s+Secrecy\\s+Act', title: '31', section: '5311', range: '5311 et seq.' },
  { name: 'Controlled Substances Act', pattern: 'Controlled\\s+Substances\\s+Act', title: '21', section: '801', enactedAs: 'Pub. L. 91–513', range: '801 et seq.' },
  { name: 'Farm Security and Rural Investment Act of 2002', pattern: 'Farm\\s+Security\\s+and\\s+Rural\\s+Investment\\s+Act\\s+of\\s+2002', title: '7', section: '7901', enactedAs: 'Pub. L. 107–171' },
  { name: 'Food and Nutrition Act of 2008', pattern: 'Food\\s+and\\s+Nutrition\\s+Act\\s+of\\s+2008', title: '7', section: '2011', enactedAs: 'Pub. L. 88–525', range: '2011 et seq.' },
  { name: 'Defense Production Act of 1950', pattern: 'Defense\\s+Production\\s+Act(?:\\s+of\\s+1950)?', title: '50', section: '4501', enactedAs: 'Sept. 8, 1950, ch. 932', range: '4501 et seq.' },
  { name: 'Federal Election Campaign Act of 1971', pattern: 'Federal\\s+Election\\s+Campaign\\s+Act(?:\\s+of\\s+1971)?', title: '52', section: '30101', enactedAs: 'Pub. L. 92–225', range: '30101 et seq.' },
  { name: 'Voting Rights Act of 1965', pattern: 'Voting\\s+Rights\\s+Act(?:\\s+of\\s+1965)?', title: '52', section: '10301', enactedAs: 'Pub. L. 89–110', range: '10301 et seq.' },
  { name: 'Older Americans Act of 1965', pattern: 'Older\\s+Americans\\s+Act(?:\\s+of\\s+1965)?', title: '42', section: '3001', enactedAs: 'Pub. L. 89–73', range: '3001 et seq.' },
  { name: 'Rehabilitation Act of 1973', pattern: 'Rehabilitation\\s+Act\\s+of\\s+1973', title: '29', section: '701', enactedAs: 'Pub. L. 93–112', range: '701 et seq.' },
  { name: 'Individuals with Disabilities Education Act', pattern: 'Individuals\\s+with\\s+Disabilities\\s+Education\\s+Act', title: '20', section: '1400', enactedAs: 'Pub. L. 91–230', range: '1400 et seq.' },
  { name: 'Resource Conservation and Recovery Act', pattern: 'Resource\\s+Conservation\\s+and\\s+Recovery\\s+Act', title: '42', section: '6901', enactedAs: 'Pub. L. 89–272', range: '6901 et seq.' },
  { name: 'Comprehensive Environmental Response, Compensation, and Liability Act of 1980', pattern: '(?:Comprehensive\\s+Environmental\\s+Response,?\\s+Compensation,?\\s+and\\s+Liability\\s+Act(?:\\s+of\\s+1980)?|CERCLA)', title: '42', section: '9601', enactedAs: 'Pub. L. 96–510', range: '9601 et seq.' },
  { name: 'Safe Drinking Water Act', pattern: 'Safe\\s+Drinking\\s+Water\\s+Act', title: '42', section: '300f', enactedAs: 'July 1, 1944, ch. 373', range: '300f et seq.' },
  { name: 'Toxic Substances Control Act', pattern: 'Toxic\\s+Substances\\s+Control\\s+Act', title: '15', section: '2601', enactedAs: 'Pub. L. 94–469', range: '2601 et seq.' },
  { name: 'National Defense Authorization Act', pattern: 'National\\s+Defense\\s+Authorization\\s+Act(?:\\s+for\\s+Fiscal\\s+Year\\s+\\d{4})?', title: '10', section: '101', range: 'varies' },
  { name: 'Balanced Budget and Emergency Deficit Control Act of 1985', pattern: 'Balanced\\s+Budget\\s+and\\s+Emergency\\s+Deficit\\s+Control\\s+Act\\s+of\\s+1985', title: '2', section: '900', enactedAs: 'Pub. L. 99–177', range: '900 et seq.' },
  { name: 'Inflation Reduction Act of 2022', pattern: 'Inflation\\s+Reduction\\s+Act\\s+of\\s+2022', title: '26', section: '1', range: 'Pub. L. 117-169' },
  { name: 'Infrastructure Investment and Jobs Act', pattern: 'Infrastructure\\s+Investment\\s+and\\s+Jobs\\s+Act', title: '23', section: '101', range: 'Pub. L. 117-58' },
  { name: 'CARES Act', pattern: 'CARES\\s+Act', title: '15', section: '9001', enactedAs: 'Pub. L. 116–136', range: 'Pub. L. 116-136' },
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
  { name: 'Patient Protection and Affordable Care Act', pattern: '(?:Patient\\s+Protection\\s+and\\s+Affordable\\s+Care\\s+Act|Affordable\\s+Care\\s+Act)', title: '42', section: '18001', enactedAs: 'Pub. L. 111–148', range: '18001 et seq.' },
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

  // ---- derived from the corpus, 2026-08-02 --------------------------------
  // Not typed from memory. Congress states an Act's codified range itself, in
  // the parenthetical it writes beside the name — "the Foreign Assistance Act
  // of 1961 (22 U.S.C. 2151 et seq.)" — so these were extracted from the 27
  // corpus bills and kept only where at least 5 citations agreed and at least
  // 90% of them named the same section. Each was then checked against the
  // ingested Code: the shard exists, and its heading reads like the head of an
  // Act ("Short title", "Congressional findings", "Purposes", "Definitions").
  //
  // `enactedAs` is deliberately absent. That field turns on Act-relative
  // section lookup, and it has to be the Act as the Code's own credits spell
  // it — verified against a real shard, one at a time. Guessing it would point
  // citations at real but unrelated provisions, which is the one outcome worse
  // than not resolving. These entries do what the rest of the table does:
  // land the reader at the start of the Act.
  { name: "Alaska Native Claims Settlement Act", pattern: 'Alaska\\s+Native\\s+Claims\\s+Settlement\\s+Act', title: '43', section: '1601', enactedAs: 'Pub. L. 92–203', range: '1601 et seq.' },
  { name: "Bank Holding Company Act of 1956", pattern: 'Bank\\s+Holding\\s+Company\\s+Act(?:\\s+of\\s+1956)?', title: '12', section: '1841', enactedAs: 'May 9, 1956, ch. 240', range: '1841 et seq.' },
  { name: "Carl D. Perkins Career and Technical Education Act of 2006", pattern: 'Carl\\s+D\\.\\s+Perkins\\s+Career\\s+and\\s+Technical\\s+Education\\s+Act(?:\\s+of\\s+2006)?', title: '20', section: '2301', enactedAs: 'Pub. L. 88–210', range: '2301 et seq.' },
  { name: "Child Nutrition Act of 1966", pattern: 'Child\\s+Nutrition\\s+Act(?:\\s+of\\s+1966)?', title: '42', section: '1771', enactedAs: 'Pub. L. 89–642', range: '1771 et seq.' },
  { name: "Department of Energy Organization Act", pattern: 'Department\\s+of\\s+Energy\\s+Organization\\s+Act', title: '42', section: '7101', enactedAs: 'Pub. L. 95–91', range: '7101 et seq.' },
  { name: "Export Control Reform Act of 2018", pattern: 'Export\\s+Control\\s+Reform\\s+Act(?:\\s+of\\s+2018)?', title: '50', section: '4801', enactedAs: 'Pub. L. 115–232', range: '4801 et seq.' },
  { name: "Federal Credit Reform Act of 1990", pattern: 'Federal\\s+Credit\\s+Reform\\s+Act(?:\\s+of\\s+1990)?', title: '2', section: '661', enactedAs: 'Pub. L. 93–344', range: '661 et seq.' },
  { name: "Federal Crop Insurance Act", pattern: 'Federal\\s+Crop\\s+Insurance\\s+Act', title: '7', section: '1501', enactedAs: 'Feb. 16, 1938, ch. 30', range: '1501 et seq.' },
  { name: "Federal Land Policy and Management Act of 1976", pattern: 'Federal\\s+Land\\s+Policy\\s+and\\s+Management\\s+Act(?:\\s+of\\s+1976)?', title: '43', section: '1701', enactedAs: 'Pub. L. 94–579', range: '1701 et seq.' },
  { name: "Federal Trade Commission Act", pattern: 'Federal\\s+Trade\\s+Commission\\s+Act', title: '15', section: '41', enactedAs: 'Sept. 26, 1914, ch. 311', range: '41 et seq.' },
  { name: "Foreign Narcotics Kingpin Designation Act", pattern: 'Foreign\\s+Narcotics\\s+Kingpin\\s+Designation\\s+Act', title: '21', section: '1901', enactedAs: 'Pub. L. 106–120', range: '1901 et seq.' },
  { name: "Housing and Community Development Act of 1974", pattern: 'Housing\\s+and\\s+Community\\s+Development\\s+Act(?:\\s+of\\s+1974)?', title: '42', section: '5301', enactedAs: 'Pub. L. 93–383', range: '5301 et seq.' },
  { name: "Indian Self-Determination Act of 1975", pattern: 'Indian\\s+Self-Determination\\s+Act(?:\\s+of\\s+1975)?', title: '25', section: '5301', enactedAs: 'Pub. L. 93–638', range: '5301 et seq.' },
  { name: "International Emergency Economic Powers Act", pattern: 'International\\s+Emergency\\s+Economic\\s+Powers\\s+Act', title: '50', section: '1701', enactedAs: 'Pub. L. 95–223', range: '1701 et seq.' },
  { name: "Investment Advisers Act of 1940", pattern: 'Investment\\s+Advisers\\s+Act(?:\\s+of\\s+1940)?', title: '15', section: '80b-1', range: '80b-1 et seq.' },
  { name: "Low-Income Home Energy Assistance Act of 1981", pattern: 'Low-Income\\s+Home\\s+Energy\\s+Assistance\\s+Act(?:\\s+of\\s+1981)?', title: '42', section: '8621', range: '8621 et seq.' },
  { name: "Marine Mammal Protection Act of 1972", pattern: 'Marine\\s+Mammal\\s+Protection\\s+Act(?:\\s+of\\s+1972)?', title: '16', section: '1361', enactedAs: 'Pub. L. 92–522', range: '1361 et seq.' },
  { name: "Mineral Leasing Act", pattern: 'Mineral\\s+Leasing\\s+Act', title: '30', section: '181', enactedAs: 'Feb. 25, 1920, ch. 85', range: '181 et seq.' },
  { name: "National Emergencies Act", pattern: 'National\\s+Emergencies\\s+Act', title: '50', section: '1601', enactedAs: 'Pub. L. 94–412', range: '1601 et seq.' },
  { name: "National Science Foundation Act of 1950", pattern: 'National\\s+Science\\s+Foundation\\s+Act(?:\\s+of\\s+1950)?', title: '42', section: '1861', enactedAs: 'May 10, 1950, ch. 171', range: '1861 et seq.' },
  { name: "Outer Continental Shelf Lands Act", pattern: 'Outer\\s+Continental\\s+Shelf\\s+Lands\\s+Act', title: '43', section: '1331', enactedAs: 'Aug. 7, 1953, ch. 345', range: '1331 et seq.' },
  { name: "Public Lands Corps Act of 1993", pattern: 'Public\\s+Lands\\s+Corps\\s+Act(?:\\s+of\\s+1993)?', title: '16', section: '1721', enactedAs: 'Pub. L. 91–378', range: '1721 et seq.' },
  { name: "Railway Labor Act", pattern: 'Railway\\s+Labor\\s+Act', title: '45', section: '151', enactedAs: 'May 20, 1926, ch. 347', range: '151 et seq.' },
  { name: "Richard B. Russell National School Lunch Act", pattern: 'Richard\\s+B\\.\\s+Russell\\s+National\\s+School\\s+Lunch\\s+Act', title: '42', section: '1751', enactedAs: 'June 4, 1946, ch. 281', range: '1751 et seq.' },
  { name: "Robert T. Stafford Disaster Relief and Emergency Assistance Act", pattern: 'Robert\\s+T\\.\\s+Stafford\\s+Disaster\\s+Relief\\s+and\\s+Emergency\\s+Assistance\\s+Act', title: '42', section: '5121', enactedAs: 'Pub. L. 93–288', range: '5121 et seq.' },
  { name: "Securities Investor Protection Act of 1970", pattern: 'Securities\\s+Investor\\s+Protection\\s+Act(?:\\s+of\\s+1970)?', title: '15', section: '78aaa', enactedAs: 'Pub. L. 91–598', range: '78aaa et seq.' },
  { name: "United States Housing Act of 1937", pattern: 'United\\s+States\\s+Housing\\s+Act(?:\\s+of\\s+1937)?', title: '42', section: '1437', enactedAs: 'Sept. 1, 1937, ch. 896', range: '1437 et seq.' },
  { name: "Wilderness Act", pattern: 'Wilderness\\s+Act', title: '16', section: '1131', enactedAs: 'Pub. L. 88–577', range: '1131 et seq.' },
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
