import React, { useState } from 'react';
import MathText from './MathText';
import { Calculator, ChevronDown, ChevronUp, Sparkles, Plus } from 'lucide-react';

export interface MathSnippet {
  label: string;
  latex: string;
  preview: string;
  desc: string;
}

export interface MathCategory {
  id: string;
  name: string;
  items: MathSnippet[];
}

export const MATH_CATEGORIES: MathCategory[] = [
  {
    id: 'algebra',
    name: 'Đại số & Căn thức',
    items: [
      { label: 'Phân số', latex: '$\\frac{a}{b}$', preview: '$\\frac{a}{b}$', desc: 'Phân số cơ bản' },
      { label: 'Hỗn số / Phân thức', latex: '$\\frac{x + 1}{x - 2}$', preview: '$\\frac{x+1}{x-2}$', desc: 'Phân thức đại số' },
      { label: 'Căn bậc 2', latex: '$\\sqrt{x}$', preview: '$\\sqrt{x}$', desc: 'Căn bậc hai' },
      { label: 'Căn phân thức', latex: '$\\sqrt{\\frac{a}{b}}$', preview: '$\\sqrt{\\frac{a}{b}}$', desc: 'Căn của phân số' },
      { label: 'Căn bậc 3', latex: '$\\sqrt[3]{x}$', preview: '$\\sqrt[3]{x}$', desc: 'Căn bậc ba' },
      { label: 'Căn bậc n', latex: '$\\sqrt[n]{A}$', preview: '$\\sqrt[n]{A}$', desc: 'Căn bậc n tổng quát' },
      { label: 'Hằng đẳng thức căn', latex: '$\\sqrt{A^2} = |A|$', preview: '$\\sqrt{A^2}=|A|$', desc: 'Căn bậc hai của bình phương' },
      { label: 'Căn lồng căn', latex: '$\\sqrt{a + 2\\sqrt{b}}$', preview: '$\\sqrt{a+2\\sqrt{b}}$', desc: 'Căn thức lồng nhau' },
      { label: 'Lũy thừa', latex: '$x^2$', preview: '$x^2$', desc: 'Số mũ / Bình phương' },
      { label: 'Chỉ số dưới', latex: '$x_1, x_2$', preview: '$x_1, x_2$', desc: 'Chỉ số nghiệm' },
      { label: 'Trị tuyệt đối', latex: '$|x - a|$', preview: '$|x-a|$', desc: 'Giá trị tuyệt đối' },
      { label: 'Biểu thức P', latex: '$P = \\left(\\frac{1}{\\sqrt{x}-1} + \\frac{1}{\\sqrt{x}+1}\\right) : \\frac{\\sqrt{x}}{x-1}$', preview: '$P = (\\dots)$', desc: 'Mẫu bài toán rút gọn' },
    ]
  },
  {
    id: 'equations',
    name: 'Phương trình & Hệ PT',
    items: [
      { label: 'Hệ 2 phương trình', latex: '$\\begin{cases} ax + by = c \\\\ a\'x + b\'y = c\' \\end{cases}$', preview: '$\\begin{cases} x+y=2 \\\\ x-y=0 \\end{cases}$', desc: 'Hệ hai phương trình bậc nhất 2 ẩn' },
      { label: 'Hệ PT phân thức', latex: '$\\begin{cases} \\frac{1}{x} + \\frac{1}{y} = \\frac{1}{2} \\\\ \\frac{3}{x} - \\frac{2}{y} = 1 \\end{cases}$', preview: '$\\begin{cases} \\frac{1}{x}+\\frac{1}{y}=a \\\\ \\dots \\end{cases}$', desc: 'Hệ phương trình chứa ẩn ở mẫu' },
      { label: 'Hệ 3 điều kiện', latex: '$\\begin{cases} x \\ge 0 \\\\ x \\neq 1 \\\\ x \\neq 4 \\end{cases}$', preview: '$\\begin{cases} x \\ge 0 \\\\ x \\neq 1 \\end{cases}$', desc: 'Hệ điều kiện xác định (ĐKXĐ)' },
      { label: 'Hoặc (Ngoặc vuông)', latex: '$\\left[ \\begin{aligned} x &= a \\\\ x &= b \\end{aligned} \\right.$', preview: '$\\left[\\begin{aligned} x&=a \\\\ x&=b \\end{aligned}\\right.$', desc: 'Ký hiệu Hoặc các trường hợp nghiệm' },
      { label: 'PT bậc hai', latex: '$ax^2 + bx + c = 0 \\ (a \\neq 0)$', preview: '$ax^2+bx+c=0$', desc: 'Phương trình bậc hai một ẩn' },
      { label: 'Biệt thức Delta', latex: '$\\Delta = b^2 - 4ac$', preview: '$\\Delta = b^2-4ac$', desc: 'Công thức tính Delta' },
      { label: 'Biệt thức Delta\'', latex: '$\\Delta\' = b\'^2 - ac$', preview: '$\\Delta\' = b\'^2-ac$', desc: 'Công thức tính Delta phẩy' },
      { label: 'Hệ thức Vi-ét', latex: '$\\begin{cases} S = x_1 + x_2 = -\\frac{b}{a} \\\\ P = x_1 x_2 = \\frac{c}{a} \\end{cases}$', preview: '$\\begin{cases} x_1+x_2=-\\frac{b}{a} \\\\ x_1x_2=\\frac{c}{a} \\end{cases}$', desc: 'Định lý Vi-ét' },
      { label: 'Tổng bình phương nghiệm', latex: '$x_1^2 + x_2^2 = (x_1 + x_2)^2 - 2x_1x_2$', preview: '$x_1^2+x_2^2=(S)^2-2P$', desc: 'Biến đổi đối xứng Vi-ét' },
      { label: 'Công thức nghiệm', latex: '$x_{1,2} = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}$', preview: '$\\frac{-b \\pm \\sqrt{\\Delta}}{2a}$', desc: 'Nghiệm phương trình bậc 2' },
      { label: 'Parabol & Đường thẳng', latex: '$(P): y = ax^2$ và $(d): y = mx + n$', preview: '$(P): y=ax^2$', desc: 'Tương giao Parabol và đường thẳng' },
      { label: 'Bất phương trình', latex: '$ax + b \\le 0 \\Leftrightarrow x \\le -\\frac{b}{a}$', preview: '$ax+b \\le 0$', desc: 'Bất phương trình bậc nhất' },
    ]
  },
  {
    id: 'geometry',
    name: 'Hình học & Lượng giác',
    items: [
      { label: 'Góc (3 đỉnh)', latex: '$\\widehat{ABC} = 90^\\circ$', preview: '$\\widehat{ABC}=90^\\circ$', desc: 'Ký hiệu góc có dấu mũ rộng' },
      { label: 'Cung tròn', latex: '$\\overset{\\frown}{AB}$', preview: '$\\overset{\\frown}{AB}$', desc: 'Ký hiệu cung tròn AB' },
      { label: 'Số đo cung', latex: '$\\text{sđ}\\overset{\\frown}{AB} = 60^\\circ$', preview: '$\\text{sđ}\\overset{\\frown}{AB}$', desc: 'Số đo cung tròn' },
      { label: 'Tam giác đồng dạng', latex: '$\\triangle ABC \\sim \\triangle DEF$', preview: '$\\triangle ABC \\sim \\triangle DEF$', desc: 'Hai tam giác đồng dạng' },
      { label: 'Tam giác bằng nhau', latex: '$\\triangle ABC = \\triangle A\'B\'C\'$', preview: '$\\triangle ABC = \\triangle A\'B\'C\'$', desc: 'Hai tam giác bằng nhau' },
      { label: 'Đường tròn (O; R)', latex: '$(O; R)$', preview: '$(O; R)$', desc: 'Đường tròn tâm O bán kính R' },
      { label: 'Vuông góc & Song song', latex: '$AB \\perp CD$ và $EF \\parallel GH$', preview: '$\\perp, \\parallel$', desc: 'Quan hệ vuông góc, song song' },
      { label: 'Vectơ / Đoạn thẳng', latex: '$\\overrightarrow{AB}, \\overline{AB}$', preview: '$\\overrightarrow{AB}, \\overline{AB}$', desc: 'Vectơ và độ dài đại số' },
      { label: 'Tỉ số lượng giác', latex: '$\\sin\\alpha = \\frac{a}{c}, \\cos\\alpha = \\frac{b}{c}, \\tan\\alpha = \\frac{a}{b}, \\cot\\alpha = \\frac{b}{a}$', preview: '$\\sin\\alpha, \\cos\\alpha, \\tan\\alpha$', desc: 'Sin, Cos, Tan, Cot' },
      { label: 'Hệ thức lượng', latex: '$\\frac{1}{AH^2} = \\frac{1}{AB^2} + \\frac{1}{AC^2}$', preview: '$\\frac{1}{h^2}=\\frac{1}{b^2}+\\frac{1}{c^2}$', desc: 'Hệ thức lượng trong tam giác vuông' },
      { label: 'Diện tích hình quạt', latex: '$S_q = \\frac{\\pi R^2 n}{360}$', preview: '$\\frac{\\pi R^2 n}{360}$', desc: 'Diện tích hình quạt tròn n độ' },
      { label: 'Thể tích Trụ - Nón - Cầu', latex: '$V_{\\text{trụ}} = \\pi R^2 h, \\ V_{\\text{nón}} = \\frac{1}{3}\\pi R^2 h, \\ V_{\\text{cầu}} = \\frac{4}{3}\\pi R^3$', preview: '$\\pi R^2h, \\frac{4}{3}\\pi R^3$', desc: 'Công thức Hình học không gian lớp 9' },
    ]
  },
  {
    id: 'stats_symbols',
    name: 'Xác suất & Ký hiệu',
    items: [
      { label: 'Xác suất biến cố', latex: '$P(A) = \\frac{n(A)}{n(\\Omega)}$', preview: '$P(A)=\\frac{n(A)}{n(\\Omega)}$', desc: 'Công thức xác suất cổ điển' },
      { label: 'Không gian mẫu', latex: '$\\Omega = \\{1; 2; 3; 4; 5; 6\\}$', preview: '$\\Omega = \\{\\dots\\}$', desc: 'Tập hợp không gian mẫu Omega' },
      { label: 'Tần số tương đối', latex: '$f_i = \\frac{m_i}{N} \\cdot 100\\%$', preview: '$f_i = \\frac{m_i}{N}\\cdot 100\\%$', desc: 'Công thức tần số tương đối' },
      { label: 'Trung bình cộng', latex: '$\\bar{x} = \\frac{x_1 n_1 + x_2 n_2 + \\dots + x_k n_k}{N}$', preview: '$\\bar{x} = \\frac{\\sum x_i n_i}{N}$', desc: 'Số trung bình cộng thống kê' },
      { label: 'Tương đương / Suy ra', latex: '$\\Leftrightarrow$ , $\\Rightarrow$', preview: '$\\Leftrightarrow, \\Rightarrow$', desc: 'Dấu tương đương và suy ra' },
      { label: 'Bất đẳng thức', latex: '$\\le$ , $\\ge$ , $\\neq$ , $\\approx$', preview: '$\\le, \\ge, \\neq, \\approx$', desc: 'Nhỏ hơn hoặc bằng, lớn hơn hoặc bằng, khác, xấp xỉ' },
      { label: 'Cộng trừ / Nhân chia', latex: '$\\pm$ , $\\cdot$ , $\\times$ , $\\div$', preview: '$\\pm, \\cdot, \\times, \\div$', desc: 'Các phép toán cơ bản' },
      { label: 'Tập hợp số', latex: '$x \\in \\mathbb{R}, n \\in \\mathbb{Z}, k \\in \\mathbb{N}^*$', preview: '$\\in \\mathbb{R}, \\mathbb{Z}, \\mathbb{N}^*$', desc: 'Thuộc tập số thực, nguyên, tự nhiên' },
      { label: 'Tập rỗng / Vô cực', latex: '$\\varnothing, \\ +\\infty, \\ -\\infty$', preview: '$\\varnothing, \\pm\\infty$', desc: 'Tập hợp rỗng và vô cực' },
      { label: 'Độ C / Độ góc', latex: '$^\\circ\\text{C}$ , $90^\\circ$', preview: '$90^\\circ, ^\\circ\\text{C}$', desc: 'Ký hiệu độ góc và độ nhiệt độ' },
      { label: 'Pi & Hằng số', latex: '$\\pi \\approx 3,14$', preview: '$\\pi \\approx 3,14$', desc: 'Số Pi' },
      { label: 'Ma trận / Bảng 2x2', latex: '$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$', preview: '$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$', desc: 'Ma trận hoặc cặp số' },
    ]
  }
];

interface MathEquationToolbarProps {
  onInsert: (latex: string, targetField?: 'content' | number) => void;
  activeTarget?: 'content' | number;
  onTargetChange?: (target: 'content' | number) => void;
  showTargetSelector?: boolean;
  compact?: boolean;
}

const MathEquationToolbar: React.FC<MathEquationToolbarProps> = ({
  onInsert,
  activeTarget = 'content',
  onTargetChange,
  showTargetSelector = true,
  compact = false
}) => {
  const [isOpen, setIsOpen] = useState(!compact);
  const [activeCategory, setActiveCategory] = useState<string>('algebra');
  const [customLatex, setCustomLatex] = useState<string>('\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
  const [showCustomBuilder, setShowCustomBuilder] = useState(false);

  const currentCategory = MATH_CATEGORIES.find(c => c.id === activeCategory) || MATH_CATEGORIES[0];

  const handleInsertCustom = () => {
    if (!customLatex.trim()) return;
    const formatted = customLatex.trim().startsWith('$')
      ? customLatex.trim()
      : `$${customLatex.trim()}$`;
    onInsert(formatted, activeTarget);
  };

  return (
    <div className="bg-slate-50 border border-indigo-100 rounded-xl overflow-hidden shadow-xs mb-3">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gradient-to-r from-indigo-50/80 via-blue-50/60 to-slate-50 border-b border-indigo-100/80">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 text-xs font-black text-indigo-700 hover:text-indigo-900 transition-colors cursor-pointer"
          >
            <Calculator size={15} className="text-indigo-600" />
            <span>BỘ CÔNG THỨC TOÁN & EQUATION LỚP 9 - 10</span>
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className="hidden sm:inline-block text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
            Hỗ trợ LaTeX & Word Equation
          </span>
        </div>

        {/* Target Field Selector */}
        {showTargetSelector && onTargetChange && (
          <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200 text-[10px]">
            <span className="text-slate-400 font-bold mr-1">Chèn vào:</span>
            <button
              type="button"
              onClick={() => onTargetChange('content')}
              className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                activeTarget === 'content'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Câu hỏi
            </button>
            {[0, 1, 2, 3].map((idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onTargetChange(idx)}
                className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                  (activeTarget as 'content' | number) === idx
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Đ.Án {String.fromCharCode(65 + idx)}
              </button>
            ))}
          </div>
        )}
      </div>

      {isOpen && (
        <div className="p-3 space-y-3">
          {/* Category Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap gap-1">
              {MATH_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setShowCustomBuilder(false);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    activeCategory === cat.id && !showCustomBuilder
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowCustomBuilder(!showCustomBuilder)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                showCustomBuilder
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <Sparkles size={13} />
              <span>Tạo Equation Tùy Chỉnh</span>
            </button>
          </div>

          {/* Custom Equation Builder */}
          {showCustomBuilder ? (
            <div className="bg-white p-3 rounded-xl border border-amber-200 space-y-2.5">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                    Nhập mã LaTeX / Equation (không cần dấu $):
                  </label>
                  <input
                    type="text"
                    value={customLatex}
                    onChange={(e) => setCustomLatex(e.target.value)}
                    placeholder="VD: \frac{\sqrt{x} + 1}{\sqrt{x} - 2} hoặc \begin{cases} 2x + y = 5 \\ x - y = 1 \end{cases}"
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleInsertCustom}
                    className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <Plus size={15} />
                    <span>Chèn Equation</span>
                  </button>
                </div>
              </div>

              {/* Live Rendered Preview */}
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 flex items-center justify-between gap-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase shrink-0">
                  Xem trước:
                </div>
                <div className="flex-1 text-center text-sm text-slate-800 overflow-x-auto py-1">
                  {customLatex.trim() ? (
                    <MathText
                      content={
                        customLatex.trim().startsWith('$')
                          ? customLatex.trim()
                          : `$${customLatex.trim()}$`
                      }
                    />
                  ) : (
                    <span className="text-xs text-slate-400 italic">Nhập công thức để xem trước...</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Snippets Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
              {currentCategory.items.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onInsert(item.latex, activeTarget)}
                  title={`${item.desc} (${item.latex})`}
                  className="group flex flex-col items-center justify-between p-2 bg-white hover:bg-indigo-50/70 border border-slate-200/90 hover:border-indigo-400 rounded-lg transition-all text-center cursor-pointer shadow-2xs hover:shadow-xs"
                >
                  <div className="w-full min-h-[28px] flex items-center justify-center text-slate-800 group-hover:text-indigo-950 text-xs overflow-hidden">
                    <MathText content={item.preview} />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500 group-hover:text-indigo-600 mt-1 line-clamp-1">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MathEquationToolbar;
