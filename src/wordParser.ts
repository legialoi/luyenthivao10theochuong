import mammoth from 'mammoth';
import { solveQuestion } from '../services/geminiService';
import { preprocessDocxEquations } from './ommlToLatex';

export interface ParsedQuestion {
  id?: string;
  content: string;
  options: string[];
  correctAnswer: number;
  category: string;
  chapter?: string;
}

export const parseWordToQuiz = async (file: File, category: string): Promise<ParsedQuestion[]> => {
  const rawBuffer = await file.arrayBuffer();
  const arrayBuffer = await preprocessDocxEquations(rawBuffer);
  
  // mammoth.convertToHtml enables image extraction (converted to base64 by default)
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value;

  // Convert <sup> and <sub> from Word formatting into LaTeX superscripts/subscripts before stripping HTML tags
  const htmlWithMathSupSub = html
    .replace(/([a-zA-Z0-9)\]])\s*<sup>([^<]+)<\/sup>/gi, (_, base, sup) => `$${base}^{${sup.trim()}}$`)
    .replace(/([a-zA-Z0-9)\]])\s*<sub>([^<]+)<\/sub>/gi, (_, base, sub) => `$${base}_{${sub.trim()}}$`)
    .replace(/<sup>([^<]+)<\/sup>/gi, (_, sup) => `$^{${sup.trim()}}$`)
    .replace(/<sub>([^<]+)<\/sub>/gi, (_, sub) => `$_{${sub.trim()}}$`);

  // We convert some HTML to a pseudo-text that keeps <img> tags
  // Replace <p>, <br>, <li>, <tr> with newline to help our regex-based splitting
  const pseudoText = htmlWithMathSupSub
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<(?!\/?img\b)[^>]*>/g, '') // Loại bỏ tất cả các thẻ HTML ngoại trừ <img>
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Split by "Câu [số]:" or "Câu [số]." (at start of line or after newline)
  const questionBlocks = pseudoText
    .split(/(?:^|\n)\s*Câu\s*\d+\s*[:.]/i)
    .filter(block => block.trim().length > 0);
  
  const parsedQuestions: ParsedQuestion[] = [];

  for (const block of questionBlocks) {
    const trimmedBlock = block.trim();

    // Bảo vệ thẻ <img>: Tạm thời thay thế các thẻ img bằng placeholder để tránh bị regex cắt nhầm bên trong chuỗi base64
    const images: string[] = [];
    const textWithPlaceholders = trimmedBlock.replace(/<img\b[^>]*\/?>/gi, (match) => {
      images.push(match);
      return `###IMG_PLACEHOLDER_${images.length - 1}###`;
    });

    const restoreImages = (txt: string) => {
      return txt.replace(/###IMG_PLACEHOLDER_(\d+)###/g, (_, index) => images[parseInt(index)] || '');
    };

    // Tách phần "Đáp án: X" hoặc "Lời giải" ở cuối câu hỏi (nếu có)
    let explicitAnswerIdx = -1;
    const footerMatch = textWithPlaceholders.match(/(?:^|\n|\s)(?:Đáp án|Chọn đáp án|Đ\/a)\s*[:.]?\s*([A-D])\b/i);
    if (footerMatch) {
      explicitAnswerIdx = footerMatch[1].toUpperCase().charCodeAt(0) - 65;
    }

    // Cắt bỏ phần Đáp án / Lời giải phía cuối để không lẫn vào nội dung đáp án D
    const cleanBody = textWithPlaceholders.replace(/(?:^|\n)\s*(?:Đáp án|Lời giải|Hướng dẫn giải)\s*[:.][\s\S]*$/i, '').trim();

    // Tìm vị trí cuối cùng của các mốc đáp án IN HOA: A., B., C., D. theo đúng thứ tự A -> B -> C -> D
    // Điều này tránh cắt nhầm "điểm A.", "đường thẳng d:", "tìm a, b." trong đề Toán
    const findLastOptionPos = (letter: string, searchEnd: number): { index: number; markerLen: number; hasStar: boolean } | null => {
      const sub = cleanBody.slice(0, searchEnd);
      const regex = new RegExp(`(?:^|[\\n\\r\\t ]+)(\\*?)${letter}\\s*[:.]`, 'g');
      let lastMatch: RegExpExecArray | null = null;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(sub)) !== null) {
        lastMatch = m;
      }
      if (!lastMatch) return null;
      // Compute exact start of option marker (excluding leading whitespace/newline)
      const fullMatch = lastMatch[0];
      const leadingWsMatch = fullMatch.match(/^[\n\r\t ]+/);
      const leadingWsLen = leadingWsMatch ? leadingWsMatch[0].length : 0;
      const markerStart = lastMatch.index + leadingWsLen;
      const markerLen = fullMatch.length - leadingWsLen;
      return {
        index: markerStart,
        markerLen,
        hasStar: lastMatch[1] === '*'
      };
    };

    const dPos = findLastOptionPos('D', cleanBody.length);
    const cPos = dPos ? findLastOptionPos('C', dPos.index) : null;
    const bPos = cPos ? findLastOptionPos('B', cPos.index) : null;
    const aPos = bPos ? findLastOptionPos('A', bPos.index) : null;

    if (!aPos || !bPos || !cPos || !dPos) {
      continue;
    }

    const content = cleanBody.slice(0, aPos.index).trim();
    const rawOptions = [
      { hasStar: aPos.hasStar, content: cleanBody.slice(aPos.index + aPos.markerLen, bPos.index).trim() },
      { hasStar: bPos.hasStar, content: cleanBody.slice(bPos.index + bPos.markerLen, cPos.index).trim() },
      { hasStar: cPos.hasStar, content: cleanBody.slice(cPos.index + cPos.markerLen, dPos.index).trim() },
      { hasStar: dPos.hasStar, content: cleanBody.slice(dPos.index + dPos.markerLen).trim() }
    ];

    let correctIdx = -1;
    const processedOptions = rawOptions.map((opt, i) => {
      if (opt.hasStar || opt.content.startsWith('*')) {
        correctIdx = i;
        return opt.content.startsWith('*') ? opt.content.substring(1).trim() : opt.content;
      }
      return opt.content;
    });

    if (correctIdx === -1 && explicitAnswerIdx !== -1) {
      correctIdx = explicitAnswerIdx;
    }

    if (correctIdx === -1 && content && processedOptions.every(o => o.length > 0)) {
      try {
        correctIdx = await solveQuestion(content, processedOptions);
      } catch (err) {
        console.error("AI Solve Error:", err);
        correctIdx = 0;
      }
    } else if (correctIdx === -1) {
      correctIdx = 0;
    }

    if (content && processedOptions.every(o => o.length > 0)) {
      parsedQuestions.push({
        content: restoreImages(content),
        options: [
          restoreImages(processedOptions[0]),
          restoreImages(processedOptions[1]),
          restoreImages(processedOptions[2]),
          restoreImages(processedOptions[3])
        ],
        correctAnswer: correctIdx,
        category
      });
    }
  }

  return parsedQuestions;
};

