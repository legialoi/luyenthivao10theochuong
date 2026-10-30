import JSZip from 'jszip';

const SYMBOL_MAP: Record<string, string> = {
  '×': '\\times ',
  '÷': '\\div ',
  '±': '\\pm ',
  '∓': '\\mp ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\neq ',
  '≈': '\\approx ',
  '≡': '\\equiv ',
  '∞': '\\infty ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊃': '\\supset ',
  '⊆': '\\subseteq ',
  '⊇': '\\supseteq ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '∅': '\\varnothing ',
  '∀': '\\forall ',
  '∃': '\\exists ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '→': '\\rightarrow ',
  '←': '\\leftarrow ',
  '↔': '\\leftrightarrow ',
  '⊥': '\\perp ',
  '∥': '\\parallel ',
  '∠': '\\widehat ',
  '△': '\\triangle ',
  '∆': '\\Delta ',
  'Δ': '\\Delta ',
  'π': '\\pi ',
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'δ': '\\delta ',
  'ε': '\\varepsilon ',
  'θ': '\\theta ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'σ': '\\sigma ',
  'φ': '\\varphi ',
  'ω': '\\omega ',
  'Ω': '\\Omega ',
  '°': '^\\circ ',
  '⋅': '\\cdot ',
  '∙': '\\cdot ',
  'ℝ': '\\mathbb{R}',
  'ℤ': '\\mathbb{Z}',
  'ℕ': '\\mathbb{N}',
  'ℚ': '\\mathbb{Q}',
};

function replaceUnicodeMathSymbols(text: string): string {
  let out = '';
  for (const ch of text) {
    out += SYMBOL_MAP[ch] ?? ch;
  }
  return out;
}

function getLocalName(node: Node): string {
  return (node as Element).localName || node.nodeName.replace(/^.*:/, '');
}

function findChild(parent: Element, localName: string): Element | null {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (getLocalName(child) === localName) return child;
  }
  return null;
}

function findChildren(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (getLocalName(child) === localName) result.push(child);
  }
  return result;
}

function getAttrVal(el: Element | null, attrName = 'val'): string {
  if (!el) return '';
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr.localName === attrName || attr.name.endsWith(`:${attrName}`) || attr.name === attrName) {
      return attr.value;
    }
  }
  return '';
}

function convertChildren(el: Element | null): string {
  if (!el) return '';
  let res = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    res += convertOmmlNode(el.childNodes[i]);
  }
  return res.trim();
}

export function convertOmmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return replaceUnicodeMathSymbols(node.textContent || '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = getLocalName(el);

  switch (tag) {
    case 'oMathPara':
    case 'oMath':
    case 'e':
    case 'num':
    case 'den':
    case 'deg':
    case 'sub':
    case 'sup':
    case 'fName':
    case 'lim':
      return convertChildren(el);

    case 'r': {
      let text = '';
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        const cTag = getLocalName(child);
        if (cTag === 't') {
          text += replaceUnicodeMathSymbols(child.textContent || '');
        }
      }
      return text;
    }

    case 't':
      return replaceUnicodeMathSymbols(el.textContent || '');

    case 'f': {
      const fPr = findChild(el, 'fPr');
      const typeEl = fPr ? findChild(fPr, 'type') : null;
      const fType = getAttrVal(typeEl);
      const num = convertChildren(findChild(el, 'num'));
      const den = convertChildren(findChild(el, 'den'));
      if (fType === 'lin') {
        return `(${num})/(${den})`;
      }
      if (fType === 'noBar') {
        return `\\binom{${num}}{${den}}`;
      }
      return `\\frac{${num}}{${den}}`;
    }

    case 'rad': {
      const radPr = findChild(el, 'radPr');
      const degHideEl = radPr ? findChild(radPr, 'degHide') : null;
      const degHide = getAttrVal(degHideEl);
      const deg = convertChildren(findChild(el, 'deg'));
      const base = convertChildren(findChild(el, 'e'));
      if (degHide === '1' || degHide === 'on' || !deg) {
        return `\\sqrt{${base}}`;
      }
      return `\\sqrt[${deg}]{${base}}`;
    }

    case 'sSup': {
      const base = convertChildren(findChild(el, 'e'));
      const sup = convertChildren(findChild(el, 'sup'));
      const wrappedBase = base.length > 1 && !base.startsWith('{') ? `{${base}}` : base;
      return `${wrappedBase}^{${sup}}`;
    }

    case 'sSub': {
      const base = convertChildren(findChild(el, 'e'));
      const sub = convertChildren(findChild(el, 'sub'));
      const wrappedBase = base.length > 1 && !base.startsWith('{') ? `{${base}}` : base;
      return `${wrappedBase}_{${sub}}`;
    }

    case 'sSubSup': {
      const base = convertChildren(findChild(el, 'e'));
      const sub = convertChildren(findChild(el, 'sub'));
      const sup = convertChildren(findChild(el, 'sup'));
      const wrappedBase = base.length > 1 && !base.startsWith('{') ? `{${base}}` : base;
      return `${wrappedBase}_{${sub}}^{${sup}}`;
    }

    case 'sPre': {
      const sub = convertChildren(findChild(el, 'sub'));
      const sup = convertChildren(findChild(el, 'sup'));
      const base = convertChildren(findChild(el, 'e'));
      return `{}_{${sub}}^{${sup}}${base}`;
    }

    case 'd': {
      const dPr = findChild(el, 'dPr');
      const begChrEl = dPr ? findChild(dPr, 'begChr') : null;
      const endChrEl = dPr ? findChild(dPr, 'endChr') : null;
      const sepChrEl = dPr ? findChild(dPr, 'sepChr') : null;

      const begChr = begChrEl ? getAttrVal(begChrEl) : '(';
      const endChr = endChrEl ? getAttrVal(endChrEl) : ')';
      const sepChr = sepChrEl ? getAttrVal(sepChrEl) : '|';

      const elements = findChildren(el, 'e');
      const innerParts = elements.map(eNode => {
        const eqArr = findChild(eNode, 'eqArr');
        if (eqArr) {
          const rows = findChildren(eqArr, 'e').map(r => convertChildren(r));
          return { isEqArr: true, rows, raw: rows.join(' \\\\ ') };
        }
        return { isEqArr: false, rows: [convertChildren(eNode)], raw: convertChildren(eNode) };
      });

      if (begChr === '{' && (!endChr || endChr === '') && (elements.length > 1 || innerParts.some(p => p.isEqArr))) {
        const allRows = innerParts.flatMap(p => p.rows);
        return `\\begin{cases} ${allRows.join(' \\\\ ')} \\end{cases}`;
      }

      if (begChr === '[' && (!endChr || endChr === '') && (elements.length > 1 || innerParts.some(p => p.isEqArr))) {
        const allRows = innerParts.flatMap(p => p.rows);
        return `\\left[ \\begin{aligned} ${allRows.join(' \\\\ ')} \\end{aligned} \\right.`;
      }

      const mapDelim = (c: string, isLeft: boolean): string => {
        if (!c) return '.';
        if (c === '{') return '\\{';
        if (c === '}') return '\\}';
        if (c === '|') return '|';
        if (c === '‖' || c === '||') return '\\|';
        if (c === '(' || c === ')' || c === '[' || c === ']') return c;
        return isLeft ? '(' : ')';
      };

      const leftD = mapDelim(begChr, true);
      const rightD = mapDelim(endChr, false);
      const joined = innerParts.map(p => p.raw).join(` ${sepChr} `);
      return `\\left${leftD} ${joined} \\right${rightD}`;
    }

    case 'eqArr': {
      const rows = findChildren(el, 'e').map(r => convertChildren(r));
      if (rows.length <= 1) return rows[0] || '';
      return `\\begin{aligned} ${rows.join(' \\\\ ')} \\end{aligned}`;
    }

    case 'm': {
      const rows = findChildren(el, 'mr').map(mr => {
        const cols = findChildren(mr, 'e').map(c => convertChildren(c));
        return cols.join(' & ');
      });
      return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
    }

    case 'acc': {
      const accPr = findChild(el, 'accPr');
      const chrEl = accPr ? findChild(accPr, 'chr') : null;
      const chr = getAttrVal(chrEl);
      const base = convertChildren(findChild(el, 'e'));

      if (chr === '̂' || chr === '^' || chr === '\u0302') {
        return base.length > 1 ? `\\widehat{${base}}` : `\\hat{${base}}`;
      }
      if (chr === '⃗' || chr === '\u20d7' || chr === '→') {
        return `\\overrightarrow{${base}}`;
      }
      if (chr === '¯' || chr === '\u0304' || chr === '\u0305') {
        return `\\overline{${base}}`;
      }
      if (chr === '˘' || chr === '\u0306' || chr === '⌒' || chr === '\u0311') {
        return `\\overset{\\frown}{${base}}`;
      }
      if (chr === '˜' || chr === '~' || chr === '\u0303') {
        return base.length > 1 ? `\\widetilde{${base}}` : `\\tilde{${base}}`;
      }
      return `\\widehat{${base}}`;
    }

    case 'bar': {
      const base = convertChildren(findChild(el, 'e'));
      return `\\overline{${base}}`;
    }

    case 'groupChr': {
      const groupChrPr = findChild(el, 'groupChrPr');
      const chrEl = groupChrPr ? findChild(groupChrPr, 'chr') : null;
      const chr = getAttrVal(chrEl);
      const base = convertChildren(findChild(el, 'e'));
      if (chr === '⏟' || chr === '\u23df') return `\\underbrace{${base}}`;
      if (chr === '⏞' || chr === '\u23de') return `\\overbrace{${base}}`;
      return `\\overrightarrow{${base}}`;
    }

    case 'func': {
      const fName = convertChildren(findChild(el, 'fName')).trim();
      const base = convertChildren(findChild(el, 'e'));
      const cleanFn = fName.replace(/^\\/, '');
      const knownFuncs = ['sin', 'cos', 'tan', 'cot', 'tg', 'cotg', 'ln', 'log', 'lim', 'max', 'min', 'gcd', 'lcm'];
      const latexFn = knownFuncs.includes(cleanFn)
        ? cleanFn === 'tg'
          ? '\\tan'
          : cleanFn === 'cotg'
          ? '\\cot'
          : `\\${cleanFn}`
        : fName;
      return `${latexFn}{${base}}`;
    }

    case 'limLow': {
      const base = convertChildren(findChild(el, 'e'));
      const lim = convertChildren(findChild(el, 'lim'));
      return `${base}_{${lim}}`;
    }

    case 'limUpp': {
      const base = convertChildren(findChild(el, 'e'));
      const lim = convertChildren(findChild(el, 'lim'));
      return `\\overset{${lim}}{${base}}`;
    }

    case 'nary': {
      const naryPr = findChild(el, 'naryPr');
      const chrEl = naryPr ? findChild(naryPr, 'chr') : null;
      const chr = getAttrVal(chrEl) || '∫';
      const sub = convertChildren(findChild(el, 'sub'));
      const sup = convertChildren(findChild(el, 'sup'));
      const base = convertChildren(findChild(el, 'e'));

      let op = '\\int';
      if (chr === '∑') op = '\\sum';
      else if (chr === '∏') op = '\\prod';
      else if (chr === '⋃') op = '\\bigcup';
      else if (chr === '⋂') op = '\\bigcap';

      const subPart = sub ? `_{${sub}}` : '';
      const supPart = sup ? `^{${sup}}` : '';
      return `${op}${subPart}${supPart} ${base}`;
    }

    case 'box':
    case 'borderBox':
      return convertChildren(findChild(el, 'e'));

    default:
      return convertChildren(el);
  }
}

export async function preprocessDocxEquations(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docFile = zip.file('word/document.xml');
    if (!docFile) return arrayBuffer;

    const xmlText = await docFile.async('string');
    if (!xmlText.includes('oMath')) {
      return arrayBuffer;
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    const replaceMathElementWithTextRun = (mathEl: Element) => {
      const latex = convertOmmlNode(mathEl).replace(/\s+/g, ' ').trim();
      if (!latex) return;
      const wRun = xmlDoc.createElementNS(wNs, 'w:r');
      const wText = xmlDoc.createElementNS(wNs, 'w:t');
      wText.setAttribute('xml:space', 'preserve');
      wText.textContent = ` $${latex}$ `;
      wRun.appendChild(wText);
      mathEl.parentNode?.replaceChild(wRun, mathEl);
    };

    const allElements = Array.from(xmlDoc.getElementsByTagName('*'));
    for (const el of allElements) {
      if (getLocalName(el) === 'oMathPara' && el.parentNode) {
        replaceMathElementWithTextRun(el);
      }
    }

    const remainingElements = Array.from(xmlDoc.getElementsByTagName('*'));
    for (const el of remainingElements) {
      if (getLocalName(el) === 'oMath' && el.parentNode) {
        replaceMathElementWithTextRun(el);
      }
    }

    const serializer = new XMLSerializer();
    const updatedXml = serializer.serializeToString(xmlDoc);
    zip.file('word/document.xml', updatedXml);
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch (err) {
    console.warn('OMML preprocessing fallback:', err);
    return arrayBuffer;
  }
}
