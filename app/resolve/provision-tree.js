// Turn a flat run of statutory/regulatory paragraphs into a nested tree.
//
// Neither eCFR XML nor plain bill text marks subsection depth structurally — the
// hierarchy is encoded in the enumerator prefix at the head of each paragraph:
//
//   (a)   -> level 0   lowercase letter
//   (1)   -> level 1   arabic
//   (A)   -> level 2   uppercase letter
//   (i)   -> level 3   lowercase roman
//   (I)   -> level 4   uppercase roman
//
// The ambiguity that matters: "(i)" is both a lowercase letter (9th) and roman 1,
// and "(I)"/"(V)"/"(X)" collide the same way. We resolve by context — a roman
// reading is only accepted when the enclosing run makes it the natural successor.

const ROMAN = /^(?:x{0,3})(?:ix|iv|v?i{0,3})$/;

function classify(marker) {
  const m = marker.slice(1, -1); // strip parens
  if (/^\d+$/.test(m)) return { kind: 'arabic', level: 1, ord: parseInt(m, 10) };
  if (/^[a-z]+$/.test(m)) {
    const romanOk = ROMAN.test(m) && m.length > 0;
    // Single lowercase letters default to the letter reading; multi-char
    // sequences like "ii"/"iv" can only be roman.
    if (m.length > 1 && romanOk) return { kind: 'roman-lower', level: 3, ord: romanValue(m) };
    return { kind: 'alpha-lower', level: 0, ord: m.charCodeAt(0) - 96, roman: romanOk };
  }
  if (/^[A-Z]+$/.test(m)) {
    const romanOk = ROMAN.test(m.toLowerCase());
    if (m.length > 1 && romanOk) return { kind: 'roman-upper', level: 4, ord: romanValue(m.toLowerCase()) };
    return { kind: 'alpha-upper', level: 2, ord: m.charCodeAt(0) - 64, roman: romanOk };
  }
  return { kind: 'other', level: 0, ord: 0 };
}

function romanValue(s) {
  const map = { i: 1, v: 5, x: 10 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = map[s[i]] || 0;
    const next = map[s[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

const MARKER = /^\s*(\([A-Za-z0-9]{1,8}\))\s*/;

/**
 * @param {string[]} paragraphs  paragraph strings, in document order
 * @returns {Array} nested nodes: { marker, path, text, children }
 */
export function buildTree(paragraphs) {
  const root = { marker: '', path: '', text: '', children: [] };
  // stack[i] holds the most recent node opened at level i.
  const stack = [root];
  const levelOf = new Map([[root, -1]]);

  for (const para of paragraphs) {
    const m = para.match(MARKER);
    if (!m) {
      // Continuation text (flush language, an unnumbered lead-in). Attach it to
      // whatever provision is currently open rather than dropping it.
      const cur = stack[stack.length - 1];
      cur.text = cur.text ? `${cur.text}\n${para.trim()}` : para.trim();
      continue;
    }

    const marker = m[1];
    const rest = para.slice(m[0].length).trim();
    const info = classify(marker);
    let level = info.level;

    // Disambiguate the letter/roman collision: "(i)" is both the 9th letter and
    // roman one. It's a letter only when it continues an existing letter run,
    // i.e. the previous sibling *at the letter level* is "(h)". Finding that
    // sibling means looking past the nodes still open above the letter level —
    // the stack top is usually "(h)" itself, whose children are empty.
    const continuesRun = (letterLevel, wantPrev) => {
      let k = stack.length - 1;
      while (k > 0 && levelOf.get(stack[k]) >= letterLevel) k--;
      const parent = stack[k];
      const prevSib = parent.children[parent.children.length - 1];
      return Boolean(prevSib && prevSib.marker === wantPrev);
    };
    if (info.roman && info.kind === 'alpha-lower' && marker === '(i)' && !continuesRun(0, '(h)')) {
      level = 3;
    }
    if (info.roman && info.kind === 'alpha-upper' && marker === '(I)' && !continuesRun(2, '(H)')) {
      level = 4;
    }

    // Pop until the stack top is the parent for this level.
    while (stack.length > 1 && levelOf.get(stack[stack.length - 1]) >= level) stack.pop();

    const parent = stack[stack.length - 1];
    const node = {
      marker,
      path: parent.path + marker,
      text: rest,
      children: [],
    };
    parent.children.push(node);
    levelOf.set(node, level);
    stack.push(node);
  }

  return root.children;
}

/** Depth-first search for the node whose path equals `path` (e.g. "(s)(2)(B)"). */
export function findNode(nodes, path) {
  if (!path) return null;
  for (const n of nodes) {
    if (n.path === path) return n;
    const hit = findNode(n.children, path);
    if (hit) return hit;
  }
  return null;
}

/** The chain of nodes from the outermost ancestor down to `path`, inclusive. */
export function pathChain(nodes, path) {
  const chain = [];
  let level = nodes;
  let acc = '';
  for (const marker of path.match(/\([A-Za-z0-9]{1,8}\)/g) || []) {
    acc += marker;
    const node = level.find((n) => n.path === acc);
    if (!node) break;
    chain.push(node);
    level = node.children;
  }
  return chain;
}

/** Flatten a node's text plus all descendants, for preview/diff purposes. */
export function flattenText(node) {
  const parts = [];
  const walk = (n) => {
    parts.push(`${n.marker} ${n.text}`.trim());
    n.children.forEach(walk);
  };
  walk(node);
  return parts.join('\n');
}
