import mammoth from 'mammoth';
import { solveQuestion } from '../services/geminiService';

export interface ParsedQuestion {
  id?: string;
  content: string;
  options: string[];
  correctAnswer: number;
  category: string;
}

export const parseWordToQuiz = async (file: File, category: string): Promise<ParsedQuestion[]> => {
  const arrayBuffer = await file.arrayBuffer();
  
  // mammoth.convertToHtml enables image extraction (converted to base64 by default)
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value;

  // We convert some HTML to a pseudo-text that keeps <img> tags
  // Replace <p> with newline to help our regex-based splitting
  const pseudoText = html
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '\n')
    .replace(/<(?!\/?img\b)[^>]*>/g, '') // Loại bỏ tất cả các thẻ HTML ngoại trừ <img>
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Split by "Câu [số]:" or "Câu [số]."
  const questionBlocks = pseudoText.split(/Câu\s*\d+\s*[:.]/i).filter(block => block.trim().length > 0);
  
  const parsedQuestions: ParsedQuestion[] = [];

  for (const block of questionBlocks) {
    const trimmedBlock = block.trim();

    // Bảo vệ thẻ <img>: Tạm thời thay thế các thẻ img bằng placeholder để tránh bị regex cắt nhầm bên trong chuỗi base64
    const images: string[] = [];
    let textWithPlaceholders = trimmedBlock.replace(/<img\b[^>]*\/?>/gi, (match) => {
      images.push(match);
      return `###IMG_PLACEHOLDER_${images.length - 1}###`;
    });

    const restoreImages = (txt: string) => {
      return txt.replace(/###IMG_PLACEHOLDER_(\d+)###/g, (_, index) => images[parseInt(index)]);
    };
    
    // Regex to find options A, B, C, D (Sử dụng văn bản đã được bảo vệ)
    // Hỗ trợ dấu * nằm trước chữ cái (ví dụ: *A. Nội dung) hoặc sau chữ cái (ví dụ: A. *Nội dung)
    const aMatch = textWithPlaceholders.match(/(\*?)A\s*[:.]([\s\S]*?)(?=\*?B\s*[:.]|$)/i);
    const bMatch = textWithPlaceholders.match(/(\*?)B\s*[:.]([\s\S]*?)(?=\*?C\s*[:.]|$)/i);
    const cMatch = textWithPlaceholders.match(/(\*?)C\s*[:.]([\s\S]*?)(?=\*?D\s*[:.]|$)/i);
    const dMatch = textWithPlaceholders.match(/(\*?)D\s*[:.]([\s\S]*?)(?=Đáp án|Lời giải|$)/i);

    // Question content is everything before the first option
    const contentParts = textWithPlaceholders.split(/\*?[A-D]\s*[:.]/i);
    const content = contentParts[0].trim();

    // 1. Check for asterisk marker in options 
    let correctIdx = -1;
    const rawOptions = [
      aMatch ? { prefix: aMatch[1], content: aMatch[2].trim() } : null,
      bMatch ? { prefix: bMatch[1], content: bMatch[2].trim() } : null,
      cMatch ? { prefix: cMatch[1], content: cMatch[2].trim() } : null,
      dMatch ? { prefix: dMatch[1], content: dMatch[2].trim() } : null
    ];

    const processedOptions = rawOptions.map((opt, i) => {
      if (!opt) return '';
      // Kiểm tra dấu * ở đầu chữ cái (*A.) hoặc đầu nội dung (A. *Nội dung)
      if (opt.prefix === '*' || opt.content.startsWith('*')) {
        correctIdx = i;
        return opt.content.startsWith('*') ? opt.content.substring(1).trim() : opt.content;
      }
      return opt.content;
    });

    // 2. If no asterisk, check for "Đáp án: [A-D]"
    if (correctIdx === -1) {
      const ansMatch = textWithPlaceholders.match(/Đáp án\s*[:.]\s*([A-D])/i);
      if (ansMatch) {
        correctIdx = ansMatch[1].toUpperCase().charCodeAt(0) - 65;
      }
    }

    // 3. Fallback to AI if still no answer
    if (correctIdx === -1 && content && processedOptions.every(o => o.length > 0)) {
      try {
        correctIdx = await solveQuestion(content, processedOptions);
      } catch (err) {
        console.error("AI Solve Error:", err);
        correctIdx = 0; // Default fallback
      }
    } else if (correctIdx === -1) {
      correctIdx = 0; // Final default
    }

    if (content && aMatch && bMatch && cMatch && dMatch) {
      parsedQuestions.push({
        content: restoreImages(content),
        options: [
          restoreImages(processedOptions[0]),
          restoreImages(processedOptions[1]),
          restoreImages(processedOptions[2]),
          restoreImages(processedOptions[3])
        ],
        correctAnswer: correctIdx,
        category: category
      });
    }
  }

  return parsedQuestions;
};
