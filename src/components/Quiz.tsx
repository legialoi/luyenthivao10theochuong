import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db, Question, ClassRoster, handleFirestoreError, OperationType, PART_CHAPTERS, SCHOOL_CLASSES } from '../lib/firebase';
import { collection, addDoc, getDocs, Timestamp, serverTimestamp, doc, getDoc, query, where, documentId, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ChevronRight, ChevronLeft, Send, User, School, GraduationCap, Users, ChevronDown, Check, Sparkles, Clock, AlertCircle, X, ShieldAlert, Maximize2, Minimize2 } from 'lucide-react';
import MathText from './MathText';
import { getRosterSuggestions, matchResultToRoster, removeVietnameseTones, cleanName, normalizeClassRosterOrder, sortVietnameseRosterByGivenName } from '../utils/nameMatcher';
import {
  sanitizeQuestionForStudent,
  resolveCorrectAnswerIndex,
  isStudentAnswerCorrect,
  encryptStudentChoice,
  decryptStudentChoice,
  encryptSessionCache
} from '../utils/security';

const STUDENT_PROFILE_STORAGE_KEY = 'quiz_student_profile_v1';
const METADATA_CACHE_KEY = 'quiz_metadata_ids';
const METADATA_TTL_MS = 10 * 60 * 1000; // 10 minutes

function normalizeChapterStr(str?: string | null): string {
  if (!str) return '';
  return str
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\$/g, '')
    .replace(/\\NEQ/g, '!=')
    .replace(/\\NOT=/g, '!=')
    .replace(/≠/g, '!=')
    .replace(/\^2/g, '²');
}

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
  
  const [studentInfo, setStudentInfo] = useState<{ name: string; class: string; school: string }>(() => {
    try {
      const saved = localStorage.getItem(STUDENT_PROFILE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const validSchool = parsed.school && SCHOOL_CLASSES[parsed.school] ? parsed.school : 'THCS Nam Cửa Việt';
        const allowedClasses = SCHOOL_CLASSES[validSchool] || ['9A8', '9A9', 'Học thêm'];
        const validClass = parsed.class && allowedClasses.includes(parsed.class) ? parsed.class : allowedClasses[0];
        return {
          name: typeof parsed.name === 'string' ? parsed.name : '',
          school: validSchool,
          class: validClass
        };
      }
    } catch (e) {
      // ignore storage errors
    }
    return { name: '', class: '9A8', school: 'THCS Nam Cửa Việt' };
  });

  const [classRoster, setClassRoster] = useState<string[]>([]);
  const [isRosterLoading, setIsRosterLoading] = useState(false);
  const [showNameDropdown, setShowNameDropdown] = useState(false);
  const nameDropdownRef = useRef<HTMLDivElement>(null);

  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [encryptedChoices, setEncryptedChoices] = useState<Record<number, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedPart, setSelectedPart] = useState<string>('');
  const [selectedChapDropdown, setSelectedChapDropdown] = useState<string>('');

  // In-app notification & confirmation modal (replaces browser alert/confirm)
  const [notice, setNotice] = useState<{ type: 'error' | 'info'; message: string } | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  // Anti-tab-switch / New browser window / Exit-Fullscreen proctoring state
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showTabWarningModal, setShowTabWarningModal] = useState(false);
  const [violationReason, setViolationReason] = useState<string>('Phát hiện mở Tab mới hoặc rời màn hình thi!');
  const [autoSubmittedByViolation, setAutoSubmittedByViolation] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const wasInFullscreenRef = useRef<boolean>(false);
  const isIntentionalFullscreenExitRef = useRef<boolean>(false);
  const lastViolationTimeRef = useRef<number>(0);
  const MAX_TAB_VIOLATIONS = 3;

  const requestExamFullscreen = useCallback(async () => {
    try {
      isIntentionalFullscreenExitRef.current = false;
      const el = document.documentElement as any;
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        }
      }
    } catch (e) {
      // Ignore if blocked by iframe policy; full-viewport CSS mode still activates
    }
  }, []);

  const exitExamFullscreen = useCallback(async () => {
    try {
      isIntentionalFullscreenExitRef.current = true;
      wasInFullscreenRef.current = false;
      const docAny = document as any;
      if (document.fullscreenElement || docAny.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (docAny.webkitExitFullscreen) {
          await docAny.webkitExitFullscreen();
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const showToast = useCallback((message: string, type: 'error' | 'info' = 'error') => {
    setNotice({ type, message });
    setTimeout(() => {
      setNotice(prev => (prev?.message === message ? null : prev));
    }, 5000);
  }, []);

  const getStudentChoice = useCallback(
    (qIdx: number): number | undefined => {
      const token = encryptedChoices[qIdx];
      if (!token) return undefined;
      const q = questions[qIdx];
      return decryptStudentChoice(token, qIdx, q?.id || q?.content || '');
    },
    [encryptedChoices, questions]
  );

  const selectStudentChoice = useCallback(
    (qIdx: number, optIdx: number) => {
      const q = questions[qIdx];
      const token = encryptStudentChoice(qIdx, optIdx, q?.id || q?.content || '');
      setEncryptedChoices(prev => ({ ...prev, [qIdx]: token }));
    },
    [questions]
  );

  // Save student profile on change (when not in quick practice)
  useEffect(() => {
    if (!isQuickPractice && studentInfo.school && studentInfo.class) {
      try {
        localStorage.setItem(STUDENT_PROFILE_STORAGE_KEY, JSON.stringify(studentInfo));
      } catch (e) {
        // ignore
      }
    }
  }, [studentInfo, isQuickPractice]);

  // Live timer during quiz
  useEffect(() => {
    if (currentStep !== 'doing' || !startTime) {
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTime.getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [currentStep, startTime]);

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  // Close name dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (nameDropdownRef.current && !nameDropdownRef.current.contains(event.target as Node)) {
        setShowNameDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch class roster dynamically whenever school or class changes (with sessionStorage cache)
  useEffect(() => {
    if (isQuickPractice || !studentInfo.school || !studentInfo.class) {
      setClassRoster([]);
      return;
    }

    let isMounted = true;
    const rosterDocId = `roster_${studentInfo.school.trim().replace(/\s+/g, '_')}_${studentInfo.class.trim().replace(/\s+/g, '_')}`;
    const cacheKey = `cached_${rosterDocId}`;

    const fetchRoster = async () => {
      // Check session cache first to save Firestore reads
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setClassRoster(parsed);
            return;
          }
        }
      } catch (e) {
        // ignore cache error
      }

      setIsRosterLoading(true);
      try {
        const rosterSnap = await getDoc(doc(db, 'class_rosters', rosterDocId));

        if (rosterSnap.exists()) {
          const data = rosterSnap.data() as ClassRoster;
          if (isMounted && data.students && data.students.length > 0) {
            const ordered = normalizeClassRosterOrder(data.students);
            setClassRoster(ordered);
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify(ordered));
            } catch (e) {}
            setIsRosterLoading(false);
            return;
          }
        }

        // Lightweight Fallback: Query at most 60 recent results for this class
        const q = query(
          collection(db, 'results'),
          where('class', '==', studentInfo.class),
          limit(60)
        );
        const resultsSnap = await getDocs(q);
        const fetchedResults = resultsSnap.docs
          .map(d => d.data())
          .filter(r => !studentInfo.school || r.school === studentInfo.school || !r.school);
        const distinctNames = sortVietnameseRosterByGivenName(
          Array.from<string>(
            new Set(fetchedResults.map(r => (r.name || '').trim()).filter(Boolean))
          )
        );

        if (isMounted) {
          setClassRoster(distinctNames);
          if (distinctNames.length > 0) {
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify(distinctNames));
            } catch (e) {}
          }
        }
      } catch (err) {
        console.error('Error loading class roster:', err);
      } finally {
        if (isMounted) setIsRosterLoading(false);
      }
    };

    fetchRoster();
    return () => {
      isMounted = false;
    };
  }, [studentInfo.school, studentInfo.class, isQuickPractice]);

  const fetchAndRandomize = async (chap?: string, isPractice = false) => {
    setLoadingQuestions(true);
    setNotice(null);
    try {
      sessionStorage.removeItem('quiz_current_questions_session');

      const shuffle = <T,>(array: T[]): T[] => {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };

      const fetchByIds = async (ids: string[]): Promise<Question[]> => {
        const result: Question[] = [];
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 10) {
          chunks.push(ids.slice(i, i + 10));
        }
        for (const chunk of chunks) {
          if (chunk.length === 0) continue;
          const q = query(collection(db, 'questions'), where(documentId(), 'in', chunk));
          try {
            const snapshot = await getDocs(q);
            result.push(...snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Question)));
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, 'questions');
          }
        }
        return result;
      };

      // Load metadata with TTL validation
      const loadMetadataLists = async (forceRefresh = false): Promise<{ id: string; chapter: string; category: string }[]> => {
        let lists: any = null;
        if (!forceRefresh) {
          const cached = localStorage.getItem(METADATA_CACHE_KEY);
          if (cached) {
            try {
              const { data, timestamp } = JSON.parse(cached);
              if (timestamp && Date.now() - timestamp < METADATA_TTL_MS) {
                lists = data;
              } else {
                localStorage.removeItem(METADATA_CACHE_KEY);
              }
            } catch (e) {
              localStorage.removeItem(METADATA_CACHE_KEY);
            }
          }
        }

        if (!lists) {
          try {
            const metaDoc = await getDoc(doc(db, 'metadata', 'questions'));
            if (metaDoc.exists()) {
              lists = metaDoc.data();
              localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify({ data: lists, timestamp: Date.now() }));
            }
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, 'metadata/questions');
          }
        }

        return lists && Array.isArray(lists.allQuestions) ? lists.allQuestions : [];
      };

      let allQsMetaData = await loadMetadataLists(false);
      let finalQuestions: Question[] = [];

      if (isPractice || chap) {
        const targetChap = isPractice ? (chap && chap !== 'all' ? chap : null) : chap;
        const targetNorm = normalizeChapterStr(targetChap);

        const pickFromMeta = (metaList: { id: string; chapter: string; category: string }[]) => {
          const filtered = targetNorm
            ? metaList.filter(q => normalizeChapterStr(q.chapter) === targetNorm)
            : metaList;
          return shuffle(filtered.map(q => q.id).filter(Boolean)).slice(0, 16);
        };

        let selectedIds = pickFromMeta(allQsMetaData);
        let fetchedQs = selectedIds.length > 0 ? await fetchByIds(selectedIds) : [];

        // If cached metadata had stale IDs, refresh metadata once
        if (selectedIds.length > 0 && fetchedQs.length < Math.min(selectedIds.length, 16)) {
          allQsMetaData = await loadMetadataLists(true);
          selectedIds = pickFromMeta(allQsMetaData);
          fetchedQs = selectedIds.length > 0 ? await fetchByIds(selectedIds) : [];
        }

        // Fallback: Direct Firestore query if metadata didn't return questions
        if (fetchedQs.length === 0) {
          try {
            let snapshot;
            if (targetChap) {
              snapshot = await getDocs(query(collection(db, 'questions'), where('chapter', '==', targetChap), limit(40)));
            } else {
              snapshot = await getDocs(query(collection(db, 'questions'), limit(40)));
            }
            const allFetched: Question[] = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Question));
            fetchedQs = shuffle(allFetched).slice(0, 16);
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, 'questions');
          }
        }

        if (fetchedQs.length === 0) {
          showToast('Chương học được chọn hiện chưa có câu hỏi trong ngân hàng đề. Vui lòng chọn chương khác!');
          setLoadingQuestions(false);
          return false;
        }

        finalQuestions = shuffle(fetchedQs).slice(0, 16);
      } else {
        // Mode B: Standard comprehensive exam (16 questions distributed across chapters)
        const chapterQuotas: Record<string, number> = {
          'Chương I. PHƯƠNG TRÌNH VÀ HỆ HAI PHƯƠNG TRÌNH BẬC NHẤT HAI ẨN': 2,
          'Chương II. PHƯƠNG TRÌNH VÀ BẤT PHƯƠNG TRÌNH BẬC NHẤT MỘT ẨN': 2,
          'Chương III. CĂN BẬC HAI VÀ CĂN BẬC BA': 2,
          'Chương VI. HÀM SỐ y = ax² (a ≠ 0). PHƯƠNG TRÌNH BẬC HAI MỘT ẨN': 2,
          'Chương IV. HỆ THỨC LƯỢNG TRONG TAM GIÁC VUÔNG': 1,
          'Chương X. MỘT SỐ HÌNH KHỐI TRONG THỰC TIỄN': 1,
          'Chương V. ĐƯỜNG TRÒN': 2,
          'Chương IX. ĐƯỜNG TRÒN NGOẠI TIẾP VÀ ĐƯỜNG TRÒN NỘI TIẾP': 2,
          'Chương VII. TẦN SỐ VÀ TẦN SỐ TƯƠNG ĐỐI': 1,
          'Chương VIII. XÁC SUẤT CỦA BIẾN CỐ TRONG MỘT SỐ MÔ HÌNH XÁC SUẤT ĐƠN GIẢN': 1
        };

        const getNormalizedKey = (chName?: string): string | null => {
          const clean = normalizeChapterStr(chName);
          if (!clean) return null;
          for (const key of Object.keys(chapterQuotas)) {
            if (clean === normalizeChapterStr(key)) {
              return key;
            }
          }
          return null;
        };

        const selectQuotaIds = (metaList: { id: string; chapter: string; category: string }[]) => {
          const questionsByChapter: Record<string, { id: string; chapter: string; category: string }[]> = {};
          metaList.forEach(q => {
            const matchedKey = getNormalizedKey(q.chapter);
            if (matchedKey) {
              if (!questionsByChapter[matchedKey]) questionsByChapter[matchedKey] = [];
              questionsByChapter[matchedKey].push(q);
            }
          });

          const chosenIds: string[] = [];
          const usedIds = new Set<string>();

          Object.keys(chapterQuotas).forEach(ch => {
            const quota = chapterQuotas[ch];
            const chQs = shuffle(questionsByChapter[ch] || []);
            chQs.slice(0, quota).forEach(q => {
              if (q.id) {
                chosenIds.push(q.id);
                usedIds.add(q.id);
              }
            });
          });

          if (chosenIds.length < 16) {
            const remainingQs = metaList.filter(q => q.id && !usedIds.has(q.id));
            shuffle(remainingQs)
              .slice(0, 16 - chosenIds.length)
              .forEach(q => chosenIds.push(q.id));
          }
          return chosenIds;
        };

        let selectedIds = allQsMetaData.length > 0 ? selectQuotaIds(allQsMetaData) : [];
        let allSelected = selectedIds.length > 0 ? await fetchByIds(selectedIds) : [];

        // If some IDs were stale/deleted in cache, refresh metadata once
        if (selectedIds.length > 0 && allSelected.length < Math.min(selectedIds.length, 16)) {
          allQsMetaData = await loadMetadataLists(true);
          selectedIds = selectQuotaIds(allQsMetaData);
          allSelected = selectedIds.length > 0 ? await fetchByIds(selectedIds) : [];
        }

        // Fallback if metadata was empty
        if (allSelected.length === 0) {
          let allQs: Question[] = [];
          try {
            const snapshot = await getDocs(query(collection(db, 'questions'), limit(80)));
            allQs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Question));
          } catch (e) {
            handleFirestoreError(e, OperationType.GET, 'questions');
          }

          if (allQs.length === 0) {
            showToast('Ngân hàng câu hỏi hiện đang trống.');
            setLoadingQuestions(false);
            return false;
          }

          allSelected = shuffle(allQs).slice(0, 16);
        }

        finalQuestions = shuffle(allSelected);
      }

      const securedQuestions = finalQuestions.map(q => sanitizeQuestionForStudent(q));
      setQuestions(securedQuestions);
      sessionStorage.setItem('quiz_current_questions_session', encryptSessionCache(securedQuestions));
      setLoadingQuestions(false);
      return true;
    } catch (error) {
      console.error("Error fetching questions:", error);
      setLoadingQuestions(false);
      const isQuotaError = (error as any)?.message?.toLowerCase().includes('quota') || (error as any)?.code === 'resource-exhausted';
      if (isQuotaError) {
        showToast("Hệ thống đã hết dung lượng đọc miễn phí hôm nay, hẹn bạn vào lại sau nhé!");
      } else {
        showToast("Lỗi khi tải câu hỏi: " + (error as Error).message);
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
      setSelectedChapter(quickPracticeChapter && quickPracticeChapter !== 'all' ? quickPracticeChapter : 'Tự luyện ngẫu nhiên (16 câu)');
      
      const startPractice = async () => {
        const success = await fetchAndRandomize(quickPracticeChapter, true);
        if (success) {
          setStartTime(new Date());
          setElapsedSeconds(0);
          setCurrentStep('doing');
        }
      };
      startPractice();
    }
  }, [isQuickPractice, quickPracticeChapter]);

  const startQuiz = async (chap?: string) => {
    const cleanedInputName = cleanName(studentInfo.name);
    if (!cleanedInputName || !studentInfo.class || !studentInfo.school) {
      showToast('Vui lòng nhập đầy đủ Họ và Tên, Trường, Lớp!');
      return;
    }

    // Auto-canonicalize student name if it matches a class roster entry without tones or case
    let canonicalName = cleanedInputName;
    if (classRoster.length > 0) {
      const exactOrToneMatch = classRoster.find(
        r => removeVietnameseTones(r) === removeVietnameseTones(cleanedInputName)
      );
      if (exactOrToneMatch) {
        canonicalName = exactOrToneMatch;
      }
    }

    if (canonicalName !== studentInfo.name) {
      setStudentInfo(prev => ({ ...prev, name: canonicalName }));
    }

    const chapName = chap || null;
    setSelectedChapter(chapName);
    
    const success = await fetchAndRandomize(chap, false);
    if (success) {
      setTabSwitchCount(0);
      setShowTabWarningModal(false);
      setAutoSubmittedByViolation(false);
      setStartTime(new Date());
      setElapsedSeconds(0);
      setCurrentStep('doing');
    }
  };

  const executeSubmit = useCallback(async (overrideTabSwitchCount?: number) => {
    setShowSubmitConfirm(false);
    setShowTabWarningModal(false);
    setIsSubmitting(true);
    let count = 0;
    const encryptedAuditTokens: string[] = [];

    questions.forEach((q, i) => {
      const chosenIdx = getStudentChoice(i);
      if (isStudentAnswerCorrect(q, chosenIdx)) {
        count++;
      }
      if (chosenIdx !== undefined) {
        encryptedAuditTokens.push(encryptStudentChoice(i, chosenIdx, q.id || ''));
      }
    });

    const finalScore = questions.length > 0 ? Math.round(((count / questions.length) * 10) * 10) / 10 : 0;
    const finalViolations = typeof overrideTabSwitchCount === 'number' ? overrideTabSwitchCount : tabSwitchCount;
    setCorrectCount(count);
    setScore(finalScore);

    if (isQuickPractice) {
      await exitExamFullscreen();
      setCurrentStep('result');
    } else {
      // Ensure canonical name if matched in roster
      let finalName = cleanName(studentInfo.name);
      if (classRoster.length > 0) {
        const matched = matchResultToRoster(finalName, classRoster);
        if (matched && removeVietnameseTones(matched) === removeVietnameseTones(finalName)) {
          finalName = matched;
        }
      }

      try {
        await addDoc(collection(db, 'results'), {
          name: finalName,
          class: studentInfo.class,
          school: studentInfo.school,
          score: finalScore,
          correctCount: count,
          totalQuestions: questions.length,
          chapter: selectedChapter || 'Tổng hợp',
          encryptedAnswers: encryptedAuditTokens.join('.'),
          tabSwitchCount: finalViolations,
          startTime: Timestamp.fromDate(startTime || new Date()),
          submittedAt: serverTimestamp()
        });
        await exitExamFullscreen();
        setCurrentStep('result');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'results');
      }
    }
    setIsSubmitting(false);
  }, [questions, getStudentChoice, tabSwitchCount, isQuickPractice, studentInfo, classRoster, selectedChapter, startTime, exitExamFullscreen]);

  const handleRequestSubmit = () => {
    const answeredCount = questions.filter((_, idx) => getStudentChoice(idx) !== undefined).length;
    if (answeredCount < questions.length) {
      setShowSubmitConfirm(true);
      return;
    }
    executeSubmit();
  };

  // Keyboard shortcuts & Anti-F12 / Anti-DevTools protection during active quiz
  useEffect(() => {
    if (currentStep !== 'doing' && currentStep !== 'review') return;
    const isReview = currentStep === 'review';

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+T, Ctrl+N, Ctrl+C during active exam
      if (!isReview) {
        const keyUpper = e.key.toUpperCase();
        const isDevToolsOrNewTabShortcut =
          e.key === 'F12' ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'J', 'C', 'K', 'N', 'T'].includes(keyUpper)) ||
          ((e.ctrlKey || e.metaKey) && ['U', 'T', 'N', 'C', 'S', 'P'].includes(keyUpper));

        if (isDevToolsOrNewTabShortcut) {
          e.preventDefault();
          e.stopPropagation();
          showToast('Chế độ bảo mật phòng thi: Chức năng mở tab mới, sao chép hoặc kiểm tra mã nguồn bị khóa khi đang thi!', 'info');
          return;
        }
      }

      if (showSubmitConfirm || showTabWarningModal) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        setCurrentIndex(prev => prev - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < questions.length - 1) {
        e.preventDefault();
        setCurrentIndex(prev => prev + 1);
      } else if (!isReview) {
        const keyUpper = e.key.toUpperCase();
        const optionMap: Record<string, number> = {
          '1': 0, 'A': 0,
          '2': 1, 'B': 1,
          '3': 2, 'C': 2,
          '4': 3, 'D': 3
        };
        if (optionMap[keyUpper] !== undefined && questions[currentIndex]?.options[optionMap[keyUpper]] !== undefined) {
          selectStudentChoice(currentIndex, optionMap[keyUpper]);
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (!isReview) {
        e.preventDefault();
      }
    };

    const handleCopyOrCut = (e: ClipboardEvent) => {
      if (!isReview) {
        e.preventDefault();
        showToast('Không được phép sao chép nội dung đề thi để tra cứu bên ngoài!', 'info');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('copy', handleCopyOrCut);
    window.addEventListener('cut', handleCopyOrCut);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('copy', handleCopyOrCut);
      window.removeEventListener('cut', handleCopyOrCut);
    };
  }, [currentStep, currentIndex, questions, showSubmitConfirm, showTabWarningModal, selectStudentChoice, showToast]);

  // Anti-Tab-Switch, Anti-New-Browser-Window & Anti-Fullscreen-Exit Proctoring Detector
  useEffect(() => {
    if (currentStep !== 'doing' || isSubmitting) return;

    const recordTabOrWindowViolation = (reasonText: string) => {
      const now = Date.now();
      // Cooldown 1.5s so multiple events firing together for the same action only count as 1 violation
      if (now - lastViolationTimeRef.current < 1500) return;
      lastViolationTimeRef.current = now;

      setViolationReason(reasonText);
      setTabSwitchCount(prev => {
        const nextCount = prev + 1;
        if (nextCount >= MAX_TAB_VIOLATIONS) {
          setAutoSubmittedByViolation(true);
          executeSubmit(nextCount);
        } else {
          setShowTabWarningModal(true);
        }
        return nextCount;
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        recordTabOrWindowViolation('Phát hiện mở Tab mới hoặc ẩn màn hình bài thi!');
      }
    };

    const handleWindowBlur = () => {
      // Trigger when user switches to another browser window, opens a new tab/window, or uses Alt+Tab
      if (document.hasFocus && !document.hasFocus()) {
        recordTabOrWindowViolation('Phát hiện chuyển sang cửa sổ trình duyệt mới hoặc ứng dụng khác!');
      }
    };

    const handleFullscreenChange = () => {
      const docAny = document as any;
      const isFs = Boolean(document.fullscreenElement || docAny.webkitFullscreenElement);
      setIsNativeFullscreen(isFs);

      if (isFs) {
        wasInFullscreenRef.current = true;
      } else if (wasInFullscreenRef.current && !isIntentionalFullscreenExitRef.current) {
        // Student exited Fullscreen mode (pressed Esc / F11 / browser exit button) during the exam!
        recordTabOrWindowViolation('Phát hiện thoát chế độ Toàn màn hình (Fullscreen) khi đang làm bài!');
      }
    };

    // Initialize current fullscreen state when entering 'doing'
    const docAny = document as any;
    const initialFs = Boolean(document.fullscreenElement || docAny.webkitFullscreenElement);
    setIsNativeFullscreen(initialFs);
    if (initialFs) {
      wasInFullscreenRef.current = true;
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [currentStep, isSubmitting, executeSubmit]);

  // Smart roster match suggestion for current input
  const smartMatchedName = React.useMemo(() => {
    const trimmed = cleanName(studentInfo.name);
    if (!trimmed || classRoster.length === 0) return null;
    if (classRoster.includes(trimmed)) return trimmed;
    return matchResultToRoster(trimmed, classRoster);
  }, [studentInfo.name, classRoster]);

  if (currentStep === 'info') {
    if (loadingQuestions) {
      return (
        <div className="max-w-md mx-auto mt-1 md:mt-3 p-4 md:p-8 bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-2xl shadow-slate-200 border border-white flex flex-col items-center justify-center min-h-[400px]">
          <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black text-slate-800 text-center">
            {isQuickPractice ? 'Đang chuẩn bị luyện tập nhanh...' : 'Đang khởi tạo đề thi mới...'}
          </p>
          <p className="text-sm text-slate-400 mt-2 font-bold text-center">
            {isQuickPractice ? 'Hệ thống đang chọn 16 câu hỏi ngẫu nhiên cho bạn.' : 'Hệ thống đang chuẩn bị 16 câu hỏi chất lượng cao cho bạn.'}
          </p>
          {selectedChapter && (
            <div className="mt-4 px-4 py-2 bg-blue-50 border border-blue-100 rounded-xl text-xs font-bold text-blue-600 max-w-sm text-center truncate shadow-sm">
              {selectedChapter}
            </div>
          )}
        </div>
      );
    }

    const suggestions = getRosterSuggestions(studentInfo.name, classRoster);
    const isExactInRoster = classRoster.includes(cleanName(studentInfo.name));

    return (
      <div className="max-w-md mx-auto mt-1 md:mt-3 p-4 md:p-8 bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-2xl shadow-slate-200 border border-white">
        {notice && (
          <div className={`mb-4 p-3 rounded-xl border flex items-center justify-between gap-2 text-xs font-bold animate-in fade-in duration-150 ${
            notice.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{notice.message}</span>
            </div>
            <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="text-center mb-2 md:mb-4">
          <div className="flex justify-between items-start mb-2 md:mb-4">
            <button onClick={onBack} className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
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
          {/* Trường & Lớp */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1 ml-1 flex items-center gap-1">
                <School size={12} className="text-blue-500" />
                <span>Trường</span>
              </label>
              <div className="relative">
                <select 
                  className="w-full p-2.5 md:p-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-xs md:text-sm font-bold appearance-none cursor-pointer"
                  value={studentInfo.school}
                  onChange={e => {
                    const newSchool = e.target.value;
                    const availableClasses = SCHOOL_CLASSES[newSchool] || ['Học thêm'];
                    const newClass = availableClasses.includes(studentInfo.class) ? studentInfo.class : availableClasses[0];
                    setStudentInfo({ ...studentInfo, school: newSchool, class: newClass, name: '' });
                    setShowNameDropdown(false);
                  }}
                >
                  <option value="THCS Nam Cửa Việt">THCS Nam Cửa Việt</option>
                  <option value="TH&THCS Đoàn Khuê">TH&THCS Đoàn Khuê</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ChevronRight size={14} className="rotate-90" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1 ml-1 flex items-center gap-1">
                <GraduationCap size={12} className="text-blue-500" />
                <span>Lớp</span>
              </label>
              <div className="relative">
                <select 
                  className="w-full p-2.5 md:p-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-xs md:text-sm font-bold appearance-none cursor-pointer"
                  value={studentInfo.class}
                  onChange={e => {
                    setStudentInfo({ ...studentInfo, class: e.target.value, name: '' });
                    setShowNameDropdown(false);
                  }}
                >
                  {(SCHOOL_CLASSES[studentInfo.school] || ['9A8', '9A9', 'Học thêm']).map(cls => (
                    <option key={cls} value={cls}>
                      {cls === 'Học thêm' ? 'Lớp Học thêm' : `Lớp ${cls}`}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ChevronRight size={14} className="rotate-90" />
                </div>
              </div>
            </div>
          </div>

          {/* Họ và Tên với Menu Thả gợi ý & Chọn nhanh theo danh sách lớp */}
          <div ref={nameDropdownRef} className="relative">
            <div className="flex items-center justify-between mb-1 ml-1">
              <label className="text-[9px] md:text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <User size={12} className="text-blue-500" />
                <span>Họ và Tên</span>
              </label>
              {classRoster.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowNameDropdown(!showNameDropdown)}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer transition-colors bg-blue-50 px-2 py-0.5 rounded-md hover:bg-blue-100"
                >
                  <Users size={11} />
                  <span>DS Lớp {studentInfo.class} ({classRoster.length} HS)</span>
                  <ChevronDown size={12} className={`transition-transform ${showNameDropdown ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>

            <div className="relative">
              <input 
                type="text" 
                className={`w-full p-2.5 md:p-3.5 bg-slate-50 border rounded-lg md:rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm md:text-base font-bold pr-10 ${
                  isExactInRoster 
                    ? 'border-emerald-300 bg-emerald-50/30' 
                    : 'border-slate-200'
                }`}
                placeholder="Nhập hoặc chọn tên học sinh..."
                value={studentInfo.name}
                onFocus={() => {
                  if (classRoster.length > 0) setShowNameDropdown(true);
                }}
                onChange={e => {
                  setStudentInfo({ ...studentInfo, name: e.target.value });
                  if (classRoster.length > 0) setShowNameDropdown(true);
                }}
              />
              
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowNameDropdown(!showNameDropdown)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                title="Bấm để mở danh sách học sinh lớp"
              >
                {isRosterLoading ? (
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <ChevronDown size={18} className={`transition-transform ${showNameDropdown ? 'rotate-180 text-blue-600' : ''}`} />
                )}
              </button>
            </div>

            {/* Trạng thái xác nhận tên & Gợi ý chuẩn hóa thông minh */}
            {studentInfo.name.trim() && (
              <div className="mt-1.5 flex flex-col gap-1 text-[11px] px-1">
                {isExactInRoster ? (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                    Đúng tên trong danh sách lớp {studentInfo.class}
                  </span>
                ) : smartMatchedName ? (
                  <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 text-amber-800">
                    <span className="flex items-center gap-1 font-medium truncate">
                      <Sparkles size={12} className="text-amber-600 shrink-0" />
                      <span>Có phải bạn là: <strong className="font-black text-amber-950">{smartMatchedName}</strong>?</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setStudentInfo({ ...studentInfo, name: smartMatchedName });
                        setShowNameDropdown(false);
                      }}
                      className="ml-2 px-2 py-0.5 bg-amber-600 text-white rounded text-[10px] font-black hover:bg-amber-700 transition shrink-0 cursor-pointer"
                    >
                      Chọn đúng tên
                    </button>
                  </div>
                ) : classRoster.length > 0 ? (
                  <span className="text-amber-600 font-medium flex items-center gap-1">
                    <Sparkles size={12} className="text-amber-500 shrink-0" />
                    Hãy chọn tên từ danh sách lớp bên dưới để thống kê chính xác nhất
                  </span>
                ) : null}
              </div>
            )}

            {/* Menu Thả / Dropdown Danh Sách Học Sinh */}
            <AnimatePresence>
              {showNameDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-60 flex flex-col"
                >
                  <div className="p-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <Users size={13} className="text-blue-600" />
                      Danh sách lớp {studentInfo.class} ({studentInfo.school})
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      {suggestions.length} gợi ý
                    </span>
                  </div>

                  <div className="overflow-y-auto divide-y divide-slate-100 flex-1 p-1">
                    {suggestions.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        {classRoster.length === 0 ? (
                          <span>Chưa có danh sách lớp được tải lên. Bạn có thể tự nhập tên trực tiếp.</span>
                        ) : (
                          <span>Không tìm thấy học sinh phù hợp với từ khóa "{studentInfo.name}".</span>
                        )}
                      </div>
                    ) : (
                      suggestions.map((stName, idx) => {
                        const isSelected = studentInfo.name.trim().toLowerCase() === stName.trim().toLowerCase();
                        const parts = stName.split(' ');
                        const initials = parts.map(p => p[0]).join('').slice(0, 2).toUpperCase();

                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setStudentInfo({ ...studentInfo, name: stName });
                              setShowNameDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs transition-colors group cursor-pointer ${
                              isSelected 
                                ? 'bg-blue-600 text-white font-black' 
                                : 'hover:bg-blue-50 text-slate-800 font-medium'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                                isSelected ? 'bg-white text-blue-600' : 'bg-slate-100 text-slate-600 group-hover:bg-blue-200 group-hover:text-blue-800'
                              }`}>
                                {initials}
                              </div>
                              <div>
                                <div className="text-xs font-bold leading-tight">{stName}</div>
                                <div className={`text-[10px] ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                                  Lớp {studentInfo.class}
                                </div>
                              </div>
                            </div>

                            {isSelected && <Check size={14} className="text-white shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="p-2 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 text-center">
                    💡 Click để chọn đúng tên giúp việc thống kê tháng chính xác tuyệt đối
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
              if (!cleanName(studentInfo.name) || !studentInfo.class || !studentInfo.school) {
                showToast('Vui lòng nhập đầy đủ thông tin học sinh!');
                return;
              }
              if (!selectedPart) {
                showToast('Vui lòng chọn phân môn / kiểu đề thi!');
                return;
              }
              if (selectedPart !== 'all' && !selectedChapDropdown) {
                showToast('Vui lòng chọn chương học tương ứng!');
                return;
              }
              
              // Enter Fullscreen immediately on user click gesture
              requestExamFullscreen();

              if (selectedPart === 'all') {
                startQuiz();
              } else {
                startQuiz(selectedChapDropdown);
              }
            }}
            className="w-full bg-blue-600 text-white py-3 md:py-4 rounded-lg md:rounded-xl font-black text-sm md:text-base hover:bg-blue-700 transition shadow-lg shadow-blue-100 mt-4 active:scale-95 transform tracking-widest uppercase flex items-center justify-center gap-2 cursor-pointer"
          >
            <Maximize2 size={16} /> VÀO THI NGAY (FULL MÀN HÌNH) <ChevronRight size={18} />
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
    const isReview = currentStep === 'review';
    const currentChosenOption = getStudentChoice(currentIndex);
    const currentCorrectOption = isReview ? resolveCorrectAnswerIndex(q) : -999;
    const unansweredIndices = questions.map((_, idx) => idx).filter(idx => getStudentChoice(idx) === undefined);
    const answeredCount = questions.length - unansweredIndices.length;
    const progress = (answeredCount / questions.length) * 100;

    return (
      <div
        onMouseDown={() => {
          // Ensure fullscreen is locked on first interaction inside the exam room if not already active
          if (!isReview && !isNativeFullscreen) {
            requestExamFullscreen();
          }
        }}
        className={
          !isReview
            ? 'fixed inset-0 z-50 bg-[#f0f4f8] overflow-y-auto p-2 md:p-6 select-none'
            : 'max-w-5xl mx-auto px-1 md:px-0 select-none'
        }
      >
      <div className="max-w-5xl mx-auto">
        {notice && (
          <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-amber-600" />
              <span>{notice.message}</span>
            </div>
            <button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700">
              <X size={14} />
            </button>
          </div>
        )}
        {/* Top Status Bar */}
        <div className="flex items-center justify-between bg-white p-2.5 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-slate-200 mb-3 md:mb-6 gap-2 md:gap-6">
          <div className="flex gap-3 md:gap-5 items-center w-full md:w-auto justify-between md:justify-start px-1 md:px-0">
            <div className="text-center">
              <div className="text-[8px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-0.5 md:mb-1">Câu hỏi</div>
              <div className="text-sm md:text-xl font-black text-slate-800 tracking-tight">
                {(currentIndex + 1).toString().padStart(2, '0')}
                <span className="text-slate-300 font-medium">/</span>
                {questions.length}
              </div>
            </div>
            <div className="w-px bg-slate-100 h-6 md:h-10"></div>
            <div className="text-center">
              <div className="text-[8px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-0.5 md:mb-1">Danh mục</div>
              <div className="text-[9px] md:text-xs font-bold bg-blue-50 text-blue-600 px-2 md:px-3 py-0.5 md:py-1 rounded-md md:rounded-lg border border-blue-100">
                {q.category.split(' ')[0]}
              </div>
            </div>
            {!isReview && (
              <>
                <div className="w-px bg-slate-100 h-6 md:h-10"></div>
                <div className="text-center">
                  <div className="text-[8px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-0.5 md:mb-1">Thời gian</div>
                  <div className="text-xs md:text-sm font-black text-slate-700 flex items-center gap-1">
                    <Clock size={13} className="text-blue-500" />
                    <span>{formatDuration(elapsedSeconds)}</span>
                  </div>
                </div>
                <div className="w-px bg-slate-100 h-6 md:h-10"></div>
                <div className="text-center" title="Hệ thống tự động phát hiện nếu bạn thoát Full màn hình, mở tab mới hoặc chuyển cửa sổ (Tối đa 3 lần)">
                  <div className="text-[8px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-0.5 md:mb-1">Vi phạm</div>
                  <div className={`text-[9px] md:text-xs font-black px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                    tabSwitchCount === 0
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                  }`}>
                    <ShieldAlert size={12} />
                    <span>{tabSwitchCount}/{MAX_TAB_VIOLATIONS}</span>
                  </div>
                </div>
                <div className="w-px bg-slate-100 h-6 md:h-10"></div>
                <button
                  type="button"
                  onClick={() => {
                    if (isNativeFullscreen) {
                      showToast('Đang khóa chế độ Toàn màn hình! Nếu bạn thoát Full màn hình (nhấn Esc), hệ thống sẽ tính 1 lần cảnh báo vi phạm.', 'info');
                    } else {
                      requestExamFullscreen();
                    }
                  }}
                  title={isNativeFullscreen ? 'Đang khóa Toàn màn hình (Thoát sẽ tính 1 lần vi phạm)' : 'Bấm để bật chế độ Toàn màn hình'}
                  className={`px-2.5 py-1.5 rounded-lg border text-[9px] md:text-xs font-black flex items-center gap-1.5 transition cursor-pointer ${
                    isNativeFullscreen
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-xs animate-pulse'
                  }`}
                >
                  <Maximize2 size={13} />
                  <span className="hidden sm:inline">{isNativeFullscreen ? 'Đã khóa Full' : 'Bật Full màn hình'}</span>
                </button>
              </>
            )}
            <div className="flex md:hidden flex-col items-end">
              <div className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Đã làm</div>
              <div className="text-[10px] font-bold text-blue-600">{answeredCount}/{questions.length}</div>
            </div>
          </div>

          <div className="flex-1 w-full md:px-8 hidden md:block">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                Đã hoàn thành: {answeredCount}/{questions.length} câu
              </span>
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
          
          <div className="hidden md:flex items-center gap-3 border-l pl-6 border-slate-100 shrink-0">
            <div className="text-right">
              <div className="text-[8px] text-slate-400 font-black uppercase tracking-widest">Thí sinh</div>
              <div className="text-xs font-bold text-slate-800 max-w-[140px] truncate">{studentInfo.name}</div>
            </div>
            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-black text-slate-500 text-[10px] shadow-inner">
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
                <div className="flex items-center justify-between mb-2 md:mb-6">
                  <h3 className="text-[9px] md:text-xs font-black text-blue-600 uppercase tracking-[0.2em]">
                    Câu hỏi số {currentIndex + 1}:
                  </h3>
                  {q.chapter && (
                    <span className="text-[9px] md:text-[10px] font-bold text-slate-400 truncate max-w-[220px] md:max-w-xs">
                      {q.chapter.split('.')[0]}
                    </span>
                  )}
                </div>

                <div className="text-base md:text-2xl leading-relaxed font-bold text-slate-800 mb-4 md:mb-10 overflow-x-auto max-w-full">
                  <MathText text={q.content} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-5 mt-auto">
                  {q.options.map((opt, i) => (
                    <button
                      key={i}
                      disabled={isReview}
                      onClick={() => !isReview && selectStudentChoice(currentIndex, i)}
                      className={`group p-3 md:p-6 rounded-xl md:rounded-2xl border-2 text-left transition-all flex items-start gap-3 md:gap-5 relative overflow-hidden cursor-pointer ${
                        isReview 
                          ? i === currentCorrectOption 
                            ? 'border-green-500 bg-green-50 text-green-900' 
                            : currentChosenOption === i 
                              ? 'border-red-500 bg-red-50 text-red-900' 
                              : 'border-slate-50 bg-slate-50/50'
                          : currentChosenOption === i 
                            ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-md shadow-blue-100' 
                            : 'border-slate-100 bg-slate-50/50 hover:border-slate-200 hover:bg-white hover:shadow-lg'
                      }`}
                    >
                      <div className={`w-7 h-7 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center font-black text-[10px] md:text-sm shrink-0 transition-all ${
                        isReview
                          ? i === currentCorrectOption 
                            ? 'bg-green-600 text-white shadow-lg shadow-green-200' 
                            : currentChosenOption === i 
                              ? 'bg-red-600 text-white shadow-lg shadow-red-200' 
                              : 'bg-slate-200 text-slate-500'
                          : currentChosenOption === i ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-slate-200 text-slate-500 group-hover:bg-slate-300'
                      }`}>
                        {String.fromCharCode(65 + i)}
                      </div>
                      <div className="mt-0.5 md:mt-2 text-xs md:text-lg font-bold tracking-tight overflow-x-auto max-w-full flex-1 min-w-0">
                        <MathText text={opt} />
                      </div>
                      {isReview && i === currentCorrectOption && (
                        <div className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 text-green-500">
                          <CheckCircle2 size={16} className="md:w-6 md:h-6" />
                        </div>
                      )}
                      {isReview && currentChosenOption === i && i !== currentCorrectOption && (
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
                  className="px-3 md:px-8 py-2 md:py-3 rounded-lg md:rounded-xl text-[9px] md:text-sm text-slate-500 font-bold hover:bg-slate-100 disabled:opacity-20 transition-all uppercase tracking-widest cursor-pointer"
                >
                  ← TRƯỚC
                </button>
                
                {currentIndex === questions.length - 1 && !isReview ? (
                  <button 
                    onClick={handleRequestSubmit}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 md:gap-3 px-5 md:px-10 py-2.5 md:py-4 bg-green-500 text-white rounded-xl md:rounded-2xl font-black text-[10px] md:text-base shadow-xl shadow-green-100 hover:bg-green-600 transition-all transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
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
                    className="flex items-center gap-2 md:gap-3 px-5 md:px-10 py-2.5 md:py-4 bg-blue-600 text-white rounded-xl md:rounded-2xl font-black text-[10px] md:text-base shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                  >
                    {currentIndex === questions.length - 1 ? 'KẾT QUẢ' : 'TIẾP THEO'} <ChevronRight size={14} className="md:w-5 md:h-5" />
                  </button>
                )}
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-3 flex flex-col gap-3 order-2 lg:order-2">
            <div className="bg-white p-3 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm mb-4">
              <div className="flex items-center justify-between mb-2 md:mb-4">
                <h4 className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Danh sách câu</h4>
                <span className="text-[10px] font-bold text-blue-600">{answeredCount}/{questions.length}</span>
              </div>
              <div className="grid grid-cols-8 lg:grid-cols-4 gap-1.5 md:gap-2">
                {questions.map((itemQ, i) => {
                  const chosenForI = getStudentChoice(i);
                  return (
                    <button
                      key={i}
                      onClick={() => setCurrentIndex(i)}
                      className={`w-full aspect-square rounded-lg md:rounded-xl font-black text-[10px] md:text-xs transition-all border flex items-center justify-center cursor-pointer ${
                        currentIndex === i ? 'bg-blue-600 text-white border-blue-600 shadow-md md:shadow-lg shadow-blue-200 scale-105' :
                        isReview
                          ? isStudentAnswerCorrect(itemQ, chosenForI)
                            ? 'bg-green-50 text-green-600 border-green-200' 
                            : 'bg-red-50 text-red-600 border-red-200'
                          : chosenForI !== undefined ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-400 border-slate-100'
                      }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>

              {!isReview && (
                <button
                  onClick={handleRequestSubmit}
                  disabled={isSubmitting}
                  className={`w-full mt-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer ${
                    answeredCount === questions.length
                      ? 'bg-green-500 text-white shadow-lg shadow-green-100 hover:bg-green-600'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Send size={13} />
                  <span>{isSubmitting ? 'Đang nộp...' : 'Nộp bài ngay'}</span>
                </button>
              )}

              {isReview && (
                <button
                  onClick={() => setCurrentStep('result')}
                  className="w-full mt-4 py-2.5 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-wider hover:bg-slate-800 transition cursor-pointer"
                >
                  Quay lại Kết quả
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Inline Unanswered Confirmation Modal */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                  <AlertCircle size={22} />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900">Chưa hoàn thành tất cả câu hỏi</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Bạn còn <strong className="text-rose-600">{unansweredIndices.length} câu chưa chọn đáp án</strong>:
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                {unansweredIndices.map(idx => (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setShowSubmitConfirm(false);
                    }}
                    className="px-2.5 py-1 bg-white border border-amber-300 text-amber-800 rounded-lg text-xs font-black hover:bg-amber-50 transition cursor-pointer"
                  >
                    Câu {idx + 1}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitConfirm(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Làm tiếp
                </button>
                <button
                  type="button"
                  onClick={() => executeSubmit()}
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl text-xs font-black bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-200 transition cursor-pointer"
                >
                  Vẫn nộp bài ngay
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Anti-Tab-Switch / New Browser Window / Exit Fullscreen Violation Lock Modal */}
        {showTabWarningModal && !isReview && (
          <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-3xl shadow-2xl border-2 border-rose-500 max-w-md w-full p-6 md:p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
                <ShieldAlert size={36} />
              </div>
              <div>
                <span className="inline-block px-3 py-1 bg-rose-100 text-rose-700 text-[10px] font-black uppercase tracking-widest rounded-full mb-2">
                  Cảnh báo vi phạm quy chế thi ({tabSwitchCount}/{MAX_TAB_VIOLATIONS})
                </span>
                <h4 className="text-lg md:text-xl font-black text-slate-900">
                  {violationReason}
                </h4>
                <p className="text-xs md:text-sm text-slate-600 mt-2 leading-relaxed font-medium">
                  Trong suốt thời gian làm bài, bạn bắt buộc phải giữ chế độ <strong>Toàn màn hình (Fullscreen)</strong> và không được mở tab/cửa sổ khác.
                </p>
              </div>

              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 font-bold text-left space-y-1">
                <div>• Số lần vi phạm hiện tại: <strong className="text-rose-600">{tabSwitchCount} / {MAX_TAB_VIOLATIONS} lần</strong></div>
                <div>• Mọi hành vi <strong>thoát Full màn hình (nhấn Esc)</strong> hoặc <strong>mở tab mới</strong> đều bị tính 1 lần cảnh báo.</div>
                <div>• Nếu vi phạm đủ <strong className="text-rose-600">{MAX_TAB_VIOLATIONS} lần</strong>, hệ thống sẽ <strong>tự động thu bài và chấm điểm ngay lập tức</strong>!</div>
              </div>

              <button
                type="button"
                onClick={() => {
                  requestExamFullscreen();
                  setShowTabWarningModal(false);
                }}
                className="w-full py-3.5 rounded-2xl text-xs md:text-sm font-black bg-rose-600 text-white hover:bg-rose-700 shadow-lg shadow-rose-200 transition uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
              >
                <Maximize2 size={16} /> Bật lại Full màn hình & Tiếp tục làm bài
              </button>
            </div>
          </div>
        )}
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
            ? 'Tuyệt vời! Bạn vừa hoàn thành bài luyện tập nhanh 16 câu hỏi.'
            : <span>Chúc mừng <span className="text-blue-600 uppercase">{studentInfo.name}</span> ({studentInfo.class}) đã hoàn thành.</span>}
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

        {autoSubmittedByViolation && (
          <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-bold text-rose-700 max-w-md mx-auto flex items-center justify-center gap-2">
            <ShieldAlert size={16} className="shrink-0 text-rose-600" />
            <span>Bài thi đã được hệ thống tự động thu do bạn rời màn hình / mở tab mới quá {MAX_TAB_VIOLATIONS} lần!</span>
          </div>
        )}

        <div className="bg-slate-50 p-3 md:p-5 rounded-lg md:rounded-xl border border-slate-100 mb-6 md:mb-8 inline-flex flex-wrap items-center justify-center gap-2 md:gap-4 mx-4">
          <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full ${score >= 5.0 ? 'bg-green-500' : 'bg-orange-500'}`}></div>
          <span className="text-[9px] md:text-sm font-black text-slate-600 uppercase tracking-widest leading-none">
            Đúng: <span className="text-slate-900">{correctCount}</span> / {questions.length} câu
          </span>
          <span className="text-slate-300">•</span>
          <span className="text-[9px] md:text-sm font-bold text-slate-500">
            ⏱️ {formatDuration(elapsedSeconds)}
          </span>
          {tabSwitchCount > 0 && (
            <>
              <span className="text-slate-300">•</span>
              <span className="text-[9px] md:text-xs font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                ⚠️ Rời tab: {tabSwitchCount} lần
              </span>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 lg:flex lg:flex-row gap-2 md:gap-3 justify-center px-2">
          <button 
            onClick={() => {
              setCurrentIndex(0);
              setCurrentStep('review');
            }}
            className="px-4 py-3 md:py-4 bg-blue-600 text-white rounded-lg md:rounded-xl font-black text-[10px] md:text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-100 uppercase tracking-wider cursor-pointer"
          >
            Xem lại bài
          </button>
          <button 
            onClick={async () => {
              sessionStorage.removeItem('quiz_current_questions_session');
              setEncryptedChoices({});
              setCurrentIndex(0);
              setScore(0);
              setCorrectCount(0);
              setElapsedSeconds(0);
              setTabSwitchCount(0);
              setShowTabWarningModal(false);
              setAutoSubmittedByViolation(false);
              setQuestions([]);
              if (isQuickPractice) {
                setLoadingQuestions(true);
                const success = await fetchAndRandomize(quickPracticeChapter, true);
                if (success) {
                  setStartTime(new Date());
                  setCurrentStep('doing');
                }
              } else {
                // Keep studentInfo (school, class, name) intact so the student doesn't have to re-type!
                setCurrentStep('info');
              }
            }}
            className="px-4 py-3 md:py-4 bg-slate-900 text-white rounded-lg md:rounded-xl font-black text-[10px] md:text-xs hover:bg-slate-800 transition shadow-lg shadow-slate-100 uppercase tracking-wider cursor-pointer"
          >
            {isQuickPractice ? 'Luyện đề khác' : 'Làm đề mới'}
          </button>
          <button 
            onClick={onBack}
            className="col-span-2 lg:col-span-1 px-4 py-3 md:py-4 bg-white text-slate-500 border border-slate-200 rounded-lg md:rounded-xl font-black text-[10px] md:text-xs hover:bg-slate-50 transition uppercase tracking-wider cursor-pointer"
          >
            Trang chủ
          </button>
        </div>
      </div>
    );
  }

  return null;
}
