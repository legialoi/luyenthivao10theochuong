import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

interface MathTextProps {
  text?: string;
  content?: string;
}

function normalizeLatexFormula(formula: string): string {
  return formula
    .trim()
    .replace(/\\wideparen\s*\{([^}]+)\}/g, '\\overset{\\frown}{$1}')
    .replace(/\\tg\b/g, '\\tan')
    .replace(/\\cotg\b/g, '\\cot')
    .replace(/°/g, '^\\circ ');
}

export default function MathText({ text, content }: MathTextProps) {
  const rawInput = text ?? content ?? '';
  if (!rawInput) return null;

  // Unescape common HTML entities that might come from mammoth/word parsing
  const unescapedText = rawInput
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Regex để bóc tách:
  // 1. Block LaTeX: $$...$$ hoặc \[...\]
  // 2. Inline/Block LaTeX: $...$ hoặc \(...\)
  // 3. Standalone environments: \begin{cases}...\end{cases}, \begin{aligned}...\end{aligned}, \begin{equation}...\end{equation}, \begin{matrix}...\end{matrix}
  // 4. Thẻ <img>
  const parts = unescapedText
    .split(
      /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[\s\S]+?\$|\\\([\s\S]+?\\\)|\\begin\{(?:cases|aligned|equation\*?|matrix|pmatrix|bmatrix|vmatrix|array)\}[\s\S]+?\\end\{(?:cases|aligned|equation\*?|matrix|pmatrix|bmatrix|vmatrix|array)\}|<img[\s\S]+?\/?>)/g
    )
    .filter(Boolean);

  return (
    <span className="leading-relaxed break-words">
      {parts.map((part, index) => {
        if ((part.startsWith('$$') && part.endsWith('$$')) || (part.startsWith('\\[') && part.endsWith('\\]'))) {
          const mathContent = normalizeLatexFormula(part.slice(2, -2));
          return (
            <span key={index} className="block my-2 overflow-x-auto max-w-full">
              <BlockMath
                math={mathContent}
                errorColor={'#cc0000'}
                renderError={(error) => <span title={error.message} className="font-mono text-rose-600">{part}</span>}
                settings={{ strict: 'ignore' }}
              />
            </span>
          );
        } else if (part.startsWith('\\begin{')) {
          const mathContent = normalizeLatexFormula(part.replace(/^\\begin\{equation\*?\}/, '\\begin{aligned}').replace(/\\end\{equation\*?\}$/, '\\end{aligned}'));
          return (
            <span key={index} className="inline-block my-1 align-middle overflow-x-auto max-w-full">
              <InlineMath
                math={mathContent}
                errorColor={'#cc0000'}
                renderError={(error) => <span title={error.message} className="font-mono text-rose-600">{part}</span>}
                settings={{ strict: 'ignore' }}
              />
            </span>
          );
        } else if ((part.startsWith('$') && part.endsWith('$')) || (part.startsWith('\\(') && part.endsWith('\\)'))) {
          const rawMath = part.startsWith('\\(') ? part.slice(2, -2) : part.slice(1, -1);
          const mathContent = normalizeLatexFormula(
            rawMath
              .replace(/^\\begin\{equation\*?\}/, '\\begin{aligned}')
              .replace(/\\end\{equation\*?\}$/, '\\end{aligned}')
          );
          return (
            <InlineMath
              key={index}
              math={mathContent}
              errorColor={'#cc0000'}
              renderError={(error) => <span title={error.message} className="font-mono text-rose-600">{part}</span>}
              settings={{ strict: 'ignore' }}
            />
          );
        } else if (part.startsWith('<img')) {
          return (
            <span
              key={index}
              className="inline-block my-2 max-w-full overflow-hidden rounded-lg [&_img]:max-h-64 [&_img]:w-auto [&_img]:max-w-full [&_img]:object-contain [&_img]:mx-auto"
              dangerouslySetInnerHTML={{ __html: part }}
            />
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}
