import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function solveQuestion(content: string, options: string[]): Promise<number> {
  try {
    const prompt = `Bạn là một giáo viên Toán chuyên nghiệp. Hãy giải câu hỏi trắc nghiệm sau và chọn đáp án đúng nhất (0 cho A, 1 cho B, 2 cho C, 3 cho D).
    
Câu hỏi: ${content}
A. ${options[0]}
B. ${options[1]}
C. ${options[2]}
D. ${options[3]}

Chỉ trả về kết quả dưới dạng JSON với định dạng: {"correctIndex": number}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            correctIndex: {
              type: Type.INTEGER,
              description: "Chỉ số của đáp án đúng (0-3)"
            }
          },
          required: ["correctIndex"]
        }
      }
    });

    const result = JSON.parse(response.text || '{"correctIndex": 0}');
    return typeof result.correctIndex === 'number' ? result.correctIndex : 0;
  } catch (error) {
    console.error("Gemini Error:", error);
    return 0;
  }
}
