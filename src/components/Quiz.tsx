import React, { useState, useEffect } from 'react';
import { db, Question, QuizResult, handleFirestoreError, OperationType, PART_CHAPTERS } from '../lib/firebase';
import { collection, addDoc, getDocs, Timestamp, serverTimestamp, doc, getDoc, query, where, documentId, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ChevronRight, ChevronLeft, Send, User, Trophy, BookOpen, Award, Bookmark, ArrowRight, School, GraduationCap } from 'lucide-react';
import MathText from './MathText';

export default function Quiz({ 
  onBack, 
  isQuickPractice = false,
  quickPracticeChapter = 'all'
}: { 
  onBack?: () => void; 
  isQuickPractice?: boolean;
  quickPracticeChapter?: string;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentStep, setCurrentStep] = useState<'info' | 'select_chapter' | 'doing' | 'result' | 'review'>('info');
  const [studentInfo, setStudentInfo] = useState({ name: '', class: '', school: '' });
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedPart, setSelectedPart] = useState<string>('');
  const [selectedChapDropdown, setSelectedChapDropdown] = useState<string>('');

  const fetchAndRandomize = async (chap?: string, isPractice = false) => {
    setLoadingQuestions(true);
    try {
      // Clear previous cached session questions
      sessionStorage.removeItem('quiz_current_questions_session');

      const shuffle = (array: any[]) => {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };

      let finalQuestions: Question[] = [];

      // 1. Cố gắng lấy danh mục câu hỏi (ID, chương, phân môn) từ metadata để tiết kiệm lượt đọc
      let allQsMetaData: { id: string; chapter: string; category: string }[] = [];
      const CACHE_KEY = 'quiz_metadata_ids';
      let lists: any = null;
      
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const { data } = JSON.parse(cached);
          lists = data;
        } catch (e) {
          localStorage.removeItem(CACHE_KEY);
        }
      }

      if (!lists) {
        try {
          const metaDoc = await getDoc(doc(db, 'metadata', 'questions'));
          if (metaDoc.exists()) {
            lists = metaDoc.data();
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data: lists, timestamp: Date.now() }));
          }
        } catch (e) {
          handleFirestoreError(e, OperationType.GET, 'metadata/questions');
        }
      }

      if (lists && lists.allQuestions && lists.allQuestions.length > 0) {
        allQsMetaData = lists.allQuestions;
      }

      if (isPractice) {
        // Mode Quick Practice: Lấy ngẫu nhiên đúng 10 câu hỏi từ metadata
        let selectedIds: string[] = [];
        if (allQsMetaData.length > 0) {
          const filteredMeta = chap && chap !== 'all'
            ? allQsMetaData.filter(q => q.chapter?.trim() === chap.trim())
            : allQsMetaData;
          
          selectedIds = shuffle(filteredMeta.map(q => q.id)).slice(0, 10);
        }

        let practiceQs: Question[] = [];
        if (selectedIds.length > 0) {
          // Lấy đúng 10 câu hỏi chi tiết qua một câu truy vấn duy nhất hoặc chia chunks vì 'in' tối đa 10 phần tử
          const chunks = [];
          for(let i = 0; i < selectedIds.length; i += 10) {
              chunks.push(selectedIds.slice(i, i + 10));
          }
          for (const chunk of chunks) {
             if(chunk.length === 0) continue;
             const q = query(collection(db, 'questions'), where(documentId(), 'in', chunk));
             try {
               const snapshot = await getDocs(q);
               practiceQs = practiceQs.concat(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Question)));
             } catch (e) {
               handleFirestoreError(e, OperationType.GET, 'questions');
             }
          }
        }

        // Fallback: Nếu không có metadata/cache, tải trực tiếp bằng query theo chương (nếu chap specified) hoặc limit 40 chọn 10 câu
        if (practiceQs.length === 0) {
          console.log("Fallback: Tải ngẫu nhiên 10 câu từ questions...");
          try {
            let snapshot;
            if (chap && chap !== 'all') {
              snapshot = await getDocs(query(collection(db, 'questions'), where('chapter', '==', chap), limit(40)));
            } else {
              snapshot = await getDocs(query(collection(db, 'questions'), limit(40)));
            }
            const allFetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Question));
            practiceQs = shuffle(allFetched).slice(0, 10);
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, 'questions');
          }
        }

        if (practiceQs.length === 0) {
          alert('Chương học được chọn hoặc Ngân hàng đề hiện chưa có câu hỏi để luyện tập.');
          setLoadingQuestions(false);
          return false;
        }

        finalQuestions = shuffle(practiceQs);
      } else if (chap) {
        // Mode A: selective review by chapter - Cực kỳ tối ưu nhờ metadata quét đúng ID
        console.log(`Getting optimized questions for chapter: ${chap}`);
        let selectedIds: string[] = [];

        if (allQsMetaData.length > 0) {
          // Lọc các ID câu hỏi thuộc chương được chọn
          const chapQsMeta = allQsMetaData.filter(q => q.chapter?.trim() === chap.trim());
          if (chapQsMeta.length > 0) {
            selectedIds = shuffle(chapQsMeta.map(q => q.id)).slice(0, 16);
          }
        }

        let chapQsDetail: Question[] = [];

        // Nếu tìm được IDs chi tiết từ Metadata, ta chỉ tải đúng tối đa 16 câu hỏi đó
        if (selectedIds.length > 0) {
          const chunks = [];
          for(let i = 0; i < selectedIds.length; i += 10) {
              chunks.push(selectedIds.slice(i, i + 10));
          }
          
          for (const chunk of chunks) {
             if(chunk.length === 0) continue;
             const q = query(collection(db, 'questions'), where(documentId(), 'in', chunk));
             try {
               const snapshot = await getDocs(q);
               chapQsDetail = chapQsDetail.concat(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Question)));
             } catch (e) {
               handleFirestoreError(e, OperationType.GET, 'questions');
             }
          }
        }

        // Fallback an toàn: nếu metadata trống hoặc không tìm thấy câu hỏi tương ứng, tải trực tiếp bằng query 'where' theo chương
        if (chapQsDetail.length === 0) {
          console.log("Fallback: Querying chapter directly...");
          const qChap = query(collection(db, 'questions'), where('chapter', '==', chap));
          try {
            const chapSnapshot = await getDocs(qChap);
            chapQsDetail = chapSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, 'questions');
          }
        }
        
        if (chapQsDetail.length === 0) {
          alert(`Chương này hiện chưa có câu hỏi trong ngân hàng đề. Vui lòng chọn chương khác.`);
          setLoadingQuestions(false);
          return false;
        }

        // Trộn ngẫu nhiên câu hỏi của chương
        finalQuestions = shuffle(chapQsDetail).slice(0, 16);
      } else {
        // Mode B: standard mock exam phân bổ đúng tỷ lệ theo chương học (Tổng cộng 16 câu)
        const chapterQuotas: Record<string, number> = {
          'Chương I. PHƯƠNG TRÌNH VÀ HỆ HAI PHƯƠNG TRÌNH BẬC NHẤT HAI ẨN': 2,
          'Chương II. PHƯƠNG TRÌNH VÀ BẤT PHƯƠNG TRÌNH BẬC NHẤT MỘT ẨN': 2,
          'Chương III. CĂN BẬC HAI VÀ CĂN BẬC BA': 2,
          'Chương VI. HÀM SỐ $y = ax^2$ ($a \\neq 0$). PHƯƠNG TRÌNH BẬC HAI MỘT ẨN': 2,
          'Chương IV. HỆ THỨC LƯỢNG TRONG TAM GIÁC VUÔNG': 1,
          'Chương X. MỘT SỐ HÌNH KHỐI TRONG THỰC TIỄN': 1,
          'Chương V. ĐƯỜNG TRÒN': 2,
          'Chương IX. ĐƯỜNG TRÒN NGOẠI TIẾP VÀ ĐƯỜNG TRÒN NỘI TIẾP': 2,
          'Chương VII. TẦN SỐ VÀ TẦN SỐ TƯƠNG ĐỐI': 1,
          'Chương VIII. XÁC SUẤT CỦA BIẾN CỐ TRONG MỘT SỐ MÔ HÌNH XÁC SUẤT ĐƠN GIẢN': 1
        };

        const getNormalizedKey = (chName: string): string | null => {
          if (!chName) return null;
          const clean = chName.trim().toUpperCase()
            .replace(/\s+/g, ' ')
            .replace(/\$/g, '')
            .replace(/\\NEQ/g, '≠')
            .replace(/\\NOT=/g, '≠')
            .replace(/≠/g, '!=');
          
          for (const key of Object.keys(chapterQuotas)) {
            const keyClean = key.trim().toUpperCase()
              .replace(/\s+/g, ' ')
              .replace(/\$/g, '')
              .replace(/\\NEQ/g, '≠')
              .replace(/\\NOT=/g, '≠')
              .replace(/≠/g, '!=');
            if (clean === keyClean) {
              return key;
            }
          }
          return null;
        };

        let selectedIds: string[] = [];
        
        if (allQsMetaData.length > 0) {
          // Gom các câu hỏi theo chương tương ứng dựa trên dữ liệu metadata gọn nhẹ
          const questionsByChapter: Record<string, { id: string; chapter: string; category: string }[]> = {};
          allQsMetaData.forEach(q => {
            const chName = q.chapter ? q.chapter.trim() : '';
            if (chName) {
              const matchedKey = getNormalizedKey(chName);
              if (matchedKey) {
                if (!questionsByChapter[matchedKey]) {
                  questionsByChapter[matchedKey] = [];
                }
                questionsByChapter[matchedKey].push(q);
              }
            }
          });

          const usedIds = new Set<string>();

          // Chọn theo đúng quota của từng chương
          Object.keys(chapterQuotas).forEach(ch => {
            const quota = chapterQuotas[ch];
            const chQs = shuffle(questionsByChapter[ch] || []);
            const chosen = chQs.slice(0, quota);
            chosen.forEach(q => {
              if (q.id) {
                selectedIds.push(q.id);
                usedIds.add(q.id);
              }
            });
          });

          // Nếu tổng lượng câu hỏi chưa đủ 16, bù thêm bằng các ID còn lại
          if (selectedIds.length < 16) {
            const remainingQs = allQsMetaData.filter(q => q.id && !usedIds.has(q.id));
            const fillQs = shuffle(remainingQs).slice(0, 16 - selectedIds.length);
            fillQs.forEach(q => {
              selectedIds.push(q.id);
            });
          }
        }

        // 2. Truy vấn chi tiết đúng 16 câu hỏi đã chọn qua IN query (Tối ưu tuyệt đối)
        let allSelected: Question[] = [];
        if (selectedIds.length > 0) {
          const chunks = [];
          for(let i = 0; i < selectedIds.length; i += 10) {
              chunks.push(selectedIds.slice(i, i + 10));
          }
          
          for (const chunk of chunks) {
             if(chunk.length === 0) continue;
             const q = query(collection(db, 'questions'), where(documentId(), 'in', chunk));
             try {
               const snapshot = await getDocs(q);
               allSelected = allSelected.concat(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Question)));
             } catch (e) {
               handleFirestoreError(e, OperationType.GET, 'questions');
             }
          }
        }

        // Fallback: nếu rỗng (ví dụ chưa có metadata), tải toàn bộ câu hỏi (An toàn)
        if (allSelected.length === 0) {
          let allQs: Question[] = [];
          try {
            const snapshot = await getDocs(collection(db, 'questions'));
            allQs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, 'questions');
          }

          if (allQs.length === 0) {
            throw new Error("Ngân hàng câu hỏi trống.");
          }

          const questionsByChapter: Record<string, Question[]> = {};
          allQs.forEach(q => {
            const chName = q.chapter ? q.chapter.trim() : '';
            if (chName) {
              const matchedKey = getNormalizedKey(chName);
              if (matchedKey) {
                if (!questionsByChapter[matchedKey]) {
                  questionsByChapter[matchedKey] = [];
                }
                questionsByChapter[matchedKey].push(q);
              }
            }
          });

          const selectedQs: Question[] = [];
          const usedIds = new Set<string>();

          // Chọn theo đúng quota
          Object.keys(chapterQuotas).forEach(ch => {
            const quota = chapterQuotas[ch];
            const chQs = shuffle(questionsByChapter[ch] || []);
            const chosen = chQs.slice(0, quota);
            chosen.forEach(q => {
              if (q.id) {
                selectedQs.push(q);
                usedIds.add(q.id);
              }
            });
          });

          if (selectedQs.length < 16) {
            const remainingQs = allQs.filter(q => q.id && !usedIds.has(q.id));
            const fillQs = shuffle(remainingQs).slice(0, 16 - selectedQs.length);
            fillQs.forEach(q => {
              selectedQs.push(q);
            });
          }

          allSelected = selectedQs;
        }

        finalQuestions = shuffle(allSelected);
      }

      setQuestions(finalQuestions);
      sessionStorage.setItem('quiz_current_questions_session', JSON.stringify(finalQuestions));
      setLoadingQuestions(false);
      return true;
    } catch (error) {
      console.error("Error fetching questions:", error);
      setLoadingQuestions(false);
      const isQuotaError = (error as any)?.message?.toLowerCase().includes('quota') || (error as any)?.code === 'resource-exhausted';
      if (isQuotaError) {
        alert("Hệ thống đã hết dung lượng hôm nay, hẹn bạn vào lại lúc 14 h nhé");
      } else {
        alert("Lỗi khi tải câu hỏi: " + (error as Error).message);
      }
      return false;
    }
  };

  useEffect(() => {
    if (isQuickPractice) {
      setStudentInfo({
        name: 'Học sinh Tự luyện',
        class: '9',
        school: 'Luyện tập nhanh'
      });
      setSelectedChapter(quickPracticeChapter && quickPracticeChapter !== 'all' ? quickPracticeChapter : 'Tự luyện ngẫu nhiên (10 câu)');
      
      const startPractice = async () => {
        const success = await fetchAndRandomize(quickPracticeChapter, true);
        if (success) {
          setStartTime(new Date());
          setCurrentStep('doing');
        }
      };
      startPractice();
    }
  }, [isQuickPractice, quickPracticeChapter]);

  const startQuiz = async (chap?: string) => {
    if (!studentInfo.name || !studentInfo.class || !studentInfo.school) {
      alert('Vui lòng nhập đầy đủ thông tin');
      return;
    }
    const chapName = chap || null;
    setSelectedChapter(chapName);
    
    const success = await fetchAndRandomize(chap);
    if (success) {
      setStartTime(new Date());
      setCurrentStep('doing');
    }
  };

  const handleSubmit = async () => {
    if (Object.keys(userAnswers).length < questions.length) {
      if (!confirm('Bạn chưa hoàn thành tất cả câu hỏi. Nộp bài ngay?')) return;
    }

    setIsSubmitting(true);
    let count = 0;
    questions.forEach((q, i) => {
      if (userAnswers[i] === q.correctAnswer) {
        count++;
      }
    });

    // Tính điểm trên thang 10 dựa trên số câu thực tế (Làm tròn 1 chữ số thập phân)
    const finalScore = questions.length > 0 ? Math.round(((count / questions.length) * 10) * 10) / 10 : 0;
    setCorrectCount(count);
    setScore(finalScore);

    if (isQuickPractice) {
      setCurrentStep('result');
    } else {
      try {
        await addDoc(collection(db, 'results'), {
          name: studentInfo.name,
          class: studentInfo.class,
          school: studentInfo.school,
          score: finalScore,
          correctCount: count,
          totalQuestions: questions.length,
          chapter: selectedChapter || 'Tổng hợp',
          startTime: Timestamp.fromDate(startTime!),
          submittedAt: serverTimestamp()
        });
        setCurrentStep('result');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'results');
      }
    }
    setIsSubmitting(false);
  };

  if (currentStep === 'info') {
    if (loadingQuestions) {
      return (
        <div className="max-w-md mx-auto mt-1 md:mt-3 p-4 md:p-8 bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-2xl shadow-slate-200 border border-white flex flex-col items-center justify-center min-h-[400px]">
          <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black text-slate-800 text-center">
            {isQuickPractice ? 'Đang chuẩn bị luyện tập nhanh...' : 'Đang khởi tạo đề thi mới...'}
          </p>
          <p className="text-sm text-slate-400 mt-2 font-bold text-center">
            {isQuickPractice ? 'Hệ thống đang chọn 10 câu hỏi ngẫu nhiên cho bạn.' : 'Hệ thống đang chuẩn bị 16 câu hỏi chất lượng cao cho bạn.'}
          </p>
          {selectedChapter && (
            <div className="mt-4 px-4 py-2 bg-blue-50 border border-blue-100 rounded-xl text-xs font-bold text-blue-600 max-w-sm text-center truncate shadow-sm">
              {selectedChapter}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="max-w-md mx-auto mt-1 md:mt-3 p-4 md:p-8 bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-2xl shadow-slate-200 border border-white">
        <div className="text-center mb-2 md:mb-4">
          <div className="flex justify-between items-start mb-2 md:mb-4">
            <button onClick={onBack} className="text-slate-400 hover:text-slate-600 transition-colors">
              <ChevronLeft size={20} />
            </button>
            <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-50 text-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center shadow-inner">
              <User size={24} className="md:w-8 md:h-8" />
            </div>
            <div className="w-6"></div>
          </div>
          <h2 className="text-xl md:text-2xl font-black text-slate-800">Thông tin học sinh</h2>
          <p className="text-[10px] md:text-sm text-slate-400 mt-1 font-semibold italic">Nhập thông tin đề thi & vào làm ngay</p>
        </div>
        <div className="space-y-3 md:space-y-4">
          <div>
            <label className="block text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Họ và Tên</label>
            <input 
              type="text" 
              className="w-full p-2.5 md:p-3.5 bg-slate-50 border border-slate-100 rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm md:text-base font-bold"
              placeholder="Nguyễn Văn A"
              value={studentInfo.name}
              onChange={e => setStudentInfo({...studentInfo, name: e.target.value})}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Lớp / Khối</label>
              <div className="relative">
                <select 
                  className="w-full p-2.5 md:p-3.5 bg-slate-50 border border-slate-100 rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm md:text-base font-bold appearance-none cursor-pointer"
                  value={studentInfo.class}
                  onChange={e => setStudentInfo({...studentInfo, class: e.target.value})}
                >
                  <option value="">Lớp...</option>
                  <option value="9A">9A</option>
                  <option value="9B">9B</option>
                  <option value="9C">9C</option>
                  <option value="9D">9D</option>
                  <option value="9E">9E</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ChevronRight size={14} className="rotate-90" />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Trường</label>
              <div className="relative">
                <select 
                  className="w-full p-2.5 md:p-3.5 bg-slate-50 border border-slate-100 rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm md:text-base font-bold appearance-none cursor-pointer"
                  value={studentInfo.school}
                  onChange={e => setStudentInfo({...studentInfo, school: e.target.value})}
                >
                  <option value="">Trường...</option>
                  <option value="THCS Triệu Trạch">THCS Triệu Trạch</option>
                  <option value="TH&THCS Triệu Sơn">TH&THCS Triệu Sơn</option>
                  <option value="THCS Nguyễn Bỉnh Khiêm">THCS Nguyễn Bỉnh Khiêm</option>
                  <option value="THCS Lý Tự Trọng">THCS Lý Tự Trọng</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ChevronRight size={14} className="rotate-90" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3 md:pt-4">
            <label className="block text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Bước 1: Chọn phân môn / kiểu đề</label>
            <div className="relative">
              <select 
                className="w-full p-2.5 md:p-3.5 bg-slate-50 border border-slate-100 rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm md:text-base font-bold appearance-none cursor-pointer text-slate-700 font-extrabold"
                value={selectedPart}
                onChange={e => {
                  setSelectedPart(e.target.value);
                  setSelectedChapDropdown('');
                }}
              >
                <option value="">-- Click để chọn --</option>
                <option value="all">Thi Thử Tổng Hợp Toàn Diện (16 câu)</option>
                <option value="Số và Đại số">Số và Đại số (Đại Số)</option>
                <option value="Hình học và Đo lường">Hình học và Đo lường (Hình Học)</option>
                <option value="Thống kê và Xác suất">Thống kê và Xác suất</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                <ChevronRight size={14} className="rotate-90" />
              </div>
            </div>
          </div>

          {selectedPart && selectedPart !== 'all' && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
              <label className="block text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Bước 2: Chọn chương học tương ứng</label>
              <div className="relative">
                <select 
                  className="w-full p-2.5 md:p-3.5 bg-slate-50 border border-slate-100 rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm md:text-base font-bold appearance-none cursor-pointer text-slate-700 font-extrabold"
                  value={selectedChapDropdown}
                  onChange={e => setSelectedChapDropdown(e.target.value)}
                >
                  <option value="">-- Chọn chương học --</option>
                  {PART_CHAPTERS[selectedPart]?.map((chap, i) => (
                    <option key={i} value={chap}>
                      {chap}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ChevronRight size={14} className="rotate-90" />
                </div>
              </div>
            </div>
          )}

          <button 
            onClick={() => {
              if (!studentInfo.name || !studentInfo.class || !studentInfo.school) {
                alert('Vui lòng nhập đầy đủ thông tin học sinh');
                return;
              }
              if (!selectedPart) {
                alert('Vui lòng chọn phân môn / kiểu đề thi');
                return;
              }
              if (selectedPart !== 'all' && !selectedChapDropdown) {
                alert('Vui lòng chọn chương học tương ứng');
                return;
              }
              
              if (selectedPart === 'all') {
                startQuiz();
              } else {
                startQuiz(selectedChapDropdown);
              }
            }}
            className="w-full bg-blue-600 text-white py-3 md:py-4 rounded-lg md:rounded-xl font-black text-sm md:text-base hover:bg-blue-700 transition shadow-lg shadow-blue-100 mt-4 active:scale-95 transform tracking-widest uppercase flex items-center justify-center gap-2"
          >
            VÀO THI NGAY <ArrowRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  if ((currentStep === 'doing' || currentStep === 'review') && questions.length === 0) {
    return <div className="text-center mt-20 p-12 bg-white rounded-3xl shadow-xl max-w-md mx-auto border border-slate-100 font-bold text-slate-400">Kho đề đang được cập nhật...</div>;
  }

  if (currentStep === 'doing' || currentStep === 'review') {
    const q = questions[currentIndex];
    const progress = ((currentIndex + 1) / questions.length) * 100;
    const isReview = currentStep === 'review';

    return (
      <div className="max-w-5xl mx-auto px-1 md:px-0">
        <div className="flex items-center justify-between bg-white p-2 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-slate-200 mb-3 md:mb-6 gap-2 md:gap-6">
          <div className="flex gap-3 md:gap-6 items-center w-full md:w-auto justify-between md:justify-start px-1 md:px-0">
            <div className="text-center">
              <div className="text-[8px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-0.5 md:mb-1">Câu hỏi</div>
              <div className="text-sm md:text-xl font-black text-slate-800 tracking-tight">{(currentIndex + 1).toString().padStart(2, '0')}<span className="text-slate-300 font-medium">/</span>{questions.length}</div>
            </div>
            <div className="w-px bg-slate-100 h-6 md:h-10"></div>
            <div className="text-center">
               <div className="text-[8px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-0.5 md:mb-1">Danh mục</div>
               <div className="text-[9px] md:text-sm font-bold bg-blue-50 text-blue-600 px-1.5 md:px-3 py-0.5 md:py-1 rounded-md md:rounded-lg border border-blue-100">{q.category.split(' ')[0]}</div>
            </div>
            <div className="flex md:hidden flex-col items-end">
               <div className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Tiến độ</div>
               <div className="text-[10px] font-bold text-blue-600">{Math.round(progress)}%</div>
            </div>
          </div>

          <div className="flex-1 w-full md:px-12 hidden md:block">
            <div className="flex justify-between items-center mb-1">
               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Tiến độ</span>
               <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest">{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 md:h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-50">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                className="h-full bg-blue-500 shadow-sm"
              ></motion.div>
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-3 border-l pl-6 border-slate-100">
            <div className="text-right">
              <div className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Thí sinh</div>
              <div className="text-xs font-bold text-slate-800">{studentInfo.name}</div>
            </div>
            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-black text-slate-400 text-[10px] shadow-inner">
              {studentInfo.name.split(' ').pop()?.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-8">
          <div className="lg:col-span-9 order-1 lg:order-1">
            <motion.div 
              key={currentIndex}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-4 md:p-10 rounded-[1.5rem] md:rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 min-h-0 md:min-h-[400px] flex flex-col relative overflow-hidden"
            >
              <div className="relative z-10 flex-1 flex flex-col">
                <h3 className="text-[9px] md:text-xs font-black text-blue-600 uppercase tracking-[0.2em] mb-2 md:mb-6">Câu hỏi số {currentIndex + 1}:</h3>
                <div className="text-base md:text-2xl leading-relaxed font-bold text-slate-800 mb-4 md:mb-10 overflow-x-auto max-w-full">
                  <MathText text={q.content} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-5 mt-auto">
                  {q.options.map((opt, i) => (
                    <button
                      key={i}
                      disabled={isReview}
                      onClick={() => !isReview && setUserAnswers({...userAnswers, [currentIndex]: i})}
                      className={`group p-3 md:p-6 rounded-xl md:rounded-2xl border-2 text-left transition-all flex items-start gap-3 md:gap-5 relative overflow-hidden ${
                        isReview 
                          ? i === q.correctAnswer 
                            ? 'border-green-500 bg-green-50 text-green-900' 
                            : userAnswers[currentIndex] === i 
                              ? 'border-red-500 bg-red-50 text-red-900' 
                              : 'border-slate-50 bg-slate-50/50'
                          : userAnswers[currentIndex] === i 
                            ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-md shadow-blue-100' 
                            : 'border-slate-50 bg-slate-50/50 hover:border-slate-200 hover:bg-white hover:shadow-lg'
                      }`}
                    >
                      <div className={`w-7 h-7 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center font-black text-[10px] md:text-sm shrink-0 transition-all ${
                        isReview
                          ? i === q.correctAnswer 
                            ? 'bg-green-600 text-white shadow-lg shadow-green-200' 
                            : userAnswers[currentIndex] === i 
                              ? 'bg-red-600 text-white shadow-lg shadow-red-200' 
                              : 'bg-slate-200 text-slate-500'
                          : userAnswers[currentIndex] === i ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-slate-200 text-slate-500 group-hover:bg-slate-300'
                      }`}>
                        {String.fromCharCode(65 + i)}
                      </div>
                      <div className="mt-0.5 md:mt-2 text-xs md:text-lg font-bold tracking-tight overflow-x-auto max-w-full flex-1 min-w-0">
                        <MathText text={opt} />
                      </div>
                      {isReview && i === q.correctAnswer && (
                        <div className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 text-green-500">
                          <CheckCircle2 size={16} className="md:w-6 md:h-6" />
                        </div>
                      )}
                      {isReview && userAnswers[currentIndex] === i && i !== q.correctAnswer && (
                        <div className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 text-red-500">
                          <span className="text-lg md:text-2xl font-black">✕</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center mt-6 md:mt-10 pt-3 md:pt-8 border-t border-slate-50">
                <button 
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex(prev => prev - 1)}
                  className="px-3 md:px-8 py-2 md:py-3 rounded-lg md:rounded-xl text-[9px] md:text-sm text-slate-400 font-bold hover:bg-slate-50 disabled:opacity-20 transition-all uppercase tracking-widest"
                >
                  ← TRƯỚC
                </button>
                
                {currentIndex === questions.length - 1 && !isReview ? (
                  <button 
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 md:gap-3 px-5 md:px-10 py-2.5 md:py-4 bg-green-500 text-white rounded-xl md:rounded-2xl font-black text-[10px] md:text-base shadow-xl shadow-green-100 hover:bg-green-600 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                  >
                    {isSubmitting ? 'ĐANG NỘP...' : 'NỘP BÀI'} <Send size={14} className="md:w-5 md:h-5" />
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      if (currentIndex < questions.length - 1) {
                        setCurrentIndex(prev => prev + 1);
                      } else if (isReview) {
                        setCurrentStep('result');
                      }
                    }}
                    className="flex items-center gap-2 md:gap-3 px-5 md:px-10 py-2.5 md:py-4 bg-blue-600 text-white rounded-xl md:rounded-2xl font-black text-[10px] md:text-base shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                  >
                    {currentIndex === questions.length - 1 ? 'KẾT QUẢ' : 'TIẾP THEO'} <ChevronRight size={14} className="md:w-5 md:h-5" />
                  </button>
                )}
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-3 flex flex-col gap-3 order-2 lg:order-2">
             <div className="bg-white p-3 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm mb-4">
                <h4 className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-4">Danh sách câu</h4>
                <div className="grid grid-cols-6 lg:grid-cols-4 gap-1.5 md:gap-2">
                  {questions.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentIndex(i)}
                      className={`w-full aspect-square rounded-lg md:rounded-xl font-black text-[10px] md:text-xs transition-all border flex items-center justify-center ${
                        currentIndex === i ? 'bg-blue-600 text-white border-blue-600 shadow-md md:shadow-lg shadow-blue-200 scale-105' :
                        isReview
                          ? userAnswers[i] === questions[i].correctAnswer 
                            ? 'bg-green-50 text-green-600 border-green-100' 
                            : 'bg-red-50 text-red-600 border-red-100'
                          : userAnswers[i] !== undefined ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-300 border-slate-100'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentStep === 'result') {
    return (
      <div className="max-w-2xl mx-auto mt-2 md:mt-8 p-4 md:p-10 bg-white rounded-[1.5rem] md:rounded-[2.5rem] shadow-2xl shadow-slate-200 border border-white text-center relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
        
        <motion.div 
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          className="w-16 h-16 md:w-24 md:h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-inner"
        >
          <CheckCircle2 size={32} className="md:w-12 md:h-12" />
        </motion.div>
        
        <h2 className="text-xl md:text-3xl font-black text-slate-800 mb-1 tracking-tight">
          {isQuickPractice ? 'Hoàn thành luyện tập!' : 'Kết thúc bài thi!'}
        </h2>
        <p className="text-[10px] md:text-base text-slate-400 mb-6 md:mb-8 font-bold px-4 tracking-tight">
          {isQuickPractice 
            ? 'Tuyệt vời! Bạn vừa hoàn thành bài luyện tập nhanh 10 câu hỏi.'
            : <span>Chúc mừng <span className="text-blue-600 uppercase">{studentInfo.name}</span> đã hoàn thành.</span>}
        </p>
        
        <div className="mb-6 md:mb-10">
           <div className="bg-blue-600 p-5 md:p-10 rounded-[1.5rem] md:rounded-[2.5rem] shadow-2xl shadow-blue-200 text-white inline-block min-w-[180px] md:min-w-[280px]">
               <div className="text-[9px] md:text-[11px] text-blue-100 font-black uppercase tracking-[0.2em] mb-2 md:mb-4 leading-none">
                 Điểm số của bạn
               </div>
               <div className="flex items-center justify-center gap-1 md:gap-2">
                  <span className="text-4xl md:text-8xl font-black tracking-tighter">
                    {score.toFixed(1)}
                  </span>
                  <span className="text-xl md:text-4xl font-bold text-blue-300">
                    / 10
                  </span>
               </div>
           </div>
        </div>

        <div className="bg-slate-50 p-3 md:p-5 rounded-lg md:rounded-xl border border-slate-100 mb-6 md:mb-8 inline-flex items-center gap-2 md:gap-4 mx-4">
           <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full ${correctCount >= (isQuickPractice ? 5 : 8) ? 'bg-green-500' : 'bg-orange-500'}`}></div>
           <span className="text-[9px] md:text-sm font-black text-slate-600 uppercase tracking-widest leading-none">
             Đúng: <span className="text-slate-900">{correctCount}</span> / {questions.length} câu
           </span>
        </div>

        <div className="grid grid-cols-2 lg:flex lg:flex-row gap-2 md:gap-3 justify-center px-2">
            <button 
              onClick={() => {
                setCurrentIndex(0);
                setCurrentStep('review');
              }}
              className="px-4 py-3 md:py-4 bg-blue-600 text-white rounded-lg md:rounded-xl font-black text-[10px] md:text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-100 uppercase tracking-wider"
            >
              Xem lại bài
            </button>
            <button 
              onClick={async () => {
                if (isQuickPractice) {
                  sessionStorage.removeItem('quiz_current_questions_session');
                  setUserAnswers({});
                  setCurrentIndex(0);
                  setScore(0);
                  setCorrectCount(0);
                  setQuestions([]);
                  setLoadingQuestions(true);
                  const success = await fetchAndRandomize(quickPracticeChapter, true);
                  if (success) {
                    setStartTime(new Date());
                    setCurrentStep('doing');
                  }
                } else {
                  sessionStorage.removeItem('quiz_current_questions_session');
                  setStudentInfo({ name: '', class: '', school: '' });
                  setUserAnswers({});
                  setCurrentIndex(0);
                  setScore(0);
                  setCorrectCount(0);
                  setQuestions([]);
                  setCurrentStep('info');
                }
              }}
              className="px-4 py-3 md:py-4 bg-slate-900 text-white rounded-lg md:rounded-xl font-black text-[10px] md:text-xs hover:bg-slate-800 transition shadow-lg shadow-slate-100 uppercase tracking-wider"
            >
              {isQuickPractice ? 'Luyện đề khác' : 'Làm đề mới'}
            </button>
            <button 
              onClick={onBack}
              className="px-4 py-3 md:py-4 bg-white text-slate-400 border border-slate-200 rounded-lg md:rounded-xl font-black text-[10px] md:text-xs hover:bg-slate-50 transition uppercase tracking-wider"
            >
              Trang chủ
            </button>
        </div>
      </div>
    );
  }

  return null;
}
