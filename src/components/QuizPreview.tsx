import React from 'react';
import { motion } from 'motion/react';
import { Check, X, Save, Eye, Pencil, CheckCircle2, Trash2 } from 'lucide-react';
import MathText from './MathText';
import { ParsedQuestion } from '../utils/wordParser';

interface QuizPreviewProps {
  questions: ParsedQuestion[];
  onConfirm: () => void;
  onCancel: () => void;
  onUpdateQuestion: (index: number, updated: ParsedQuestion) => void;
  onDeleteQuestion?: (index: number) => void;
  loading?: boolean;
}

export default function QuizPreview({ questions, onConfirm, onCancel, onUpdateQuestion, onDeleteQuestion, loading }: QuizPreviewProps) {
  const [editStates, setEditStates] = React.useState<Record<number, 'none' | 'content' | 'options'>>({});
  const [confirmDeleteIdx, setConfirmDeleteIdx] = React.useState<number | null>(null);

  const toggleEdit = (idx: number) => {
    setEditStates(prev => {
      const current = prev[idx] || 'none';
      let next: 'none' | 'content' | 'options' = 'none';
      if (current === 'none') next = 'content';
      else if (current === 'content') next = 'options';
      else next = 'none';
      return { ...prev, [idx]: next };
    });
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 md:p-8">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-5xl max-h-[95vh] md:max-h-[90vh] rounded-[1.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="p-4 md:p-8 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between bg-slate-50/50 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Eye size={20} className="text-blue-600" />
              <h2 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight">Kiểm tra câu hỏi (Preview)</h2>
            </div>
            <p className="text-slate-400 font-medium text-[10px] md:text-sm text-center md:text-left">Bạn có thể click chọn đáp án đúng nếu nhận diện sai.</p>
          </div>
          <div className="flex gap-2 md:gap-3 w-full md:w-auto">
            <button 
              onClick={onCancel}
              className="flex-1 md:flex-none px-4 md:px-6 py-2 md:py-3 bg-white text-slate-500 font-bold rounded-lg md:rounded-xl border border-slate-200 hover:bg-slate-50 transition active:scale-95 text-[10px] md:text-sm uppercase tracking-widest"
            >
              Hủy bỏ
            </button>
            <button 
              onClick={onConfirm}
              disabled={loading || questions.length === 0}
              className="flex-1 md:flex-none px-6 md:px-8 py-2 md:py-3 bg-blue-600 text-white font-black rounded-lg md:rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 text-[10px] md:text-sm uppercase tracking-widest"
            >
              {loading ? 'ĐANG LƯU...' : <><Save size={18} /> Lưu</>}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 md:space-y-8 bg-[#f8fafc]">
          {questions.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl md:rounded-3xl border-2 border-dashed border-slate-200">
               <X size={48} className="mx-auto text-slate-200 mb-4" />
               <p className="text-slate-400 font-bold">Không bóc tách được câu hỏi nào.</p>
            </div>
          ) : (
            questions.map((q, idx) => {
              const state = editStates[idx] || 'none';
              
              return (
                <div key={idx} className={`bg-white p-5 md:p-8 rounded-2xl md:rounded-3xl border transition-all relative group overflow-hidden ${state !== 'none' ? 'border-blue-400 ring-4 ring-blue-50 shadow-xl' : 'border-slate-200 shadow-sm'}`}>
                  <div className="absolute top-0 right-0 p-4 md:p-6 opacity-[0.03] pointer-events-none text-6xl md:text-8xl font-black italic select-none">
                    {idx + 1}
                  </div>
                  
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3 md:mb-4">
                      <div className="flex items-center gap-3">
                        <span className="px-2 md:px-3 py-1 bg-blue-50 text-blue-600 text-[8px] md:text-[10px] font-black rounded-lg border border-blue-100 uppercase">{q.category}</span>
                        <span className="text-[8px] md:text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">Câu hỏi {idx + 1}</span>
                        {state !== 'none' && (
                          <span className="px-2 py-1 bg-orange-100 text-orange-600 text-[8px] md:text-[10px] font-black rounded-lg uppercase animate-pulse">
                            {state === 'content' ? 'Sửa nội dung' : 'Sửa đáp án'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {onDeleteQuestion && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                if (confirmDeleteIdx === idx) {
                                  onDeleteQuestion(idx);
                                  setConfirmDeleteIdx(null);
                                } else {
                                  setConfirmDeleteIdx(idx);
                                }
                              }}
                              className={`p-2 rounded-xl transition-all flex items-center gap-2 font-black ${
                                confirmDeleteIdx === idx
                                  ? 'bg-red-600 text-white shadow-lg shadow-red-200'
                                  : 'bg-red-50 text-red-500 hover:bg-red-100 hover:text-red-700'
                              }`}
                              title={confirmDeleteIdx === idx ? 'Xác nhận xóa câu hỏi này?' : 'Xóa câu hỏi này'}
                            >
                              <Trash2 size={18} />
                              <span className="text-[10px] font-bold uppercase hidden md:inline">
                                {confirmDeleteIdx === idx ? 'Xác nhận xóa?' : 'Xóa'}
                              </span>
                            </button>
                            {confirmDeleteIdx === idx && (
                              <button 
                                onClick={() => setConfirmDeleteIdx(null)}
                                className="px-2.5 py-1.5 text-slate-400 font-bold text-[10px] hover:bg-slate-100 rounded-lg transition"
                              >
                                Hủy
                              </button>
                            )}
                          </div>
                        )}
                        <button 
                          onClick={() => toggleEdit(idx)}
                          className={`p-2 rounded-xl transition-all flex items-center gap-2 ${state === 'none' ? 'bg-slate-50 text-slate-400 hover:bg-blue-50 hover:text-blue-600' : 'bg-blue-600 text-white shadow-lg shadow-blue-200'}`}
                          title={state === 'none' ? 'Sửa câu hỏi' : state === 'content' ? 'Chuyển sang sửa đáp án' : 'Xong'}
                        >
                          {state === 'none' ? <Pencil size={18} /> : state === 'content' ? <Pencil size={18} /> : <CheckCircle2 size={18} />}
                          <span className="text-[10px] font-bold uppercase hidden md:inline">
                            {state === 'none' ? 'Sửa' : state === 'content' ? 'Sửa Đ.Án' : 'Xong'}
                          </span>
                        </button>
                      </div>
                    </div>
                    
                    <div className="text-base md:text-xl font-semibold text-slate-800 mb-6 md:mb-8 leading-relaxed overflow-x-auto max-w-full">
                      {state === 'content' ? (
                        <textarea 
                          className="w-full p-4 bg-blue-50 border border-blue-200 rounded-2xl text-base md:text-lg font-medium outline-none h-32 focus:ring-2 focus:ring-blue-500 transition-all"
                          value={q.content}
                          onChange={(e) => onUpdateQuestion(idx, { ...q, content: e.target.value })}
                          placeholder="Nhập nội dung câu hỏi..."
                          autoFocus
                        />
                      ) : (
                        <MathText text={q.content} />
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                      {q.options.map((opt, oIdx) => (
                        <div key={oIdx} className="relative group/opt">
                          {state === 'options' ? (
                            <div className="flex items-center gap-2 bg-blue-50 p-2 rounded-xl border border-blue-100">
                               <div 
                                onClick={() => onUpdateQuestion(idx, { ...q, correctAnswer: oIdx })}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 cursor-pointer transition-all ${q.correctAnswer === oIdx ? 'bg-green-500 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200 shadow-inner'}`}>
                                  {String.fromCharCode(65 + oIdx)}
                                </div>
                                <input 
                                  className="flex-1 bg-transparent border-none outline-none text-sm md:text-base font-medium py-2 px-1 focus:ring-0"
                                  value={opt}
                                  onChange={(e) => {
                                    const nextOptions = [...q.options];
                                    nextOptions[oIdx] = e.target.value;
                                    onUpdateQuestion(idx, { ...q, options: nextOptions });
                                  }}
                                  placeholder={`Đáp án ${String.fromCharCode(65 + oIdx)}...`}
                                />
                            </div>
                          ) : (
                            <button 
                              onClick={() => {
                                if (state === 'none') {
                                  onUpdateQuestion(idx, { ...q, correctAnswer: oIdx });
                                }
                              }}
                              className={`w-full p-3 md:p-4 rounded-xl border flex items-start gap-3 md:gap-4 text-left transition-all ${state === 'none' ? 'hover:border-blue-200 cursor-pointer' : 'cursor-default'} ${q.correctAnswer === oIdx ? 'bg-green-50 border-green-200 text-green-900 shadow-sm' : 'bg-slate-50 border-slate-100/50 text-slate-600'}`}
                            >
                              <div className={`w-6 h-6 md:w-8 md:h-8 rounded-lg flex items-center justify-center font-bold text-[10px] md:text-xs shrink-0 ${q.correctAnswer === oIdx ? 'bg-green-500 text-white shadow-md shadow-green-200' : 'bg-white text-slate-400 border border-slate-200'}`}>
                                {String.fromCharCode(65 + oIdx)}
                              </div>
                              <div className="mt-0.5 md:mt-1 font-medium text-sm md:text-base flex-1 overflow-x-auto max-w-full min-w-0"><MathText text={opt} /></div>
                              {q.correctAnswer === oIdx && <Check size={16} className="ml-auto text-green-500 shrink-0 self-center" />}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-6 bg-white border-t border-slate-100 flex justify-center items-center text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">
          Tổng cộng: {questions.length} câu hỏi được sẵn sàng
        </div>
      </motion.div>
    </div>
  );
}
