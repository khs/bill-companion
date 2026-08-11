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
  { name: 'Small Business Act', pattern: 'Small\\s+Business\\s+Act', title: '15', section: '631', enactedAs: 'Pub. L. 85–536', range: '631 et seq.' },
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
  { name: 'National Defense Authorization Act', pattern: 'National\\s+Defense\\s+Authorization\\s+Act(?:\\s+for\\s+Fiscal\\s+Year\\s+\\d{4})?', range: 'varies' },
  { name: 'Balanced Budget and Emergency Deficit Control Act of 1985', pattern: 'Balanced\\s+Budget\\s+and\\s+Emergency\\s+Deficit\\s+Control\\s+Act\\s+of\\s+1985', title: '2', section: '900', enactedAs: 'Pub. L. 99–177', range: '900 et seq.' },
  { name: 'Inflation Reduction Act of 2022', pattern: 'Inflation\\s+Reduction\\s+Act\\s+of\\s+2022', range: 'Pub. L. 117-169' },
  { name: 'Infrastructure Investment and Jobs Act', pattern: 'Infrastructure\\s+Investment\\s+and\\s+Jobs\\s+Act', range: 'Pub. L. 117-58' },
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

  // ---------------------------------------------------------------------------
  // Derived, never typed — 107 names harvested from the corpus on 2026-08-03.
  //
  // Congress writes the codified anchor beside the name it is introducing:
  //
  //     "the Federal Deposit Insurance Act (12 U.S.C. 1811 et seq.)"
  //
  // so `name`, `title` and `section` all come from the bills themselves, and
  // `enactedAs` is SEARCHED FOR in the ingested Act index rather than asserted:
  // the one act whose sections include this entry's own head section, keeping at
  // least 80% of its mappings inside this entry's title, rejecting anything with
  // more than one candidate. 92 of the 107 settled; the other 15 are kept
  // without one and resolve to the head of the Act, exactly as the earlier
  // undecided entries do. A miss costs nothing; a guess would cost a provision.
  //
  // Cross-checked against the bills' own parentheticals — where a bill writes
  // "section 603 of the Fair Credit Reporting Act (15 U.S.C. 1681a)" it has
  // stated the answer, and the derivation must agree. 693 of 711 such statements
  // agree. Every one of the 18 that do not was read against the Code's own
  // credit and the DERIVATION was right each time: the bill had cited the Act's
  // head, an "et seq." range, or a *former* section number ("§ 305, formerly
  // § 304"), or a title-42 crime provision transferred to title 34 in 2017.
  //
  // Two filters earn their place. A candidate must look like a short title —
  // every word capitalised, an acronym, or a small connective — which is what
  // rejects "State program funded under part A of title IV of the Social
  // Security Act", a phrase the et-seq. pattern otherwise harvests as a name.
  // And the anchor must be a shard that exists, so a mis-read parenthetical
  // cannot introduce an Act pointing at nothing.
  { name: 'McKinney-Vento Homeless Assistance Act', pattern: 'McKinney[\\s\\-]+Vento[\\s\\-]+Homeless[\\s\\-]+Assistance[\\s\\-]+Act', title: '42', section: '11381', range: '11381 et seq.', enactedAs: 'Pub. L. 100–77' },
  { name: 'National Agricultural Research, Extension, and Teaching Policy Act of 1977', pattern: 'National[\\s\\-]+Agricultural[\\s\\-]+Research,[\\s\\-]+Extension,[\\s\\-]+and[\\s\\-]+Teaching[\\s\\-]+Policy[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1977', title: '7', section: '3151', range: '3151 et seq.', enactedAs: 'Pub. L. 95–113' },
  { name: 'Federal Reserve Act', pattern: 'Federal[\\s\\-]+Reserve[\\s\\-]+Act', title: '12', section: '411', range: '411 et seq.' },
  { name: 'Federal Deposit Insurance Act', pattern: 'Federal[\\s\\-]+Deposit[\\s\\-]+Insurance[\\s\\-]+Act', title: '12', section: '1811', range: '1811 et seq.', enactedAs: 'Sept. 21, 1950, ch. 967' },
  { name: 'Department of Agriculture Reorganization Act of 1994', pattern: 'Department[\\s\\-]+of[\\s\\-]+Agriculture[\\s\\-]+Reorganization[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1994', title: '7', section: '6911', range: '6911 et seq.' },
  { name: 'Omnibus Crime Control and Safe Streets Act of 1968', pattern: 'Omnibus[\\s\\-]+Crime[\\s\\-]+Control[\\s\\-]+and[\\s\\-]+Safe[\\s\\-]+Streets[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1968', title: '34', section: '10101', range: '10101 et seq.', enactedAs: 'Pub. L. 90–351' },
  { name: 'National Housing Act', pattern: 'National[\\s\\-]+Housing[\\s\\-]+Act', title: '12', section: '1702', range: '1702 et seq.', enactedAs: 'June 27, 1934, ch. 847' },
  { name: 'Arms Export Control Act', pattern: 'Arms[\\s\\-]+Export[\\s\\-]+Control[\\s\\-]+Act', title: '22', section: '2751', range: '2751 et seq.', enactedAs: 'Pub. L. 90–629' },
  { name: 'National School Lunch Act', pattern: 'National[\\s\\-]+School[\\s\\-]+Lunch[\\s\\-]+Act', title: '42', section: '1751', range: '1751 et seq.', enactedAs: 'June 4, 1946, ch. 281' },
  { name: 'Head Start Act', pattern: 'Head[\\s\\-]+Start[\\s\\-]+Act', title: '42', section: '9831', range: '9831 et seq.' },
  { name: 'Surface Mining Control and Reclamation Act of 1977', pattern: 'Surface[\\s\\-]+Mining[\\s\\-]+Control[\\s\\-]+and[\\s\\-]+Reclamation[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1977', title: '30', section: '1201', range: '1201 et seq.', enactedAs: 'Pub. L. 95–87' },
  { name: 'Cranston-Gonzalez National Affordable Housing Act', pattern: 'Cranston[\\s\\-]+Gonzalez[\\s\\-]+National[\\s\\-]+Affordable[\\s\\-]+Housing[\\s\\-]+Act', title: '42', section: '12721', range: '12721 et seq.', enactedAs: 'Pub. L. 101–625' },
  { name: 'Indian Health Care Improvement Act', pattern: 'Indian[\\s\\-]+Health[\\s\\-]+Care[\\s\\-]+Improvement[\\s\\-]+Act', title: '25', section: '1601', range: '1601 et seq.', enactedAs: 'Pub. L. 94–437' },
  { name: 'Railroad Revitalization and Regulatory Reform Act of 1976', pattern: 'Railroad[\\s\\-]+Revitalization[\\s\\-]+and[\\s\\-]+Regulatory[\\s\\-]+Reform[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1976', title: '45', section: '801', range: '801 et seq.', enactedAs: 'Pub. L. 94–210' },
  { name: 'Family and Medical Leave Act of 1993', pattern: 'Family[\\s\\-]+and[\\s\\-]+Medical[\\s\\-]+Leave[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1993', title: '29', section: '2611', range: '2611 et seq.', enactedAs: 'Pub. L. 103–3' },
  { name: 'National Institute of Standards and Technology Act', pattern: 'National[\\s\\-]+Institute[\\s\\-]+of[\\s\\-]+Standards[\\s\\-]+and[\\s\\-]+Technology[\\s\\-]+Act', title: '15', section: '271', range: '271 et seq.', enactedAs: 'Mar. 3, 1901, ch. 872' },
  { name: 'National and Community Service Act of 1990', pattern: 'National[\\s\\-]+and[\\s\\-]+Community[\\s\\-]+Service[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1990', title: '42', section: '12601', range: '12601 et seq.', enactedAs: 'Pub. L. 101–610' },
  { name: 'Child Care and Development Block Grant Act of 1990', pattern: 'Child[\\s\\-]+Care[\\s\\-]+and[\\s\\-]+Development[\\s\\-]+Block[\\s\\-]+Grant[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1990', title: '42', section: '9858', range: '9858 et seq.' },
  { name: 'Energy Independence and Security Act of 2007', pattern: 'Energy[\\s\\-]+Independence[\\s\\-]+and[\\s\\-]+Security[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2007', title: '42', section: '17111', range: '17111 et seq.', enactedAs: 'Pub. L. 110–140' },
  { name: 'Federal Credit Union Act', pattern: 'Federal[\\s\\-]+Credit[\\s\\-]+Union[\\s\\-]+Act', title: '12', section: '1751', range: '1751 et seq.', enactedAs: 'June 26, 1934, ch. 750' },
  { name: 'Financial Institutions Reform, Recovery, and Enforcement Act of 1989', pattern: 'Financial[\\s\\-]+Institutions[\\s\\-]+Reform,[\\s\\-]+Recovery,[\\s\\-]+and[\\s\\-]+Enforcement[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1989', title: '12', section: '3331', range: '3331 et seq.', enactedAs: 'Pub. L. 101–73' },
  { name: 'Food, Conservation, and Energy Act of 2008', pattern: 'Food,[\\s\\-]+Conservation,[\\s\\-]+and[\\s\\-]+Energy[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2008', title: '7', section: '8702', range: '8702 et seq.' },
  { name: 'Solid Waste Disposal Act', pattern: 'Solid[\\s\\-]+Waste[\\s\\-]+Disposal[\\s\\-]+Act', title: '42', section: '6901', range: '6901 et seq.', enactedAs: 'Pub. L. 89–272' },
  { name: 'Federal Power Act', pattern: 'Federal[\\s\\-]+Power[\\s\\-]+Act', title: '16', section: '791a', range: '791a et seq.', enactedAs: 'June 10, 1920, ch. 285' },
  { name: 'Gramm-Leach-Bliley Act', pattern: 'Gramm[\\s\\-]+Leach[\\s\\-]+Bliley[\\s\\-]+Act', title: '15', section: '6801', range: '6801 et seq.', enactedAs: 'Pub. L. 106–102' },
  { name: 'Federal Insecticide, Fungicide, and Rodenticide Act', pattern: 'Federal[\\s\\-]+Insecticide,[\\s\\-]+Fungicide,[\\s\\-]+and[\\s\\-]+Rodenticide[\\s\\-]+Act', title: '7', section: '136', range: '136 et seq.', enactedAs: 'June 25, 1947, ch. 125' },
  { name: 'Home Owners\' Loan Act', pattern: 'Home[\\s\\-]+Owners\'[\\s\\-]+Loan[\\s\\-]+Act', title: '12', section: '1461', range: '1461 et seq.' },
  { name: 'General Education Provisions Act', pattern: 'General[\\s\\-]+Education[\\s\\-]+Provisions[\\s\\-]+Act', title: '20', section: '1221', range: '1221 et seq.', enactedAs: 'Pub. L. 90–247' },
  { name: 'Native American Housing Assistance and Self-Determination Act of 1996', pattern: 'Native[\\s\\-]+American[\\s\\-]+Housing[\\s\\-]+Assistance[\\s\\-]+and[\\s\\-]+Self[\\s\\-]+Determination[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1996', title: '25', section: '4111', range: '4111 et seq.', enactedAs: 'Pub. L. 104–330' },
  { name: 'Railroad Unemployment Insurance Act', pattern: 'Railroad[\\s\\-]+Unemployment[\\s\\-]+Insurance[\\s\\-]+Act', title: '45', section: '351', range: '351 et seq.', enactedAs: 'June 25, 1938, ch. 680' },
  { name: 'Fair Credit Reporting Act', pattern: 'Fair[\\s\\-]+Credit[\\s\\-]+Reporting[\\s\\-]+Act', title: '15', section: '1681', range: '1681 et seq.', enactedAs: 'Pub. L. 90–321' },
  { name: 'Indian Self-Determination and Education Assistance Act of 1975', pattern: 'Indian[\\s\\-]+Self[\\s\\-]+Determination[\\s\\-]+and[\\s\\-]+Education[\\s\\-]+Assistance[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1975', title: '25', section: '5301', range: '5301 et seq.', enactedAs: 'Pub. L. 93–638' },
  { name: 'FREEDOM Support Act', pattern: 'FREEDOM[\\s\\-]+Support[\\s\\-]+Act', title: '22', section: '5851', range: '5851 et seq.', enactedAs: 'Pub. L. 102–511' },
  { name: 'Forest and Rangeland Renewable Resources Planning Act of 1974', pattern: 'Forest[\\s\\-]+and[\\s\\-]+Rangeland[\\s\\-]+Renewable[\\s\\-]+Resources[\\s\\-]+Planning[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1974', title: '16', section: '1600', range: '1600 et seq.', enactedAs: 'Pub. L. 93–378' },
  { name: 'Secure Rural Schools and Community Self-Determination Act of 2000', pattern: 'Secure[\\s\\-]+Rural[\\s\\-]+Schools[\\s\\-]+and[\\s\\-]+Community[\\s\\-]+Self[\\s\\-]+Determination[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2000', title: '16', section: '7141', range: '7141 et seq.', enactedAs: 'Pub. L. 106–393' },
  { name: 'Electronic Fund Transfer Act', pattern: 'Electronic[\\s\\-]+Fund[\\s\\-]+Transfer[\\s\\-]+Act', title: '15', section: '1693', range: '1693 et seq.', enactedAs: 'Pub. L. 90–321' },
  { name: 'Secure and Fair Enforcement for Mortgage Licensing Act of 2008', pattern: 'Secure[\\s\\-]+and[\\s\\-]+Fair[\\s\\-]+Enforcement[\\s\\-]+for[\\s\\-]+Mortgage[\\s\\-]+Licensing[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2008', title: '12', section: '5102', range: '5102 et seq.', enactedAs: 'Pub. L. 110–289' },
  { name: 'Consumer Product Safety Act', pattern: 'Consumer[\\s\\-]+Product[\\s\\-]+Safety[\\s\\-]+Act', title: '15', section: '2051', range: '2051 et seq.', enactedAs: 'Pub. L. 92–573' },
  { name: 'Reclamation Wastewater and Groundwater Study and Facilities Act', pattern: 'Reclamation[\\s\\-]+Wastewater[\\s\\-]+and[\\s\\-]+Groundwater[\\s\\-]+Study[\\s\\-]+and[\\s\\-]+Facilities[\\s\\-]+Act', title: '43', section: '390h', range: '390h et seq.', enactedAs: 'Pub. L. 102–575' },
  { name: 'Animal Health Protection Act', pattern: 'Animal[\\s\\-]+Health[\\s\\-]+Protection[\\s\\-]+Act', title: '7', section: '8301', range: '8301 et seq.', enactedAs: 'Pub. L. 107–171' },
  { name: 'Right to Financial Privacy Act of 1978', pattern: 'Right[\\s\\-]+to[\\s\\-]+Financial[\\s\\-]+Privacy[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1978', title: '12', section: '3401', range: '3401 et seq.', enactedAs: 'Pub. L. 95–630' },
  { name: 'National Quantum Initiative Act', pattern: 'National[\\s\\-]+Quantum[\\s\\-]+Initiative[\\s\\-]+Act', title: '15', section: '8851', range: '8851 et seq.', enactedAs: 'Pub. L. 115–368' },
  { name: 'Taiwan Relations Act', pattern: 'Taiwan[\\s\\-]+Relations[\\s\\-]+Act', title: '22', section: '3301', range: '3301 et seq.', enactedAs: 'Pub. L. 96–8' },
  { name: 'National Science and Technology Policy, Organization, and Priorities Act of 1976', pattern: 'National[\\s\\-]+Science[\\s\\-]+and[\\s\\-]+Technology[\\s\\-]+Policy,[\\s\\-]+Organization,[\\s\\-]+and[\\s\\-]+Priorities[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1976', title: '42', section: '6601', range: '6601 et seq.', enactedAs: 'Pub. L. 94–282' },
  { name: 'Peace Corps Act', pattern: 'Peace[\\s\\-]+Corps[\\s\\-]+Act', title: '22', section: '2501', range: '2501 et seq.', enactedAs: 'Pub. L. 87–293' },
  { name: 'Federal Meat Inspection Act', pattern: 'Federal[\\s\\-]+Meat[\\s\\-]+Inspection[\\s\\-]+Act', title: '21', section: '601', range: '601 et seq.', enactedAs: 'Mar. 4, 1907, ch. 2907' },
  { name: 'Smith-Lever Act', pattern: 'Smith[\\s\\-]+Lever[\\s\\-]+Act', title: '7', section: '341', range: '341 et seq.', enactedAs: 'May 8, 1914, ch. 79' },
  { name: 'Housing and Urban Development Act of 1970', pattern: 'Housing[\\s\\-]+and[\\s\\-]+Urban[\\s\\-]+Development[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1970', title: '12', section: '1701z-1', range: '1701z-1 et seq.' },
  { name: 'Telemarketing and Consumer Fraud and Abuse Prevention Act', pattern: 'Telemarketing[\\s\\-]+and[\\s\\-]+Consumer[\\s\\-]+Fraud[\\s\\-]+and[\\s\\-]+Abuse[\\s\\-]+Prevention[\\s\\-]+Act', title: '15', section: '6101', range: '6101 et seq.', enactedAs: 'Pub. L. 103–297' },
  { name: 'Alaska National Interest Lands Conservation Act', pattern: 'Alaska[\\s\\-]+National[\\s\\-]+Interest[\\s\\-]+Lands[\\s\\-]+Conservation[\\s\\-]+Act', title: '16', section: '3111', range: '3111 et seq.', enactedAs: 'Pub. L. 96–487' },
  { name: 'Fish and Wildlife Act of 1956', pattern: 'Fish[\\s\\-]+and[\\s\\-]+Wildlife[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1956', title: '16', section: '742a', range: '742a et seq.', enactedAs: 'Aug. 8, 1956, ch. 1036' },
  { name: 'Equal Credit Opportunity Act', pattern: 'Equal[\\s\\-]+Credit[\\s\\-]+Opportunity[\\s\\-]+Act', title: '15', section: '1691', range: '1691 et seq.', enactedAs: 'Pub. L. 90–321' },
  { name: 'Poultry Products Inspection Act', pattern: 'Poultry[\\s\\-]+Products[\\s\\-]+Inspection[\\s\\-]+Act', title: '21', section: '451', range: '451 et seq.', enactedAs: 'Pub. L. 85–172' },
  { name: 'Egg Products Inspection Act', pattern: 'Egg[\\s\\-]+Products[\\s\\-]+Inspection[\\s\\-]+Act', title: '21', section: '1031', range: '1031 et seq.', enactedAs: 'Pub. L. 91–597' },
  { name: 'Plant Protection Act', pattern: 'Plant[\\s\\-]+Protection[\\s\\-]+Act', title: '7', section: '7701', range: '7701 et seq.', enactedAs: 'Pub. L. 106–224' },
  { name: 'PROTECT Act', pattern: 'PROTECT[\\s\\-]+Act', title: '34', section: '20501', range: '20501 et seq.', enactedAs: 'Pub. L. 108–21' },
  { name: 'Legal Certainty for Bank Products Act of 2000', pattern: 'Legal[\\s\\-]+Certainty[\\s\\-]+for[\\s\\-]+Bank[\\s\\-]+Products[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2000', title: '7', section: '27', range: '27 et seq.' },
  { name: 'Juvenile Justice and Delinquency Prevention Act of 1974', pattern: 'Juvenile[\\s\\-]+Justice[\\s\\-]+and[\\s\\-]+Delinquency[\\s\\-]+Prevention[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1974', title: '34', section: '11101', range: '11101 et seq.', enactedAs: 'Pub. L. 93–415' },
  { name: 'Bank Service Company Act', pattern: 'Bank[\\s\\-]+Service[\\s\\-]+Company[\\s\\-]+Act', title: '12', section: '1861', range: '1861 et seq.', enactedAs: 'Pub. L. 87–856' },
  { name: 'Countering America\'s Adversaries Through Sanctions Act', pattern: 'Countering[\\s\\-]+America\'s[\\s\\-]+Adversaries[\\s\\-]+Through[\\s\\-]+Sanctions[\\s\\-]+Act', title: '22', section: '9401', range: '9401 et seq.', enactedAs: 'Pub. L. 115–44' },
  { name: 'Interstate Land Sales Full Disclosure Act', pattern: 'Interstate[\\s\\-]+Land[\\s\\-]+Sales[\\s\\-]+Full[\\s\\-]+Disclosure[\\s\\-]+Act', title: '15', section: '1701', range: '1701 et seq.' },
  { name: 'Missing Children\'s Assistance Act', pattern: 'Missing[\\s\\-]+Children\'s[\\s\\-]+Assistance[\\s\\-]+Act', title: '34', section: '11291', range: '11291 et seq.', enactedAs: 'Pub. L. 93–415' },
  { name: 'Neotropical Migratory Bird Conservation Act', pattern: 'Neotropical[\\s\\-]+Migratory[\\s\\-]+Bird[\\s\\-]+Conservation[\\s\\-]+Act', title: '16', section: '6101', range: '6101 et seq.', enactedAs: 'Pub. L. 106–247' },
  { name: 'Federal Medical Care Recovery Act', pattern: 'Federal[\\s\\-]+Medical[\\s\\-]+Care[\\s\\-]+Recovery[\\s\\-]+Act', title: '42', section: '2651', range: '2651 et seq.', enactedAs: 'Pub. L. 87–693' },
  { name: 'Servicemembers Civil Relief Act', pattern: 'Servicemembers[\\s\\-]+Civil[\\s\\-]+Relief[\\s\\-]+Act', title: '50', section: '3901', range: '3901 et seq.', enactedAs: 'Oct. 17, 1940, ch. 888' },
  { name: 'Native American Languages Act', pattern: 'Native[\\s\\-]+American[\\s\\-]+Languages[\\s\\-]+Act', title: '25', section: '2901', range: '2901 et seq.', enactedAs: 'Pub. L. 101–477' },
  { name: 'African Elephant Conservation Act', pattern: 'African[\\s\\-]+Elephant[\\s\\-]+Conservation[\\s\\-]+Act', title: '16', section: '4201', range: '4201 et seq.', enactedAs: 'Pub. L. 100–478' },
  { name: 'Rhinoceros and Tiger Conservation Act of 1994', pattern: 'Rhinoceros[\\s\\-]+and[\\s\\-]+Tiger[\\s\\-]+Conservation[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1994', title: '16', section: '5301', range: '5301 et seq.', enactedAs: 'Pub. L. 103–391' },
  { name: 'AIDS Housing Opportunity Act', pattern: 'AIDS[\\s\\-]+Housing[\\s\\-]+Opportunity[\\s\\-]+Act', title: '42', section: '12901', range: '12901 et seq.', enactedAs: 'Pub. L. 101–625' },
  { name: 'National Manufactured Housing Construction and Safety Standards Act of 1974', pattern: 'National[\\s\\-]+Manufactured[\\s\\-]+Housing[\\s\\-]+Construction[\\s\\-]+and[\\s\\-]+Safety[\\s\\-]+Standards[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1974', title: '42', section: '5401', range: '5401 et seq.', enactedAs: 'Pub. L. 93–383' },
  { name: 'Fair Debt Collection Practices Act', pattern: 'Fair[\\s\\-]+Debt[\\s\\-]+Collection[\\s\\-]+Practices[\\s\\-]+Act', title: '15', section: '1692', range: '1692 et seq.', enactedAs: 'Pub. L. 90–321' },
  { name: 'Community Development Banking and Financial Institutions Act of 1994', pattern: 'Community[\\s\\-]+Development[\\s\\-]+Banking[\\s\\-]+and[\\s\\-]+Financial[\\s\\-]+Institutions[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1994', title: '12', section: '4701', range: '4701 et seq.' },
  { name: 'Federal Alcohol Administration Act', pattern: 'Federal[\\s\\-]+Alcohol[\\s\\-]+Administration[\\s\\-]+Act', title: '27', section: '201', range: '201 et seq.', enactedAs: 'Aug. 29, 1935, ch. 814' },
  { name: 'North American Wetlands Conservation Act', pattern: 'North[\\s\\-]+American[\\s\\-]+Wetlands[\\s\\-]+Conservation[\\s\\-]+Act', title: '16', section: '4401', range: '4401 et seq.', enactedAs: 'Pub. L. 101–233' },
  { name: 'Uniform Relocation Assistance and Real Property Acquisition Policies Act of 1970', pattern: 'Uniform[\\s\\-]+Relocation[\\s\\-]+Assistance[\\s\\-]+and[\\s\\-]+Real[\\s\\-]+Property[\\s\\-]+Acquisition[\\s\\-]+Policies[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1970', title: '42', section: '4601', range: '4601 et seq.', enactedAs: 'Pub. L. 91–646' },
  { name: 'Securities and Exchange Act of 1934', pattern: 'Securities[\\s\\-]+and[\\s\\-]+Exchange[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1934', title: '15', section: '78a', range: '78a et seq.', enactedAs: 'June 6, 1934, ch. 404' },
  { name: 'Fair Credit Billing Act', pattern: 'Fair[\\s\\-]+Credit[\\s\\-]+Billing[\\s\\-]+Act', title: '15', section: '1666', range: '1666 et seq.', enactedAs: 'Pub. L. 90–321' },
  { name: 'Eliminate, Neutralize, and Disrupt Wildlife Trafficking Act of 2016', pattern: 'Eliminate,[\\s\\-]+Neutralize,[\\s\\-]+and[\\s\\-]+Disrupt[\\s\\-]+Wildlife[\\s\\-]+Trafficking[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2016', title: '16', section: '7601', range: '7601 et seq.', enactedAs: 'Pub. L. 114–231' },
  { name: 'False Claims Act', pattern: 'False[\\s\\-]+Claims[\\s\\-]+Act', title: '31', section: '3729', range: '3729 et seq.' },
  { name: 'Better Utilization of Investments Leading to Development Act of 2018', pattern: 'Better[\\s\\-]+Utilization[\\s\\-]+of[\\s\\-]+Investments[\\s\\-]+Leading[\\s\\-]+to[\\s\\-]+Development[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2018', title: '22', section: '9601', range: '9601 et seq.' },
  { name: 'War Hazards Compensation Act', pattern: 'War[\\s\\-]+Hazards[\\s\\-]+Compensation[\\s\\-]+Act', title: '42', section: '1701', range: '1701 et seq.', enactedAs: 'Dec. 2, 1942, ch. 668' },
  { name: 'National Cultural Center Act', pattern: 'National[\\s\\-]+Cultural[\\s\\-]+Center[\\s\\-]+Act', title: '20', section: '76h', range: '76h et seq.', enactedAs: 'Pub. L. 85–874' },
  { name: 'Commodity Promotion, Research, and Information Act of 1996', pattern: 'Commodity[\\s\\-]+Promotion,[\\s\\-]+Research,[\\s\\-]+and[\\s\\-]+Information[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1996', title: '7', section: '7401', range: '7401 et seq.', enactedAs: 'Pub. L. 104–127' },
  { name: 'Southwest Forest Health and Wildfire Prevention Act of 2004', pattern: 'Southwest[\\s\\-]+Forest[\\s\\-]+Health[\\s\\-]+and[\\s\\-]+Wildfire[\\s\\-]+Prevention[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+2004', title: '16', section: '6701', range: '6701 et seq.', enactedAs: 'Pub. L. 108–317' },
  { name: 'Reclamation Safety of Dams Act of 1978', pattern: 'Reclamation[\\s\\-]+Safety[\\s\\-]+of[\\s\\-]+Dams[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1978', title: '43', section: '506', range: '506 et seq.', enactedAs: 'Pub. L. 95–578' },
  { name: 'Electronic Signatures in Global and National Commerce Act', pattern: 'Electronic[\\s\\-]+Signatures[\\s\\-]+in[\\s\\-]+Global[\\s\\-]+and[\\s\\-]+National[\\s\\-]+Commerce[\\s\\-]+Act', title: '15', section: '7001', range: '7001 et seq.', enactedAs: 'Pub. L. 106–229' },
  { name: 'Indian Gaming Regulatory Act', pattern: 'Indian[\\s\\-]+Gaming[\\s\\-]+Regulatory[\\s\\-]+Act', title: '25', section: '2701', range: '2701 et seq.', enactedAs: 'Pub. L. 100–497' },
  { name: 'Anti-Deficiency Act', pattern: 'Anti[\\s\\-]+Deficiency[\\s\\-]+Act', title: '31', section: '1511', range: '1511 et seq.' },
  { name: 'Warning, Alert, and Response Network Act', pattern: 'Warning,[\\s\\-]+Alert,[\\s\\-]+and[\\s\\-]+Response[\\s\\-]+Network[\\s\\-]+Act', title: '47', section: '1201', range: '1201 et seq.' },
  // Harvested with the sentence in front of it — "the Secretary of the Interior
  // under the Indian Self-Determination…". Trimmed to the Act's own name rather
  // than deleted, because the sibling entry below requires the year and this is
  // the only one that reads the year-less form. Anchored where that sibling is;
  // 5304 is the Act's definitions section, not its start.
  { name: 'Indian Self-Determination and Education Assistance Act', pattern: 'Indian[\\s\\-]+Self[\\s\\-]+Determination[\\s\\-]+and[\\s\\-]+Education[\\s\\-]+Assistance[\\s\\-]+Act', title: '25', section: '5301', range: '5301 et seq.', enactedAs: 'Pub. L. 93–638' },
  { name: 'Barry Goldwater Scholarship and Excellence in Education Act of 1986', pattern: 'Barry[\\s\\-]+Goldwater[\\s\\-]+Scholarship[\\s\\-]+and[\\s\\-]+Excellence[\\s\\-]+in[\\s\\-]+Education[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1986', title: '20', section: '4701', range: '4701 et seq.', enactedAs: 'Pub. L. 99–661' },
  { name: 'Federal Columbia River Transmission System Act', pattern: 'Federal[\\s\\-]+Columbia[\\s\\-]+River[\\s\\-]+Transmission[\\s\\-]+System[\\s\\-]+Act', title: '16', section: '838', range: '838 et seq.', enactedAs: 'Pub. L. 93–454' },
  { name: 'Depository Institutions Management Interlocks Act', pattern: 'Depository[\\s\\-]+Institutions[\\s\\-]+Management[\\s\\-]+Interlocks[\\s\\-]+Act', title: '12', section: '3201', range: '3201 et seq.', enactedAs: 'Pub. L. 95–630' },
  // A harvested "Securities Exchange Act of 1934.--The Securities Exchange Act
  // of 1934" was deleted outright: the harvest ran a section HEADING into the
  // sentence below it, so the chip covered the heading, its terminating period
  // and the first words of the body — rendering body text inside the .sec-head.
  // The clean entry above resolves the same Act to the same provision.
  //
  // Trimmed from two harvested spellings, "Bankruptcy Code or the …" and
  // "Bankruptcy Code, the …" — the harvest took the sentence in front of the
  // name. Trimmed rather than deleted, the way the Investment Company Act was:
  // SIPA has no other entry, so deleting these would lose the Act outright.
  { name: 'Securities Investor Protection Act of 1970', pattern: 'Securities[\\s\\-]+Investor[\\s\\-]+Protection[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1970', title: '15', section: '78aaa', range: '78aaa et seq.', enactedAs: 'Pub. L. 91–598' },
  { name: 'Sikes Act', pattern: 'Sikes[\\s\\-]+Act', title: '16', section: '670', range: '670 et seq.', enactedAs: 'Pub. L. 86–797' },
  { name: 'Defense Base Act', pattern: 'Defense[\\s\\-]+Base[\\s\\-]+Act', title: '42', section: '1651', range: '1651 et seq.', enactedAs: 'Aug. 16, 1941, ch. 357' },
  { name: 'International Economic Emergency Powers Act', pattern: 'International[\\s\\-]+Economic[\\s\\-]+Emergency[\\s\\-]+Powers[\\s\\-]+Act', title: '50', section: '1701', range: '1701 et seq.', enactedAs: 'Pub. L. 95–223' },
  { name: 'Alaska Native Educational Equity, Support, and Assistance Act', pattern: 'Alaska[\\s\\-]+Native[\\s\\-]+Educational[\\s\\-]+Equity,[\\s\\-]+Support,[\\s\\-]+and[\\s\\-]+Assistance[\\s\\-]+Act', title: '20', section: '6301', range: '6301 et seq.', enactedAs: 'Pub. L. 89–10' },
  { name: 'Safe and Drug-Free Schools and Communities Act', pattern: 'Safe[\\s\\-]+and[\\s\\-]+Drug[\\s\\-]+Free[\\s\\-]+Schools[\\s\\-]+and[\\s\\-]+Communities[\\s\\-]+Act', title: '20', section: '7101', range: '7101 et seq.', enactedAs: 'Pub. L. 89–10' },
  // Same harvest fault, and this Act has no other entry at all — so trimmed
  // rather than dropped. 15 U.S.C. 80a-1 really is the Act's first section.
  { name: 'Investment Company Act of 1940', pattern: 'Investment[\\s\\-]+Company[\\s\\-]+Act[\\s\\-]+of[\\s\\-]+1940', title: '15', section: '80a-1', range: '80a-1 et seq.' },
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
