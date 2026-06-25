import React, { useState, useEffect } from 'react';
import { db, Question, QuizResult, handleFirestoreError, OperationType, PART_CHAPTERS } from '../lib/firebase';
import { collection, addDoc, getDocs, query, deleteDoc, doc, Timestamp, orderBy, writeBatch, updateDoc, setDoc, getDoc, limit, where } from 'firebase/firestore';
import { Trash2, Plus, RefreshCw, LogOut, FileText, BarChart2, Settings, FileJson, FileCode, FileType, Download, Edit2 } from 'lucide-react';
import MathText from './MathText';
import * as XLSX from 'xlsx';
import { parseWordToQuiz, ParsedQuestion } from '../utils/wordParser';
import QuizPreview from './QuizPreview';
import { solveQuestion } from '../services/geminiService';

export default function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'questions' | 'stats'>('questions');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<ParsedQuestion[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [newQuestion, setNewQuestion] = useState<Omit<Question, 'id'>>({
    content: '',
    options: ['', '', '', ''],
    correctAnswer: 0,
    category: 'Số và Đại số',
    chapter: ''
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteResultId, setConfirmDeleteResultId] = useState<string | null>(null);
  const [isConfirmingDeleteAllResults, setIsConfirmingDeleteAllResults] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [isQuickEdit, setIsQuickEdit] = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [pendingUpdates, setPendingUpdates] = useState<Question[]>([]);
  const [filterChapter, setFilterChapter] = useState('Tất cả');
  const [filterCategory, setFilterCategory] = useState('Tất cả');
  const [filterSchool, setFilterSchool] = useState('Tất cả');
  const [filterClass, setFilterClass] = useState('Tất cả');
  const hasChanges = pendingDeletes.length > 0 || pendingUpdates.length > 0;
  const [metadata, setMetadata] = useState<any>(null);

  useEffect(() => {
    fetchMetadataAndResults();
  }, []);

  useEffect(() => {
    if (filterCategory === 'Tất cả' && filterChapter === 'Tất cả') {
      setQuestions([]);
    } else {
      fetchQuestionsOnDemand(filterCategory, filterChapter);
    }
  }, [filterCategory, filterChapter]);

  useEffect(() => {
    if (filterSchool === 'Tất cả' && filterClass === 'Tất cả') {
      setResults([]);
    } else {
      fetchResultsOnDemand(filterSchool, filterClass);
    }
  }, [filterSchool, filterClass]);

  const fetchMetadataAndResults = async () => {
    setLoading(true);
    try {
      const metaDoc = await getDoc(doc(db, 'metadata', 'questions'));
      if (metaDoc.exists()) {
        const data = metaDoc.data();
        setMetadata(data);
      } else {
        console.log("Metadata not found. Generating initial metadata...");
        await fetchAllQuestionsAndSync();
      }
    } catch (e) {
      console.log("Failed to load metadata, falling back:", e);
      await fetchAllQuestionsAndSync();
    } finally {
      setLoading(false);
    }
  };

  const fetchAllQuestionsAndSync = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'questions'));
      const qs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
      const lists = {
        'Số và Đại số': qs.filter((q) => q.category === 'Số và Đại số').map((q) => q.id),
        'Hình học và Đo lường': qs.filter((q) => q.category === 'Hình học và Đo lường').map((q) => q.id),
        'Thống kê và Xác suất': qs.filter((q) => q.category === 'Thống kê và Xác suất').map((q) => q.id),
        'allQuestions': qs.map((q) => ({
          id: q.id,
          chapter: q.chapter || '',
          category: q.category || ''
        }))
      };
      await setDoc(doc(db, 'metadata', 'questions'), lists);
      setMetadata(lists);
      localStorage.removeItem('quiz_metadata_ids');
      console.log('Metadata initialized with', qs.length, 'questions');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'metadata/questions');
    }
  };

  const fetchQuestionsOnDemand = async (cat: string, chap: string) => {
    setLoading(true);
    try {
      let q;
      if (chap !== 'Tất cả') {
        q = query(
          collection(db, 'questions'), 
          where('chapter', '==', chap),
          orderBy('createdAt', 'desc')
        );
      } else if (cat !== 'Tất cả') {
        q = query(
          collection(db, 'questions'), 
          where('category', '==', cat),
          orderBy('createdAt', 'desc')
        );
      } else {
        setQuestions([]);
        setLoading(false);
        return;
      }

      const snapshot = await getDocs(q);
      const qs = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Question));
      setQuestions(qs);
    } catch (e) {
      console.log("Ordered on-demand fetch failed, trying without order (safe fallback):", e);
      try {
        let q;
        if (chap !== 'Tất cả') {
          q = query(collection(db, 'questions'), where('chapter', '==', chap));
        } else if (cat !== 'Tất cả') {
          q = query(collection(db, 'questions'), where('category', '==', cat));
        } else {
          setQuestions([]);
          setLoading(false);
          return;
        }
        const snapshot = await getDocs(q);
        let qs = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Question));
        
        // Sort in memory
        qs.sort((a, b) => {
          const getTime = (val: any) => {
            if (!val) return 0;
            if (typeof val.toMillis === 'function') return val.toMillis();
            if (val instanceof Date) return val.getTime();
            if (typeof val === 'string' || typeof val === 'number') return new Date(val).getTime();
            return 0;
          };
          return getTime(b.createdAt) - getTime(a.createdAt);
        });
        setQuestions(qs);
      } catch (err2) {
        handleFirestoreError(err2, OperationType.GET, 'questions');
      }
    } finally {
      setLoading(false);
    }
  };

  const syncMetadata = async () => {
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'questions'));
      const qs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question));
      const lists = {
        'Số và Đại số': qs.filter((q) => q.category === 'Số và Đại số').map((q) => q.id),
        'Hình học và Đo lường': qs.filter((q) => q.category === 'Hình học và Đo lường').map((q) => q.id),
        'Thống kê và Xác suất': qs.filter((q) => q.category === 'Thống kê và Xác suất').map((q) => q.id),
        'allQuestions': qs.map((q) => ({
          id: q.id,
          chapter: q.chapter || '',
          category: q.category || ''
        }))
      };
      await setDoc(doc(db, 'metadata', 'questions'), lists);
      setMetadata(lists);
      localStorage.removeItem('quiz_metadata_ids');
      alert('Đã đồng bộ hóa danh mục câu hỏi (Metadata) thành công!');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'metadata/questions');
    } finally {
      setLoading(false);
    }
  };

  const syncMetadataIncremental = async (
    added?: Question[],
    updated?: Question[],
    deletedIds?: string[]
  ) => {
    try {
      const metaDocRef = doc(db, 'metadata', 'questions');
      let currentMeta = metadata;
      if (!currentMeta) {
        const metaDoc = await getDoc(metaDocRef);
        if (metaDoc.exists()) {
          currentMeta = metaDoc.data();
        }
      }

      if (!currentMeta) {
        await fetchAllQuestionsAndSync();
        return;
      }

      let algebra = [...(currentMeta['Số và Đại số'] || [])];
      let geometry = [...(currentMeta['Hình học và Đo lường'] || [])];
      let statsList = [...(currentMeta['Thống kê và Xác suất'] || [])];
      let allQs = [...(currentMeta['allQuestions'] || [])];

      if (deletedIds && deletedIds.length > 0) {
        const delSet = new Set(deletedIds);
        algebra = algebra.filter(id => !delSet.has(id));
        geometry = geometry.filter(id => !delSet.has(id));
        statsList = statsList.filter(id => !delSet.has(id));
        allQs = allQs.filter((q: any) => !delSet.has(q.id));
      }

      if (added && added.length > 0) {
        added.forEach(q => {
          const id = q.id!;
          const cat = q.category;
          const chap = q.chapter || '';

          if (cat === 'Số và Đại số' && !algebra.includes(id)) algebra.push(id);
          if (cat === 'Hình học và Đo lường' && !geometry.includes(id)) geometry.push(id);
          if (cat === 'Thống kê và Xác suất' && !statsList.includes(id)) statsList.push(id);

          if (!allQs.some((item: any) => item.id === id)) {
            allQs.push({ id, category: cat, chapter: chap });
          }
        });
      }

      if (updated && updated.length > 0) {
        updated.forEach(upd => {
          const id = upd.id!;
          const newCat = upd.category;
          const newChap = upd.chapter || '';

          const oldQ = allQs.find((q: any) => q.id === id);
          if (oldQ) {
            const oldCat = oldQ.category;
            if (oldCat !== newCat) {
              if (oldCat === 'Số và Đại số') algebra = algebra.filter(i => i !== id);
              if (oldCat === 'Hình học và Đo lường') geometry = geometry.filter(i => i !== id);
              if (oldCat === 'Thống kê và Xác suất') statsList = statsList.filter(i => i !== id);

              if (newCat === 'Số và Đại số' && !algebra.includes(id)) algebra.push(id);
              if (newCat === 'Hình học và Đo lường' && !geometry.includes(id)) geometry.push(id);
              if (newCat === 'Thống kê và Xác suất' && !statsList.includes(id)) statsList.push(id);
            }
          }

          allQs = allQs.map((q: any) => {
            if (q.id === id) {
              return { id, category: newCat, chapter: newChap };
            }
            return q;
          });
        });
      }

      const updatedLists = {
        'Số và Đại số': algebra,
        'Hình học và Đo lường': geometry,
        'Thống kê và Xác suất': statsList,
        'allQuestions': allQs
      };

      await setDoc(metaDocRef, updatedLists);
      setMetadata(updatedLists);
      localStorage.removeItem('quiz_metadata_ids');
    } catch (err) {
      console.error("Incremental metadata sync failed:", err);
    }
  };

  const fetchResultsOnDemand = async (school: string, className: string) => {
    setLoading(true);
    try {
      let q;
      if (school !== 'Tất cả' && className !== 'Tất cả') {
        q = query(
          collection(db, 'results'),
          where('school', '==', school),
          where('class', '==', className),
          orderBy('submittedAt', 'desc'),
          limit(300)
        );
      } else if (school !== 'Tất cả') {
        q = query(
          collection(db, 'results'),
          where('school', '==', school),
          orderBy('submittedAt', 'desc'),
          limit(300)
        );
      } else if (className !== 'Tất cả') {
        q = query(
          collection(db, 'results'),
          where('class', '==', className),
          orderBy('submittedAt', 'desc'),
          limit(300)
        );
      } else {
        setResults([]);
        setLoading(false);
        return;
      }

      const snapshot = await getDocs(q);
      setResults(snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as QuizResult)));
    } catch (e) {
      console.log("Ordered results fetch failed, falling back to simple query and in-memory sort:", e);
      try {
        let q;
        if (school !== 'Tất cả' && className !== 'Tất cả') {
          q = query(collection(db, 'results'), where('school', '==', school));
        } else if (school !== 'Tất cả') {
          q = query(collection(db, 'results'), where('school', '==', school));
        } else if (className !== 'Tất cả') {
          q = query(collection(db, 'results'), where('class', '==', className));
        } else {
          setResults([]);
          setLoading(false);
          return;
        }

        const snapshot = await getDocs(q);
        let rs = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as QuizResult));

        if (school !== 'Tất cả' && className !== 'Tất cả') {
          rs = rs.filter(r => r.class === className);
        }

        // Sort in memory by submittedAt descending
        rs.sort((a, b) => {
          const getTime = (val: any) => {
            if (!val) return 0;
            if (typeof val.toDate === 'function') return val.toDate().getTime();
            if (val instanceof Date) return val.getTime();
            return new Date(val).getTime();
          };
          return getTime(b.submittedAt) - getTime(a.submittedAt);
        });

        setResults(rs);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'results');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      let finalQuestion = { ...newQuestion };
      let correctIdx = -1;

      // Detect * marker in manual options
      const processedOptions = finalQuestion.options.map((opt, i) => {
        let text = opt.trim();
        if (text.startsWith('*')) {
          correctIdx = i;
          // Loại bỏ dấu *
          text = text.substring(1).trim();
          // Loại bỏ tiếp nhãn A. B. C. D. nếu người dùng nhập thừa (vd: *A. Nội dung)
          const labelPrefix = new RegExp(`^[A-D]\\s*[:.]\\s*`, 'i');
          text = text.replace(labelPrefix, '').trim();
          return text;
        }
        return text;
      });

      finalQuestion.options = processedOptions;
      
      // If * found, use it. Otherwise use the radio button state (correctAnswer)
      if (correctIdx !== -1) {
        finalQuestion.correctAnswer = correctIdx;
      }

      // If no answer selected (using a negative number or if user didn't pick)
      // or if we want AI to double check if nothing is explicitly marked
      // Here, we'll only trigger AI if correctIdx is -1 and current correctAnswer is 0 (default) but maybe unsure
      // Actually, let's keep it simple: if no '*' and user didn't change default (maybe?) 
      // User said: "câu nào không có đáp án thì AI tự cho đáp án dúng"
      // In manual form, we can't easily tell if 0 is "no answer" or "Answer A".
      // Let's assume if there's no '*' AND user wants AI to check? 
      // Maybe I should add an "AI Solve" button or just do it if they haven't explicitly marked it.
      // But Word upload is the primary case for "questions without answers".

      if (editId) {
        const updatedQuestion = { ...finalQuestion, id: editId, updatedAt: Timestamp.now() } as Question;
        setPendingUpdates(prev => {
          const filtered = prev.filter(p => p.id !== editId);
          return [...filtered, updatedQuestion];
        });
        
        const updatedQuestions = questions.map(q => q.id === editId ? updatedQuestion : q);
        setQuestions(updatedQuestions);
        setEditId(null);
      } else {
        try {
          const docRef = await addDoc(collection(db, 'questions'), {
            ...finalQuestion,
            createdAt: Timestamp.now()
          });
          const addedQ = { id: docRef.id, ...finalQuestion, createdAt: new Date() } as Question;
          const newQuestions = [...questions, addedQ];
          setQuestions(newQuestions);
          await syncMetadataIncremental([addedQ], [], []);
          alert('Đã thêm câu hỏi thành công!');
        } catch (errAdd) {
          handleFirestoreError(errAdd, OperationType.WRITE, 'questions');
        }
      }
      setNewQuestion({
        content: '',
        options: ['', '', '', ''],
        correctAnswer: 0,
        category: 'Số và Đại số',
        chapter: ''
      });
      setShowAddForm(false);
    } catch (e) {
      alert('Lỗi: ' + (editId ? 'Không thể cập nhật' : 'Không thể thêm') + ' câu hỏi.');
    }
    setLoading(false);
  };

  const handleEditClick = (q: Question) => {
    setNewQuestion({
      content: q.content,
      options: [...q.options],
      correctAnswer: q.correctAnswer,
      category: q.category,
      chapter: q.chapter || ''
    });
    setEditId(q.id!);
    setShowAddForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [isDeletingPool, setIsDeletingPool] = useState(false);
  const [isDeletingChapter, setIsDeletingChapter] = useState(false);

  const handleSaveAllChanges = async () => {
    if (!hasChanges) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      // Xử lý xóa
      pendingDeletes.forEach(id => {
        batch.delete(doc(db, 'questions', id));
      });
      
      // Xử lý cập nhật
      pendingUpdates.forEach(q => {
        const { id, ...data } = q;
        batch.update(doc(db, 'questions', id!), { ...data });
      });
      
      await batch.commit();
      await syncMetadataIncremental([], pendingUpdates, pendingDeletes);
      
      setPendingDeletes([]);
      setPendingUpdates([]);
      alert(`Đã lưu thành công: Xóa ${pendingDeletes.length} câu, Cập nhật ${pendingUpdates.length} câu.`);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'questions');
    }
    setLoading(false);
  };

  const handleRefreshPool = async () => {
    // Không dùng window.confirm vì có thể bị trình duyệt chặn trong iframe
    if (!isDeletingPool) {
      setIsDeletingPool(true);
      return;
    }
    
    setLoading(true);
    try {
      console.log("Attempting to delete entire pool...");
      const snapshot = await getDocs(collection(db, 'questions'));
      const count = snapshot.size;
      
      if (count === 0) {
        alert('Kho đề hiện tại đã trống.');
        setIsDeletingPool(false);
        setLoading(false);
        return;
      }

      const docs = snapshot.docs;
      for (let i = 0; i < docs.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 500);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      
      setQuestions([]);
      const emptyMeta = {
        'Số và Đại số': [],
        'Hình học và Đo lường': [],
        'Thống kê và Xác suất': [],
        'allQuestions': []
      };
      await setDoc(doc(db, 'metadata', 'questions'), emptyMeta);
      setMetadata(emptyMeta);
      alert('Đã xóa toàn bộ kho đề.');
    } catch (e: any) {
      handleFirestoreError(e, OperationType.DELETE, 'questions');
    }
    setIsDeletingPool(false);
    setLoading(false);
  };

  const handleDeleteChapter = async () => {
    if (filterChapter === 'Tất cả') {
      alert('Vui lòng chọn một chương cụ thể trong ô chọn để xóa câu hỏi của chương đó.');
      setIsDeletingChapter(false);
      return;
    }
    if (!isDeletingChapter) {
      setIsDeletingChapter(true);
      return;
    }
    
    setLoading(true);
    try {
      const targetChap = filterChapter.trim();
      const docsToDelete = questions.filter(q => q.chapter?.trim() === targetChap);
      
      if (docsToDelete.length === 0) {
        alert(`Chương "${filterChapter}" không có câu hỏi nào để xóa.`);
        setIsDeletingChapter(false);
        setLoading(false);
        return;
      }
      
      const batchSize = 500;
      for (let i = 0; i < docsToDelete.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = docsToDelete.slice(i, i + batchSize);
        chunk.forEach(q => {
          if (q.id) {
            batch.delete(doc(db, 'questions', q.id));
          }
        });
        await batch.commit();
      }
      
      const remainingQuestions = questions.filter(q => q.chapter?.trim() !== targetChap);
      setQuestions(remainingQuestions);
      
      const deletedIds = docsToDelete.map(q => q.id).filter((id): id is string => !!id);
      setPendingDeletes(prev => prev.filter(id => !deletedIds.includes(id)));
      setPendingUpdates(prev => prev.filter(q => !deletedIds.includes(q.id!)));
      
      await syncMetadataIncremental([], [], deletedIds);
      alert(`Đã xóa thành công ${docsToDelete.length} câu hỏi thuộc chương "${filterChapter}".`);
      setFilterChapter('Tất cả');
    } catch (e: any) {
      handleFirestoreError(e, OperationType.DELETE, `questions/chapter/${filterChapter}`);
    }
    setIsDeletingChapter(false);
    setLoading(false);
  };

  const handleDeleteResults = async () => {
    if (!isConfirmingDeleteAllResults) {
      setIsConfirmingDeleteAllResults(true);
      return;
    }
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'results'));
      if (snapshot.size > 0) {
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += 500) {
          const batch = writeBatch(db);
          const chunk = docs.slice(i, i + 500);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      setResults([]);
      setIsConfirmingDeleteAllResults(false);
      alert('Đã reset toàn bộ bảng thống kê!');
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'results');
    }
    setLoading(false);
  };

  const handleDeleteResult = async (id: string) => {
    if (confirmDeleteResultId !== id) {
      setConfirmDeleteResultId(id);
      setTimeout(() => setConfirmDeleteResultId(curr => curr === id ? null : curr), 4000);
      return;
    }
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'results', id));
      setResults(prev => prev.filter(r => r.id !== id));
      setConfirmDeleteResultId(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `results/${id}`);
    }
    setLoading(false);
  };

  const handleSmartUpload = async (category: string) => {
    // Read the chosen chapter from the selection element under this category
    const selectElem = document.getElementById(`upload-chapter-${category}`) as HTMLSelectElement;
    const selectedUploadChapter = selectElem?.value || '';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      
      if (files.length > 5) {
        alert('Bạn chỉ có thể tải lên tối đa 5 file một lúc. 5 file đầu tiên sẽ được xử lý.');
      }
      
      const selectedFiles = files.slice(0, 5);
      setLoading(true);
      try {
        let allParsed: ParsedQuestion[] = [];
        for (const file of selectedFiles as File[]) {
          const parsed = await parseWordToQuiz(file, category);
          const tagged = parsed.map(p => ({ ...p, chapter: selectedUploadChapter || '' }));
          allParsed = [...allParsed, ...tagged];
        }
        
        if (allParsed.length > 0) {
          setPreviewQuestions(allParsed);
          setShowPreview(true);
        } else {
          alert('Không tìm thấy câu hỏi nào trong các file đã chọn.');
        }
      } catch (err) {
        console.error(err);
        alert('Lỗi xử lý một hoặc nhiều file Word.');
      }
      setLoading(false);
    };
    input.click();
  };

  const confirmSaveQuestions = async () => {
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      let addedQuestions: Question[] = [];
      let newLocalQuestions: Question[] = [];
      if (isQuickEdit) {
        previewQuestions.forEach(q => {
          if (q.id) {
            batch.update(doc(db, 'questions', q.id), {
              correctAnswer: q.correctAnswer,
              updatedAt: Timestamp.now()
            });
          }
        });
        
        const previewMap = new Map<string, Question>(previewQuestions.filter(q => !!q.id).map(q => [q.id!, q as any]));
        newLocalQuestions = questions.map(q => {
          if (q.id && previewMap.has(q.id)) {
            return { ...q, correctAnswer: previewMap.get(q.id)!.correctAnswer };
          }
          return q;
        });

      } else {
        previewQuestions.forEach(q => {
          const docRef = doc(collection(db, 'questions'));
          const qChapter = (q as any).chapter || '';
          batch.set(docRef, {
            content: q.content,
            options: q.options,
            correctAnswer: q.correctAnswer,
            category: q.category,
            chapter: qChapter,
            createdAt: Timestamp.now()
          });
          addedQuestions.push({
            id: docRef.id,
            content: q.content,
            options: q.options,
            correctAnswer: q.correctAnswer,
            category: q.category,
            chapter: qChapter,
            createdAt: new Date()
          } as Question);
        });
        newLocalQuestions = [...addedQuestions, ...questions];
      }
      
      await batch.commit();
      setShowPreview(false);
      setPreviewQuestions([]);
      
      if (isQuickEdit) {
        await syncMetadataIncremental([], previewQuestions.map(q => q as Question), []);
      } else {
        await syncMetadataIncremental(addedQuestions, [], []);
      }
      setIsQuickEdit(false);
      setQuestions(newLocalQuestions);
      
      alert(isQuickEdit ? `Đã cập nhật ${previewQuestions.length} đáp án!` : `Đã lưu thành công ${previewQuestions.length} câu hỏi!`);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'questions');
    }
    setLoading(false);
  };

  const handleQuickEditAnswers = (category?: string) => {
    let targetQuestions = questions;
    if (category && category !== 'Tất cả') {
      targetQuestions = questions.filter(q => q.category === category);
    } else {
      targetQuestions = filteredQuestions;
    }

    if (targetQuestions.length === 0) {
      alert('Không có câu hỏi để chỉnh sửa!');
      return;
    }
    
    setPreviewQuestions(targetQuestions as ParsedQuestion[]);
    setIsQuickEdit(true);
    setShowPreview(true);
  };

  const handleFileUpload = async (category: string, type: 'json' | 'txt') => {
    // Read the chosen chapter from the selection element under this category
    const selectElem = document.getElementById(`upload-chapter-${category}`) as HTMLSelectElement;
    const selectedUploadChapter = selectElem?.value || '';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'json' ? '.json' : '.txt';
    input.multiple = true;
    input.onchange = async (e: any) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      
      if (files.length > 5) {
        alert('Bạn chỉ có thể tải lên tối đa 5 file một lúc. 5 file đầu tiên sẽ được xử lý.');
      }
      
      const selectedFiles = files.slice(0, 5);
      setLoading(true);
      try {
        let allParsed: ParsedQuestion[] = [];
        for (const file of selectedFiles as File[]) {
          const text = await file.text();
          let parsed: ParsedQuestion[] = [];
          
          if (type === 'json') {
            parsed = JSON.parse(text).map((q: any) => ({ ...q, category, chapter: selectedUploadChapter || q.chapter || '' }));
          } else {
            // Xử lý TXT đơn giản theo dòng
            const lines = text.split('\n').filter(l => l.trim());
            for (let i = 0; i < lines.length; i += 6) {
               if (lines[i]) {
                  parsed.push({
                     content: lines[i],
                     options: [lines[i+1], lines[i+4] ? lines[i+2] : '', lines[i+4] ? lines[i+3] : '', lines[i+4] ? lines[i+4] : ''], // Basic guard
                     correctAnswer: parseInt(lines[i+5]) || 0,
                     category,
                     chapter: selectedUploadChapter || ''
                  } as ParsedQuestion);
               }
            }
          }
          allParsed = [...allParsed, ...parsed];
        }
        
        if (allParsed.length > 0) {
          setPreviewQuestions(allParsed);
          setShowPreview(true);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ trong các file đã chọn.');
        }
      } catch (err) {
        alert('Lỗi xử lý file.');
      }
      setLoading(false);
    };
    input.click();
  };

  const handleExportExcel = () => {
    if ((results || []).length === 0) {
      alert('Không có dữ liệu để xuất!');
      return;
    }

    const data = results.map((r, idx) => ({
      'STT': idx + 1,
      'Thời gian': r.submittedAt && typeof (r.submittedAt as any).toDate === 'function' 
        ? (r.submittedAt as Timestamp).toDate().toLocaleString('vi-VN') 
        : 'N/A',
      'Lớp': r.class,
      'Trường': r.school || 'N/A',
      'Họ và Tên': r.name,
      'Điểm (Thang 10)': r.score.toFixed(1),
      'Số câu đúng': `${r.correctCount}/${r.totalQuestions || 16}`,
      'Phần/Chương ôn tập': r.chapter || 'Thi tổng hợp'
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "KetQuaHocSinh");
    
    const fileName = `ThongKe_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const handleDownloadWord = () => {
    let target = questions;
    if (filterCategory !== 'Tất cả') target = target.filter(q => q.category === filterCategory);
    if (filterChapter !== 'Tất cả') target = target.filter(q => q.chapter === filterChapter);

    if (target.length === 0) {
      alert("Không có câu hỏi nào để tải.");
      return;
    }

    let htmlContent = `<div style="font-family: 'Times New Roman', serif; font-size: 14pt;">`;
    target.forEach((q, idx) => {
      let content = q.content || '';
      content = content.replace(/\n/g, '<br/>');
      
      htmlContent += `<p><b>Câu ${idx + 1}:</b> ${content}</p>`;
      
      (q.options || []).forEach((opt, oIdx) => {
        let optText = opt || '';
        optText = optText.replace(/\n/g, '<br/>');
        const isCorrect = q.correctAnswer === oIdx;
        const prefix = isCorrect ? '*' : '';
        htmlContent += `<p>${prefix}${String.fromCharCode(65 + oIdx)}. ${optText}</p>`;
      });
      
      htmlContent += `<br/>`;
    });
    htmlContent += `</div>`;

    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export</title></head><body>";
    const footer = "</body></html>";
    const sourceHTML = header + htmlContent + footer;

    const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const fileDownload = document.createElement("a");
    fileDownload.href = url;
    
    const suffixName = filterChapter !== 'Tất cả' 
      ? filterChapter.replace(/\s+/g, '_') 
      : filterCategory !== 'Tất cả' 
        ? filterCategory.replace(/\s+/g, '_') 
        : 'Tong_Hop';
    fileDownload.download = `Kho_De_${suffixName}.doc`;
    document.body.appendChild(fileDownload);
    fileDownload.click();
    document.body.removeChild(fileDownload);
    URL.revokeObjectURL(url);
  };

  const [searchTerm, setSearchTerm] = useState('');

  const filteredQuestions = (questions || []).filter(q => 
    (filterCategory === 'Tất cả' || q.category === filterCategory) &&
    (filterChapter === 'Tất cả' || q.chapter === filterChapter) &&
    ((q.content || '').toLowerCase().includes((searchTerm || '').toLowerCase()))
  );

  const filteredResults = (results || []).filter(r => {
    const matchesSearch = (r.name || '').toLowerCase().includes((searchTerm || '').toLowerCase()) || 
                          (r.class || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
                          (r.school || '').toLowerCase().includes((searchTerm || '').toLowerCase());
    const matchesSchool = filterSchool === 'Tất cả' || r.school === filterSchool;
    const matchesClass = filterClass === 'Tất cả' || r.class === filterClass;
    return matchesSearch && matchesSchool && matchesClass;
  });

  const stats = {
    algebra: metadata ? (metadata['Số và Đại số'] || []).length : 0,
    geometry: metadata ? (metadata['Hình học và Đo lường'] || []).length : 0,
    stats: metadata ? (metadata['Thống kê và Xác suất'] || []).length : 0,
    avgScore: (filteredResults || []).length > 0 ? ((filteredResults || []).reduce((acc, r) => acc + (r?.score || 0), 0) / (filteredResults || []).length).toFixed(1) : '0'
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col shrink-0">
        <div className="p-8 pb-4">
           <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-xl">Σ</div>
              <span className="text-xl font-bold tracking-tight">ADMIN</span>
           </div>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => setActiveTab('questions')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'questions' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5'}`}
          >
            <FileText size={18} /> Ngân hàng câu hỏi
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'stats' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5'}`}
          >
            <BarChart2 size={18} /> Kết quả học sinh
          </button>
        </nav>

        <div className="p-6 border-t border-white/10">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center text-[10px] font-black border border-white/10">GL</div>
              <div className="flex-1 truncate">
                 <div className="text-xs font-bold truncate">legialoi</div>
                 <div className="text-[10px] text-slate-500 font-black uppercase">Chủ sở hữu</div>
              </div>
           </div>
           <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500 hover:text-white transition-all text-xs font-bold">
              <LogOut size={14} /> ĐĂNG XUẤT
           </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-10 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-tight">
            {activeTab === 'questions' ? 'Quản lý kho câu hỏi' : 'Thống kê kết quả thi'}
          </h2>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input 
                type="text" 
                placeholder="Tìm kiếm..."
                className="pl-8 pr-3 py-1 bg-slate-100 border-none rounded-full text-[10px] font-medium w-48 focus:ring-2 focus:ring-blue-500 outline-none"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <Settings size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
            {activeTab === 'questions' ? (
              <div key="q" className="space-y-2">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {[
                    { label: 'Số & Đại số', value: stats.algebra, color: 'bg-blue-500', icon: 'Σ', category: 'Số và Đại số' },
                    { label: 'Hình học', value: stats.geometry, color: 'bg-indigo-500', icon: 'Δ', category: 'Hình học và Đo lường' },
                    { label: 'Thống kê', value: stats.stats, color: 'bg-violet-500', icon: '%', category: 'Thống kê và Xác suất' },
                  ].map((s, i) => (
                    <div 
                      key={i} 
                      onClick={() => { setFilterCategory(s.category); setFilterChapter('Tất cả'); }}
                      className={`bg-white p-2 rounded-xl border transition-all cursor-pointer hover:border-blue-300 hover:shadow-md ${filterCategory === s.category ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200'} shadow-sm flex flex-col gap-1.5`}
                    >
                      <div className="flex items-center justify-between">
                         <div>
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-0.5">{s.label}</p>
                            <p className="text-lg font-black text-slate-800 leading-none">{s.value} <span className="text-[8px] font-bold text-slate-300">Câu</span></p>
                         </div>
                         <div className={`w-6 h-6 ${s.color} rounded-md flex items-center justify-center text-white font-black text-xs shadow-sm`}>{s.icon}</div>
                      </div>

                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <select 
                          id={`upload-chapter-${s.category}`}
                          className="w-full text-[9px] font-bold py-1 px-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer"
                        >
                          <option value="">-- Phân theo chương khi tải --</option>
                          {(PART_CHAPTERS[s.category] || []).map((chap, idx) => (
                             <option key={idx} value={chap}>{chap}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div className="flex gap-1 pt-1 border-t border-slate-50" onClick={(e) => e.stopPropagation()}>
                         <button 
                            onClick={() => handleSmartUpload(s.category)}
                            title="Upload Word (.docx)"
                            className="flex-1 flex items-center justify-center gap-1 p-1 bg-slate-50 rounded-md hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-all border border-transparent hover:border-blue-100"
                         >
                            <FileType size={11} />
                            <span className="text-[7px] font-black uppercase">Word</span>
                         </button>
                         <button 
                            onClick={() => handleFileUpload(s.category, 'json')}
                            title="Upload JSON (.json)"
                            className="flex-1 flex items-center justify-center gap-1 p-1 bg-slate-50 rounded-md hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-all border border-transparent hover:border-amber-100"
                         >
                            <FileJson size={11} />
                            <span className="text-[7px] font-black uppercase">JSON</span>
                         </button>
                         <button 
                            onClick={() => handleFileUpload(s.category, 'txt')}
                            title="Upload Text (.txt)"
                            className="flex-1 flex items-center justify-center gap-1 p-1 bg-slate-50 rounded-md hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-all border border-transparent hover:border-emerald-100"
                         >
                            <FileCode size={11} />
                            <span className="text-[7px] font-black uppercase">TEXT</span>
                         </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row gap-2 items-center justify-between bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
                   <div className="flex gap-1.5 shrink-0 overflow-x-auto pb-1 md:pb-0">
                      <button onClick={() => setShowAddForm(!showAddForm)} className="bg-blue-600 text-white px-2.5 py-1.5 rounded-lg font-bold text-[10px] flex items-center gap-1.5 hover:bg-blue-700 shadow shadow-blue-200 transition shrink-0">
                        <Plus size={14} /> Thêm thủ công
                      </button>
                      <button onClick={() => handleQuickEditAnswers()} className="bg-emerald-600 text-white px-2.5 py-1.5 rounded-lg font-bold text-[10px] flex items-center gap-1.5 hover:bg-emerald-700 shadow shadow-emerald-200 transition shrink-0">
                        <Edit2 size={14} /> Sửa đáp án {filterCategory !== 'Tất cả' ? `(${filterCategory.split(' ')[0]})` : ''}
                      </button>
                      <button 
                        onClick={() => syncMetadata()}
                        title="Đồng bộ Metadata (Tối ưu tải trang)"
                        className="px-2.5 py-1.5 bg-slate-100 text-slate-500 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-all border border-transparent hover:border-blue-100 font-bold text-[10px] flex items-center gap-1.5"
                      >
                        <RefreshCw size={14} /> Đồng bộ
                      </button>
                      <div className="flex bg-slate-100 p-0.5 rounded-lg shrink-0">
                        {['Tất cả', 'Số và Đại số', 'Hình học và Đo lường', 'Thống kê và Xác suất'].map(cat => (
                          <button 
                            key={cat}
                            onClick={() => { setFilterCategory(cat); setFilterChapter('Tất cả'); }}
                            className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase transition-all ${filterCategory === cat ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                          >
                            {cat === 'Tất cả' ? 'Tất cả' : cat.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                      <select
                        value={filterChapter}
                        onChange={e => setFilterChapter(e.target.value)}
                        className="px-2 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-bold text-[9px] outline-none hover:bg-slate-200 cursor-pointer max-w-[160px] truncate shrink-0"
                      >
                        <option value="Tất cả">Tất cả Chương</option>
                        {(filterCategory === 'Tất cả'
                          ? Object.values(PART_CHAPTERS).flat()
                          : PART_CHAPTERS[filterCategory] || []
                        ).map((chap, i) => (
                          <option key={i} value={chap} title={chap}>{(chap.length > 25 ? chap.substring(0, 25) + '...' : chap)}</option>
                        ))}
                      </select>
                      <button onClick={handleDownloadWord} className="bg-amber-500 text-white px-2.5 py-1.5 rounded-lg font-bold text-[10px] flex items-center gap-1.5 hover:bg-amber-600 shadow shadow-amber-200 transition shrink-0" title="Tải kho đề Word">
                        <Download size={14} /> Tải xuống
                      </button>
                      
                      <button 
                        onClick={handleDeleteChapter} 
                        className={`text-white px-2.5 py-1.5 rounded-lg font-bold text-[10px] flex items-center gap-1.5 transition shrink-0 whitespace-nowrap shadow ${
                          isDeletingChapter 
                            ? 'bg-red-600 hover:bg-red-700 shadow-red-200' 
                            : 'bg-rose-500 hover:bg-rose-600 shadow-rose-200'
                        }`}
                        title="Xóa toàn bộ câu hỏi của chương đang chọn"
                      >
                        <Trash2 size={14} /> {isDeletingChapter ? 'Xác nhận xóa?' : 'Xóa chương'}
                      </button>
                      {isDeletingChapter && (
                        <button 
                          onClick={() => setIsDeletingChapter(false)}
                          className="px-2.5 py-1.5 text-slate-400 font-bold text-[9px] hover:bg-slate-100 rounded-lg transition shrink-0"
                        >
                          Hủy
                        </button>
                      )}
                      
                      {hasChanges && (
                        <button 
                          onClick={handleSaveAllChanges} 
                          disabled={loading}
                          className="bg-red-600 text-white px-2.5 py-1.5 rounded-lg font-black text-[10px] flex items-center gap-1.5 hover:bg-red-700 shadow shadow-red-200 transition animate-pulse shrink-0 whitespace-nowrap"
                        >
                          {loading ? <RefreshCw className="animate-spin" size={12} /> : <div className="w-2 h-2 bg-white rounded-full shadow-[0_0_5px_white]"></div>}
                          LƯU {pendingDeletes.length + pendingUpdates.length} THAY ĐỔI
                        </button>
                      )}
                    </div>
                   <div className="flex gap-1.5">
                      <button 
                        onClick={handleRefreshPool} 
                        className={`px-2 py-1.5 font-bold text-[9px] rounded-lg transition flex items-center gap-1.5 border ${
                          isDeletingPool 
                            ? 'bg-red-600 text-white border-red-600' 
                            : 'text-red-400 hover:bg-red-50 border-transparent'
                        }`}
                      >
                        {isDeletingPool ? (
                          <>Xác nhận?</>
                        ) : (
                          <><Trash2 size={12} /> Xóa kho đề</>
                        )}
                      </button>
                      {isDeletingPool && (
                        <button 
                          onClick={() => setIsDeletingPool(false)}
                          className="px-2 py-1.5 text-slate-400 font-bold text-[9px] hover:bg-slate-100 rounded-lg transition"
                        >
                          Hủy
                        </button>
                      )}
                   </div>
                </div>

                {showPreview && (
                  <QuizPreview 
                    questions={previewQuestions}
                    onConfirm={confirmSaveQuestions}
                    onCancel={() => { setShowPreview(false); setPreviewQuestions([]); setIsQuickEdit(false); }}
                    onUpdateQuestion={(index, updated) => {
                      const newPreview = [...previewQuestions];
                      newPreview[index] = updated;
                      setPreviewQuestions(newPreview);
                    }}
                    onDeleteQuestion={(index) => {
                      const newPreview = [...previewQuestions];
                      newPreview.splice(index, 1);
                      setPreviewQuestions(newPreview);
                    }}
                    loading={loading}
                  />
                )}

                {showAddForm && (
                  <div className="overflow-hidden">
                    <form onSubmit={handleAddQuestion} className="bg-white p-8 rounded-[2rem] border-2 border-blue-100 shadow-xl space-y-6">
                      <div>
                      <div className="flex items-center justify-between mb-3 ml-1">
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">
                          {editId ? 'Sửa câu hỏi' : 'Nội dung câu hỏi'} (LaTeX: $...$)
                        </label>
                        {editId && (
                          <button 
                            type="button"
                            onClick={() => {
                              setEditId(null);
                              setNewQuestion({ content: '', options: ['', '', '', ''], correctAnswer: 0, category: 'Số và Đại số', chapter: '' });
                            }}
                            className="text-[10px] font-bold text-red-500 hover:underline"
                          >
                            Hủy chỉnh sửa
                          </button>
                        )}
                      </div>
                        <textarea required className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl h-32 focus:ring-2 focus:ring-blue-500 outline-none text-lg font-medium" value={newQuestion.content} onChange={e => setNewQuestion({...newQuestion, content: e.target.value})} placeholder="Nhập câu hỏi..." />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        {newQuestion.options.map((opt, i) => (
                          <div key={i} className="flex gap-3 items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                             <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center font-bold text-xs text-slate-400">{String.fromCharCode(65 + i)}</div>
                             <input required type="text" className="flex-1 bg-transparent outline-none text-sm font-medium" value={opt} onChange={e => {
                               const newOpts = [...newQuestion.options];
                               newOpts[i] = e.target.value;
                               setNewQuestion({...newQuestion, options: newOpts});
                             }} placeholder={`Đáp án ${String.fromCharCode(65 + i)}`} />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-6 items-center pt-2">
                        <div className="flex-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Đáp án đúng</label>
                          <div className="flex gap-2">
                            {[0,1,2,3].map(i => (
                              <button key={i} type="button" onClick={() => setNewQuestion({...newQuestion, correctAnswer: i})} className={`w-10 h-10 rounded-lg font-bold transition-all border-2 ${newQuestion.correctAnswer === i ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}>
                                {String.fromCharCode(65+i)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                             <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Danh mục</label>
                             <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm" value={newQuestion.category} onChange={e => { const cat = e.target.value; setNewQuestion({...newQuestion, category: cat, chapter: ''}) }}>
                              <option>Số và Đại số</option>
                              <option>Hình học và Đo lường</option>
                              <option>Thống kê và Xác suất</option>
                             </select>
                          </div>
                          <div>
                             <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Chương môn học</label>
                             <select className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm" value={newQuestion.chapter || ''} onChange={e => setNewQuestion({...newQuestion, chapter: e.target.value})}>
                               <option value="">-- Chưa phân chương --</option>
                               {(PART_CHAPTERS[newQuestion.category] || []).map((chap, idx) => (
                                 <option key={idx} value={chap}>{chap}</option>
                               ))}
                             </select>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-4 justify-end pt-4">
                        <button type="button" onClick={() => setShowAddForm(false)} className="px-6 py-2 text-slate-400 font-bold hover:text-slate-600 uppercase text-[10px] tracking-widest">Hủy bỏ</button>
                        <button type="submit" disabled={loading} className="px-10 py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg shadow-blue-200 hover:bg-blue-700 transition">
                          {loading ? <RefreshCw className="animate-spin inline-block mr-2" /> : editId ? 'CẬP NHẬT CÂU HỎI' : 'LƯU CÂU HỎI'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="p-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Nội dung</th>
                        <th className="p-3 text-[10px] font-black text-slate-400 uppercase tracking-widest w-40">Phân loại</th>
                        <th className="p-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right w-24">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(filteredQuestions || []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-12 text-center">
                             <div className="flex flex-col items-center gap-3 text-slate-300">
                                {(filterCategory === 'Tất cả' && filterChapter === 'Tất cả') ? (
                                  <>
                                    <FileText size={48} className="opacity-20 animate-pulse text-blue-500" />
                                    <p className="font-bold text-base text-slate-500">Chưa chọn bộ lọc</p>
                                    <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">Vui lòng chọn Phân môn hoặc Chương học ở trên để hiển thị danh sách câu hỏi</p>
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw size={48} className="opacity-20 animate-pulse" />
                                    <p className="font-bold text-lg">Không có câu hỏi nào</p>
                                    <p className="text-xs uppercase tracking-widest font-black opacity-50">Không tìm thấy câu hỏi khớp với bộ lọc đang chọn</p>
                                  </>
                                )}
                             </div>
                          </td>
                        </tr>
                      ) : (
                        filteredQuestions.map(q => (
                          <tr key={q.id} className="hover:bg-slate-50/50 transition-colors group">
                            <td className="p-3"><div className="line-clamp-1 text-xs font-semibold text-slate-700"><MathText text={q.content} /></div></td>
                            <td className="p-3">
                              <div className="flex flex-col gap-1 items-start">
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[9px] font-black rounded uppercase">{q.category}</span>
                                {q.chapter && (
                                  <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[8px] font-bold rounded truncate max-w-[200px]" title={q.chapter}>
                                    {q.chapter.split('. ')[0]}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-right">
                               <div className="flex items-center justify-end gap-1.5">
                                 <button 
                                   onClick={() => handleEditClick(q)}
                                   className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-all"
                                   title="Sửa câu hỏi"
                                 >
                                   <Edit2 size={12} />
                                 </button>
                                 <button 
                                   onClick={async () => { 
                                     if (confirmDeleteId !== q.id) {
                                       setConfirmDeleteId(q.id!);
                                       setTimeout(() => setConfirmDeleteId(null), 3000);
                                     } else {
                                       setPendingDeletes(prev => [...prev, q.id!]);
                                       setQuestions(prev => prev.filter(quest => quest.id !== q.id));
                                       setConfirmDeleteId(null);
                                     }
                                   }} 
                                   className={`w-6 h-6 flex items-center justify-center rounded-lg transition-all ${confirmDeleteId === q.id ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'text-slate-300 hover:text-white hover:bg-red-500 hover:shadow-md hover:shadow-red-100'}`}
                                   title="Xóa câu hỏi"
                                 >
                                   <Trash2 size={12} />
                                 </button>
                               </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div key="s" className="space-y-2">
                 {/* Filters Bar for Results */}
                 <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
                   <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                     <div className="flex-1 md:w-64">
                       <label className="block text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Lọc theo Trường</label>
                       <select 
                         value={filterSchool} 
                         onChange={e => setFilterSchool(e.target.value)}
                         className="w-full text-xs font-bold py-1.5 px-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                       >
                         <option value="Tất cả">Tất cả Trường</option>
                         <option value="THCS Triệu Trạch">THCS Triệu Trạch</option>
                         <option value="TH&THCS Triệu Sơn">TH&THCS Triệu Sơn</option>
                         <option value="THCS Nguyễn Bỉnh Khiêm">THCS Nguyễn Bỉnh Khiêm</option>
                         <option value="THCS Lý Tự Trọng">THCS Lý Tự Trọng</option>
                       </select>
                     </div>
                     <div className="flex-1 md:w-48">
                       <label className="block text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">Lọc theo Lớp</label>
                       <select 
                         value={filterClass} 
                         onChange={e => setFilterClass(e.target.value)}
                         className="w-full text-xs font-bold py-1.5 px-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                       >
                         <option value="Tất cả">Tất cả Lớp</option>
                         <option value="9A">9A</option>
                         <option value="9B">9B</option>
                         <option value="9C">9C</option>
                         <option value="9D">9D</option>
                         <option value="9E">9E</option>
                       </select>
                     </div>
                   </div>
                   
                   <div className="text-[10px] text-slate-400 font-bold text-right">
                     {filterSchool === 'Tất cả' && filterClass === 'Tất cả' ? (
                       <span className="text-rose-500 font-black uppercase tracking-wider animate-pulse">● Vui lòng chọn Trường hoặc Lớp để tải kết quả</span>
                     ) : (
                       <span className="text-green-500 font-black uppercase tracking-wider">● Đang hiển thị kết quả đã lọc</span>
                     )}
                   </div>
                 </div>

                 <div className="grid grid-cols-4 gap-2">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm">
                       <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Số lượt thi</p>
                       <p className="text-xl font-black text-slate-800 leading-none">{filteredResults.length}</p>
                    </div>
                    <div className="bg-blue-600 p-2.5 rounded-xl shadow-md shadow-blue-200 text-white">
                       <p className="text-[8px] font-black text-blue-200 uppercase tracking-widest mb-0.5">Điểm TB (10.0)</p>
                       <p className="text-xl font-black leading-none">{stats.avgScore}</p>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm col-span-2 flex justify-between items-center">
                       <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Trạng thái dữ liệu</p>
                          <p className="text-[9px] font-bold text-green-500 flex items-center gap-1">
                             <span className="w-1 h-1 bg-green-500 rounded-full inline-block"></span> Syncing
                          </p>
                       </div>
                       <div className="flex gap-1.5">
                          <button onClick={handleExportExcel} className="px-2 py-1 bg-blue-50 text-blue-600 font-bold text-[8px] rounded-md hover:bg-blue-600 hover:text-white transition-all uppercase tracking-widest border border-blue-100 flex items-center gap-1">
                             <Download size={10} /> Excel
                          </button>
                          <button 
                            onClick={handleDeleteResults} 
                            className={`px-2 py-1 font-bold text-[8px] rounded-md transition-all uppercase tracking-widest border ${
                              isConfirmingDeleteAllResults 
                                ? 'bg-red-600 text-white hover:bg-red-700 border-red-600 shadow-md shadow-red-200 animate-pulse' 
                                : 'bg-red-50 text-red-500 hover:bg-red-500 hover:text-white border-red-100'
                            }`}
                          >
                            {isConfirmingDeleteAllResults ? 'Xác nhận xóa hết?' : 'Xóa bài thi'}
                          </button>
                          {isConfirmingDeleteAllResults && (
                            <button 
                              onClick={() => setIsConfirmingDeleteAllResults(false)}
                              className="px-2 py-1 bg-slate-150 text-slate-600 font-bold text-[8px] rounded-md hover:bg-slate-200 transition-all uppercase tracking-widest border border-slate-200"
                            >
                              Hủy
                            </button>
                          )}
                       </div>
                    </div>
                 </div>

                 <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                    <table className="w-full text-left">
                       <thead className="bg-slate-900 text-white">
                          <tr className="h-8 text-[8px] font-black uppercase tracking-widest">
                             <th className="pl-4 pr-2">STT</th>
                             <th className="px-2">Giờ làm bài</th>
                             <th className="px-2">Lớp</th>
                             <th className="px-2">Trường</th>
                             <th className="px-2">Tên học sinh</th><th className="px-2">Phần ôn tập</th>
                             <th className="pr-4 pl-2 text-right">Điểm số</th>
                             <th className="w-10 text-center pr-2">Xoá</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100">
                          {(filteredResults || []).length === 0 ? (
                            <tr>
                              <td colSpan={8} className="p-12 text-center">
                                 <div className="flex flex-col items-center gap-3 text-slate-300">
                                    {(filterSchool === 'Tất cả' && filterClass === 'Tất cả') ? (
                                      <>
                                         <BarChart2 size={48} className="opacity-20 animate-pulse text-blue-500" />
                                         <p className="font-bold text-base text-slate-500">Chưa chọn bộ lọc</p>
                                         <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">Vui lòng chọn Trường hoặc Lớp ở trên để hiển thị danh sách kết quả học sinh</p>
                                      </>
                                    ) : (
                                      <>
                                         <RefreshCw size={48} className="opacity-20 animate-pulse" />
                                         <p className="font-bold text-lg">Không có kết quả nào</p>
                                         <p className="text-xs uppercase tracking-widest font-black opacity-50">Không tìm thấy kết quả khớp với bộ lọc đang chọn</p>
                                      </>
                                    )}
                                 </div>
                              </td>
                            </tr>
                          ) : (
                            filteredResults.map((r, idx) => (
                              <tr key={r.id} className="h-8 hover:bg-slate-50 transition-colors">
                                 <td className="pl-4 pr-2 font-black text-slate-400 text-[9px]">{(idx + 1).toString().padStart(2, '0')}</td>
                                 <td className="px-2 text-[9px] text-slate-400">
                                   {r.submittedAt && typeof (r.submittedAt as any).toDate === 'function' 
                                     ? (r.submittedAt as Timestamp).toDate().toLocaleString('vi-VN') 
                                     : 'N/A'}
                                 </td>
                                 <td className="px-2"><span className="px-1.5 py-0 bg-blue-50 text-blue-600 text-[8px] font-black rounded uppercase">{r.class}</span></td>
                                 <td className="px-2"><span className="text-[9px] text-slate-500 font-bold uppercase">{r.school || 'N/A'}</span></td>
                                 <td className="px-2 font-medium text-slate-800 text-[10px]">{r.name}</td><td className="px-2"><span className="text-[9px] text-slate-600 font-bold truncate max-w-[140px] inline-block font-sans" title={r.chapter || "Thi tổng hợp"}>{r.chapter ? r.chapter.split(". ")[0] : "Tổng hợp"}</span></td>
                                 <td className="pr-4 pl-2 text-right">
                                    <div className="flex flex-col items-end">
                                       <span className={`text-base font-black ${r.score >= 8.0 ? 'text-green-500' : r.score >= 5.0 ? 'text-blue-500' : 'text-orange-500'}`}>
                                         {r.score.toFixed(1)}
                                       </span>
                                    </div>
                                 </td>
                                 <td className="pr-2 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <button 
                                        onClick={() => handleDeleteResult(r.id!)}
                                        className={`p-1 flex items-center justify-center rounded transition-all ${
                                          confirmDeleteResultId === r.id 
                                            ? 'bg-red-600 text-white font-bold text-[8px] px-1.5 py-0.5 shadow-sm' 
                                            : 'text-slate-300 hover:text-red-500 hover:bg-red-50'
                                        }`}
                                        title={confirmDeleteResultId === r.id ? 'Xác nhận xóa?' : 'Xoá kết quả'}
                                      >
                                        {confirmDeleteResultId === r.id ? 'Xóa?' : <Trash2 size={12} />}
                                      </button>
                                      {confirmDeleteResultId === r.id && (
                                        <button 
                                          onClick={() => setConfirmDeleteResultId(null)}
                                          className="text-[8px] font-black text-slate-400 hover:text-slate-600 px-1 py-0.5 hover:bg-slate-100 rounded transition"
                                        >
                                          Hủy
                                        </button>
                                      )}
                                    </div>
                                 </td>
                              </tr>
                            ))
                          )}
                       </tbody>
                    </table>
                 </div>
              </div>
            )}
        </div>
      </main>
    </div>
  );
}
