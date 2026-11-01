import React, { useState, useEffect, useMemo } from 'react';
import { db, QuizResult, ClassRoster, handleFirestoreError, OperationType, SCHOOL_CLASSES } from '../lib/firebase';
import { collection, doc, getDoc, setDoc, getDocs, query, where, Timestamp, deleteDoc } from 'firebase/firestore';
import { X, AlertTriangle, CheckCircle2, UserX, Download, Upload, Users, Calendar, Filter, Search, Edit3, RefreshCw, FileSpreadsheet, ChevronRight, Info, Star, Award, Sparkles, BarChart2, Trash2, AlertCircle, ShieldAlert } from 'lucide-react';
import * as XLSX from 'xlsx';
import { matchResultToRoster, sortVietnameseRosterByGivenName, isLegacySortedByFamilyName, normalizeClassRosterOrder } from '../utils/nameMatcher';

interface StudentWeeklyStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSchool?: string;
  initialClass?: string;
}

interface WeekInfo {
  weekNum: number;
  label: string;
  startDate: Date;
  endDate: Date;
  dateRangeStr: string;
}

interface StudentWeekStatus {
  count: number;
  maxScore: number | null;
  avgScore: number | null;
  scores: number[];
  passCount: number; // số lần làm >= 5đ
  failCount: number; // số lần làm < 5đ
  hasGte8: boolean; // có bài >= 8đ trong tuần này
  isCountedWeek: boolean; // tuần được đếm (Đạt >= 8đ hoặc đã từng đạt >= 8đ và tuần này đạt >= 5đ)
  countedReason: 'gte_8' | 'gte_5_after_8' | 'none';
  isUnmet: boolean; // true nếu count == 0 hoặc không có lần nào >= 5đ
  unmetReason: 'no_test' | 'below_5' | 'passed';
  label: string;
  subLabel: string;
}

interface StudentStatRow {
  rosterIndex: number;
  name: string;
  school: string;
  className: string;
  isOutsideRoster?: boolean;
  studentResults: QuizResult[];
  weeks: StudentWeekStatus[];
  unmetWeeksCount: number;
  is4WeeksConsecutiveUnmet: boolean;
  countedWeeksCount: number; // số tuần được đếm (theo quy định >= 8đ hoặc >= 5đ sau khi đạt >= 8đ)
  isExcellent: boolean; // có >= 3 tuần được đếm -> Xuất sắc
  totalSubmissions: number;
  highestOverallScore: number | null;
}

export default function StudentWeeklyStatsModal({
  isOpen,
  onClose,
  initialSchool = 'THCS Nam Cửa Việt',
  initialClass = '9A8'
}: StudentWeeklyStatsModalProps) {
  const [school, setSchool] = useState(initialSchool === 'Tất cả' ? 'THCS Nam Cửa Việt' : initialSchool);
  const [className, setClassName] = useState(() => {
    const validSchool = initialSchool === 'Tất cả' ? 'THCS Nam Cửa Việt' : initialSchool;
    const allowed = SCHOOL_CLASSES[validSchool] || ['9A8', '9A9', 'Học thêm'];
    return allowed.includes(initialClass) ? initialClass : allowed[0];
  });
  
  // Date selection: default to current month / year
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1); // 1-12
  const [timeMode, setTimeMode] = useState<'month' | 'recent4weeks'>('month');

  const [roster, setRoster] = useState<string[]>([]);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'unmet4' | 'unmetSome' | 'passed' | 'excellent'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Roster edit state
  const [showRosterEditor, setShowRosterEditor] = useState(false);
  const [rosterInputText, setRosterInputText] = useState('');
  const [isSavingRoster, setIsSavingRoster] = useState(false);
  const [rosterSaveSuccess, setRosterSaveSuccess] = useState(false);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteOption, setDeleteOption] = useState<'roster_only' | 'all'>('roster_only');
  const [isDeleting, setIsDeleting] = useState(false);

  // Selected student for drill-down details
  const [selectedStudentName, setSelectedStudentName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage(prev => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Reset loaded status and roster when criteria changes so user clicks "Thống kê" to query
  useEffect(() => {
    setHasLoaded(false);
    setResults([]);
    setRoster([]);
    setRosterInputText('');
    setSelectedStudentName(null);
  }, [school, className, selectedYear, selectedMonth, timeMode]);

  // Generate the 4 weeks based on timeMode
  const weeks: WeekInfo[] = useMemo(() => {
    if (timeMode === 'month') {
      const year = selectedYear;
      const monthIdx = selectedMonth - 1; // 0-indexed
      const lastDayOfMonth = new Date(year, monthIdx + 1, 0).getDate();

      const formatD = (d: number) => d.toString().padStart(2, '0');
      const formatM = (m: number) => m.toString().padStart(2, '0');

      return [
        {
          weekNum: 1,
          label: 'Tuần 1',
          startDate: new Date(year, monthIdx, 1, 0, 0, 0, 0),
          endDate: new Date(year, monthIdx, 7, 23, 59, 59, 999),
          dateRangeStr: `${formatD(1)}/${formatM(selectedMonth)} - ${formatD(7)}/${formatM(selectedMonth)}`
        },
        {
          weekNum: 2,
          label: 'Tuần 2',
          startDate: new Date(year, monthIdx, 8, 0, 0, 0, 0),
          endDate: new Date(year, monthIdx, 14, 23, 59, 59, 999),
          dateRangeStr: `${formatD(8)}/${formatM(selectedMonth)} - ${formatD(14)}/${formatM(selectedMonth)}`
        },
        {
          weekNum: 3,
          label: 'Tuần 3',
          startDate: new Date(year, monthIdx, 15, 0, 0, 0, 0),
          endDate: new Date(year, monthIdx, 21, 23, 59, 59, 999),
          dateRangeStr: `${formatD(15)}/${formatM(selectedMonth)} - ${formatD(21)}/${formatM(selectedMonth)}`
        },
        {
          weekNum: 4,
          label: 'Tuần 4',
          startDate: new Date(year, monthIdx, 22, 0, 0, 0, 0),
          endDate: new Date(year, monthIdx, lastDayOfMonth, 23, 59, 59, 999),
          dateRangeStr: `${formatD(22)}/${formatM(selectedMonth)} - ${formatD(lastDayOfMonth)}/${formatM(selectedMonth)}`
        }
      ];
    } else {
      // 4 most recent 7-day intervals
      const now = new Date();
      const list: WeekInfo[] = [];
      for (let i = 3; i >= 0; i--) {
        const end = new Date(now);
        end.setDate(now.getDate() - (i * 7));
        end.setHours(23, 59, 59, 999);

        const start = new Date(end);
        start.setDate(end.getDate() - 6);
        start.setHours(0, 0, 0, 0);

        const weekIndex = 4 - i;
        const formatStr = (d: Date) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        list.push({
          weekNum: weekIndex,
          label: `Tuần ${weekIndex}`,
          startDate: start,
          endDate: end,
          dateRangeStr: `${formatStr(start)} - ${formatStr(end)}`
        });
      }
      return list;
    }
  }, [timeMode, selectedYear, selectedMonth]);

  const loadRosterAndResults = async () => {
    if (!school || !className) return;
    setLoading(true);
    try {
      // 1. Fetch roster from Firestore
      const rosterDocId = `roster_${school.trim().replace(/\s+/g, '_')}_${className.trim().replace(/\s+/g, '_')}`;
      const rosterSnap = await getDoc(doc(db, 'class_rosters', rosterDocId));

      let currentRoster: string[] = [];
      if (rosterSnap.exists()) {
        const data = rosterSnap.data() as ClassRoster;
        const savedStudents = data.students || [];
        if (isLegacySortedByFamilyName(savedStudents)) {
          // Tự động khôi phục các danh sách lớp cũ từng bị xếp theo chữ cái đầu của Họ về đúng thứ tự Tên A->Z chuẩn sổ điểm
          currentRoster = sortVietnameseRosterByGivenName(savedStudents);
          try {
            await setDoc(doc(db, 'class_rosters', rosterDocId), {
              ...data,
              students: currentRoster,
              updatedAt: Timestamp.now()
            });
            sessionStorage.setItem(`cached_${rosterDocId}`, JSON.stringify(currentRoster));
          } catch (e) {}
        } else {
          currentRoster = savedStudents;
        }
      }

      // 2. Fetch results for this school & class
      const q = query(
        collection(db, 'results'),
        where('class', '==', className)
      );
      const resultsSnap = await getDocs(q);
      const fetchedResults = resultsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as QuizResult))
        .filter(r => !school || r.school === school || !r.school);

      setResults(fetchedResults);

      // If no roster saved yet, auto-populate with students found in results ordered by Vietnamese Given Name (Tên A-Z)
      if (currentRoster.length === 0) {
        const distinctNames = Array.from<string>(new Set(fetchedResults.map(r => r.name.trim()).filter(Boolean)));
        if (distinctNames.length > 0) {
          currentRoster = sortVietnameseRosterByGivenName(distinctNames);
        }
      }

      setRoster(currentRoster);
      setRosterInputText(currentRoster.join('\n'));
      setHasLoaded(true);
    } catch (error) {
      console.error('Failed to load roster or results:', error);
      handleFirestoreError(error, OperationType.GET, 'class_rosters');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRoster = async () => {
    if (!school || !className) return;
    setIsSavingRoster(true);
    try {
      const names = rosterInputText
        .split('\n')
        .map(line => {
          return line.replace(/^\s*\d+[\.\-\s\)]+\s*/, '').trim();
        })
        .filter(n => n.length > 0);

      // Giữ nguyên chính xác thứ tự danh sách học sinh theo lớp (không tự ý đảo theo Họ)
      const uniqueNames = Array.from<string>(new Set(names));

      const rosterDocId = `roster_${school.trim().replace(/\s+/g, '_')}_${className.trim().replace(/\s+/g, '_')}`;
      const payload: ClassRoster = {
        school,
        class: className,
        students: uniqueNames,
        updatedAt: Timestamp.now()
      };

      await setDoc(doc(db, 'class_rosters', rosterDocId), payload);
      try {
        sessionStorage.setItem(`cached_${rosterDocId}`, JSON.stringify(uniqueNames));
      } catch (e) {}

      setRoster(uniqueNames);
      setRosterInputText(uniqueNames.join('\n'));
      setRosterSaveSuccess(true);
      notify(`Đã lưu danh sách ${uniqueNames.length} học sinh lớp ${className}!`, 'success');
      setTimeout(() => {
        setRosterSaveSuccess(false);
        setShowRosterEditor(false);
      }, 1000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'class_rosters');
    } finally {
      setIsSavingRoster(false);
    }
  };

  const handleDeleteClassData = async (option: 'roster_only' | 'all') => {
    if (!school || !className) return;
    setIsDeleting(true);
    try {
      const rosterDocId = `roster_${school.trim().replace(/\s+/g, '_')}_${className.trim().replace(/\s+/g, '_')}`;
      await deleteDoc(doc(db, 'class_rosters', rosterDocId));
      try {
        sessionStorage.removeItem(`cached_${rosterDocId}`);
      } catch (e) {}

      let deletedResultsCount = 0;
      if (option === 'all') {
        const q = query(
          collection(db, 'results'),
          where('class', '==', className)
        );
        const resultsSnap = await getDocs(q);
        const docsToDelete = resultsSnap.docs.filter(d => {
          const data = d.data() as QuizResult;
          return !school || data.school === school || !data.school;
        });

        for (const docSnap of docsToDelete) {
          await deleteDoc(docSnap.ref);
          deletedResultsCount++;
        }
      }

      setRoster([]);
      setRosterInputText('');
      setResults([]);
      setHasLoaded(false);
      setShowDeleteModal(false);

      if (option === 'all') {
        notify(`Đã xoá danh sách học sinh và ${deletedResultsCount} bài nộp của lớp ${className} (${school})!`, 'success');
      } else {
        notify(`Đã xoá thành công danh sách học sinh của lớp ${className} (${school})!`, 'success');
      }
    } catch (err) {
      console.error('Failed to delete class data:', err);
      handleFirestoreError(err, OperationType.DELETE, 'class_rosters');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (rows.length === 0) {
          notify('Tệp Excel trống!', 'error');
          return;
        }

        // 1. Scan top 15 rows to find header columns
        let headerRowIndex = -1;
        let colIndexName = -1;
        let colIndexHoDem = -1;
        let colIndexTen = -1;
        let colIndexClass = -1;

        for (let r = 0; r < Math.min(rows.length, 15); r++) {
          const row = rows[r];
          if (!row || !Array.isArray(row)) continue;

          for (let c = 0; c < row.length; c++) {
            const cellVal = String(row[c] || '').trim().toLowerCase();
            if (
              cellVal === 'họ và tên' || 
              cellVal === 'họ tên' || 
              cellVal === 'họ và tên học sinh' || 
              cellVal === 'tên học sinh' ||
              cellVal === 'hoten' ||
              cellVal === 'fullname' ||
              cellVal === 'họ & tên'
            ) {
              headerRowIndex = r;
              colIndexName = c;
            } else if (cellVal === 'họ đệm' || cellVal === 'họ và chữ đệm' || cellVal === 'họ lót' || cellVal === 'họ') {
              headerRowIndex = r;
              colIndexHoDem = c;
            } else if (cellVal === 'tên' && colIndexHoDem !== -1) {
              colIndexTen = c;
            } else if (
              cellVal === 'lớp' || 
              cellVal === 'tên lớp' || 
              cellVal === 'lớp học' || 
              cellVal === 'khối/lớp' || 
              cellVal === 'class'
            ) {
              colIndexClass = c;
            }
          }
          if (headerRowIndex !== -1 && (colIndexName !== -1 || (colIndexHoDem !== -1 && colIndexTen !== -1))) {
            break;
          }
        }

        const normalizeClass = (str: string) => {
          return str.toLowerCase().replace(/[\s\.\/\-_]/g, '').replace(/^lớp/, '');
        };
        const targetClassNorm = normalizeClass(className);

        const extractedNames: string[] = [];
        let filteredOtherClassCount = 0;

        if (headerRowIndex !== -1) {
          for (let r = headerRowIndex + 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            let rowClassStr = '';
            if (colIndexClass !== -1 && row[colIndexClass] !== undefined) {
              rowClassStr = String(row[colIndexClass]).trim();
            }

            if (colIndexClass !== -1 && rowClassStr) {
              const rowClassNorm = normalizeClass(rowClassStr);
              if (rowClassNorm !== targetClassNorm && !rowClassNorm.includes(targetClassNorm) && !targetClassNorm.includes(rowClassNorm)) {
                filteredOtherClassCount++;
                continue;
              }
            }

            let fullName = '';
            if (colIndexName !== -1 && row[colIndexName]) {
              fullName = String(row[colIndexName]).trim();
            } else if (colIndexHoDem !== -1 && colIndexTen !== -1) {
              const hoDem = String(row[colIndexHoDem] || '').trim();
              const ten = String(row[colIndexTen] || '').trim();
              fullName = `${hoDem} ${ten}`.trim();
            }

            fullName = fullName.replace(/^\s*\d+[\.\-\s\)]+\s*/, '').trim();
            if (fullName && fullName.length > 1 && !/^\d+$/.test(fullName)) {
              extractedNames.push(fullName);
            }
          }
        } else {
          rows.forEach(row => {
            if (!row || row.length === 0) return;
            for (const cell of row) {
              if (typeof cell === 'string' && cell.trim().length > 1) {
                const cleaned = cell.trim().replace(/^\s*\d+[\.\-\s\)]+\s*/, '').trim();
                const lower = cleaned.toLowerCase();
                if (
                  !['stt', 'họ và tên', 'họ tên', 'tên', 'lớp', 'trường', 'điểm', 'ghi chú', 'ngày sinh', 'nữ', 'nam'].includes(lower) &&
                  !/^\d+$/.test(cleaned) &&
                  cleaned.includes(' ')
                ) {
                  extractedNames.push(cleaned);
                  break;
                }
              }
            }
          });
        }

        // Giữ nguyên chính xác thứ tự STT học sinh từ tệp Excel của lớp
        const uniqueExtracted = Array.from<string>(new Set(extractedNames));

        if (uniqueExtracted.length > 0) {
          setRosterInputText(uniqueExtracted.join('\n'));
          let msg = `Đã trích xuất ${uniqueExtracted.length} học sinh cho lớp ${className}.`;
          if (filteredOtherClassCount > 0) {
            msg += ` (Đã lọc bỏ ${filteredOtherClassCount} HS lớp khác).`;
          }
          msg += ` Nhấn "Lưu DS Lớp ${className}" để hoàn tất!`;
          notify(msg, 'success');
        } else {
          notify(`Không tìm thấy danh sách học sinh của lớp ${className} trong tệp Excel!`, 'error');
        }
      } catch (err) {
        console.error('Error reading excel file:', err);
        notify('Lỗi khi đọc tệp Excel. Vui lòng kiểm tra lại định dạng tệp!', 'error');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const getResultDate = (submittedAt: any): Date | null => {
    if (!submittedAt) return null;
    if (typeof submittedAt.toDate === 'function') return submittedAt.toDate();
    if (submittedAt instanceof Date) return submittedAt;
    if (typeof submittedAt === 'string' || typeof submittedAt === 'number') return new Date(submittedAt);
    if (submittedAt.seconds) return new Date(submittedAt.seconds * 1000);
    return null;
  };

  // Compile calculations for each student in the roster (plus any unmatched test-takers in this class)
  const studentStats: StudentStatRow[] = useMemo(() => {
    const baseRoster = roster.length > 0 
      ? normalizeClassRosterOrder(roster)
      : sortVietnameseRosterByGivenName(Array.from<string>(new Set(results.map(r => r.name.trim()).filter(Boolean))));

    const resultsByStudentName = new Map<string, QuizResult[]>();
    const outsideRosterSet = new Set<string>();
    baseRoster.forEach(name => resultsByStudentName.set(name, []));

    results.forEach(res => {
      const rawName = (res.name || '').trim();
      if (!rawName) return;

      const matchedCanonical = matchResultToRoster(rawName, baseRoster);
      if (matchedCanonical && resultsByStudentName.has(matchedCanonical)) {
        resultsByStudentName.get(matchedCanonical)!.push(res);
      } else {
        const directMatch = baseRoster.find(n => n.toLowerCase() === rawName.toLowerCase());
        if (directMatch && resultsByStudentName.has(directMatch)) {
          resultsByStudentName.get(directMatch)!.push(res);
        } else {
          // Student took a test in this class/school but wasn't in the uploaded roster
          const existingUnmatched = Array.from(outsideRosterSet).find(
            n => n.toLowerCase() === rawName.toLowerCase()
          );
          const keyName = existingUnmatched || rawName;
          if (!resultsByStudentName.has(keyName)) {
            resultsByStudentName.set(keyName, []);
            outsideRosterSet.add(keyName);
          }
          resultsByStudentName.get(keyName)!.push(res);
        }
      }
    });

    const outsideSorted = sortVietnameseRosterByGivenName(Array.from(outsideRosterSet));
    const allStudentNames = [...baseRoster, ...outsideSorted];

    return allStudentNames.map((studentName, rosterIdx) => {
      const studentResults = resultsByStudentName.get(studentName) || [];

      const sortedResults = [...studentResults].sort((a, b) => {
        const da = getResultDate(a.submittedAt)?.getTime() || 0;
        const db = getResultDate(b.submittedAt)?.getTime() || 0;
        return da - db;
      });

      const weekStatuses: StudentWeekStatus[] = weeks.map(week => {
        const testsInWeek = sortedResults.filter(r => {
          const d = getResultDate(r.submittedAt);
          if (!d) return false;
          return d >= week.startDate && d <= week.endDate;
        });

        const count = testsInWeek.length;
        const scores = testsInWeek.map(t => t.score);
        const passScores = scores.filter(s => s >= 5.0);
        const failScores = scores.filter(s => s < 5.0);
        const passCount = passScores.length;
        const failCount = failScores.length;
        const maxScore = count > 0 ? Math.max(...scores) : null;
        const avgScore = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : null;
        
        // Điều kiện tuần xuất sắc:
        // Có ít nhất 1 bài >= 8.0 điểm mà tất cả các lần làm sau bài đó trong tuần đều >= 5.0 điểm
        const hasValidGte8Streak = testsInWeek.some(
          (t, idx) => t.score >= 8.0 && testsInWeek.slice(idx + 1).every(sub => sub.score >= 5.0)
        );
        const hasGte8InThisWeek = testsInWeek.some(t => t.score >= 8.0);
        
        let isCountedWeek = false;
        let countedReason: 'gte_8' | 'gte_5_after_8' | 'none' = 'none';

        if (hasValidGte8Streak) {
          isCountedWeek = true;
          countedReason = 'gte_8';
        }

        let isUnmet = false;
        let unmetReason: 'no_test' | 'below_5' | 'passed' = 'passed';
        let label = '';
        let subLabel = '';

        if (count === 0) {
          isUnmet = true;
          unmetReason = 'no_test';
          label = 'Không làm bài';
          subLabel = '0 lượt nộp';
        } else if (passCount >= 1) {
          isUnmet = false;
          unmetReason = 'passed';
          const highestPass = Math.max(...passScores);
          if (isCountedWeek) {
            label = `⭐ Đạt: ${highestPass.toFixed(1)}đ (Tuần XS)`;
            subLabel = count > 1 
              ? `${count} lần nộp (có bài ≥ 8đ, các lần sau ≥ 5đ)` 
              : `1 lần nộp đạt ${highestPass.toFixed(1)}đ (≥ 8đ)`;
          } else {
            label = `Đạt: ${highestPass.toFixed(1)}đ`;
            subLabel = passCount > 1 
              ? `${passCount} lần ≥ 5đ (cao nhất ${highestPass.toFixed(1)}đ)` 
              : `1 lần ≥ 5đ (${highestPass.toFixed(1)}đ)`;
          }
        } else {
          isUnmet = true;
          unmetReason = 'below_5';
          label = `Dưới 5đ (${maxScore?.toFixed(1)}đ)`;
          subLabel = `${count} lần nộp đều < 5đ`;
        }

        return {
          count,
          maxScore,
          avgScore,
          scores,
          passCount,
          failCount,
          hasGte8: hasGte8InThisWeek,
          isCountedWeek,
          countedReason,
          isUnmet,
          unmetReason,
          label,
          subLabel
        };
      });

      const unmetWeeksCount = weekStatuses.filter(w => w.isUnmet).length;
      const is4WeeksConsecutiveUnmet = weekStatuses.every(w => w.isUnmet);
      const countedWeeksCount = weekStatuses.filter(w => w.isCountedWeek).length;
      const isExcellent = countedWeeksCount >= 3;

      const allScores = studentResults.map(r => r.score);
      const highestOverallScore = allScores.length > 0 ? Math.max(...allScores) : null;

      return {
        rosterIndex: rosterIdx + 1,
        name: studentName,
        school,
        className,
        isOutsideRoster: outsideRosterSet.has(studentName),
        studentResults: sortedResults,
        weeks: weekStatuses,
        unmetWeeksCount,
        is4WeeksConsecutiveUnmet,
        countedWeeksCount,
        isExcellent,
        totalSubmissions: studentResults.length,
        highestOverallScore
      };
    });
  }, [roster, results, weeks, school, className]);

  // Filtered rows for the view
  const filteredStudents = useMemo(() => {
    return studentStats.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchSearch) return false;

      if (filterType === 'unmet4') {
        return s.is4WeeksConsecutiveUnmet;
      }
      if (filterType === 'unmetSome') {
        return s.unmetWeeksCount > 0 && !s.is4WeeksConsecutiveUnmet;
      }
      if (filterType === 'passed') {
        return s.unmetWeeksCount === 0;
      }
      if (filterType === 'excellent') {
        return s.isExcellent;
      }
      return true;
    });
  }, [studentStats, filterType, searchTerm]);

  // Overall Statistics Summary
  const summaryStats = useMemo(() => {
    const total = studentStats.length;
    const unmet4Count = studentStats.filter(s => s.is4WeeksConsecutiveUnmet).length;
    const unmetSomeCount = studentStats.filter(s => s.unmetWeeksCount > 0 && !s.is4WeeksConsecutiveUnmet).length;
    const passedCount = studentStats.filter(s => s.unmetWeeksCount === 0).length;
    const excellentCount = studentStats.filter(s => s.isExcellent).length;
    const completionRate = total > 0 ? (((total - unmet4Count) / total) * 100).toFixed(0) : '0';

    return {
      total,
      unmet4Count,
      unmetSomeCount,
      passedCount,
      excellentCount,
      completionRate
    };
  }, [studentStats]);

  const handleExportExcel = () => {
    const periodLabel = timeMode === 'month' ? `Thang_${selectedMonth}_${selectedYear}` : '4_Tuan_Gan_Nhat';
    
    const excelData = filteredStudents.map((s) => ({
      'STT': s.rosterIndex,
      'Họ và tên': s.name,
      'Lớp': s.className,
      'Trường': s.school,
      [`Tuần 1 (${weeks[0]?.dateRangeStr})`]: `${s.weeks[0]?.label} (${s.weeks[0]?.subLabel})`,
      [`Tuần 2 (${weeks[1]?.dateRangeStr})`]: `${s.weeks[1]?.label} (${s.weeks[1]?.subLabel})`,
      [`Tuần 3 (${weeks[2]?.dateRangeStr})`]: `${s.weeks[2]?.label} (${s.weeks[2]?.subLabel})`,
      [`Tuần 4 (${weeks[3]?.dateRangeStr})`]: `${s.weeks[3]?.label} (${s.weeks[3]?.subLabel})`,
      'Số tuần được đếm (≥8đ / tiến bộ)': `${s.countedWeeksCount}/4 tuần`,
      'Số tuần chưa đạt': `${s.unmetWeeksCount}/4 tuần`,
      'Danh hiệu / Đánh giá': s.isExcellent
        ? `⭐ HỌC SINH XUẤT SẮC (${s.countedWeeksCount}/4 tuần đạt chuẩn ≥ 8đ)`
        : s.is4WeeksConsecutiveUnmet 
          ? '🚨 CẢNH BÁO: 4 TUẦN LIÊN TIẾP CHƯA ĐẠT (Không làm / < 5đ)' 
          : s.unmetWeeksCount > 0 
            ? `⚠️ Chưa đạt ${s.unmetWeeksCount}/4 tuần` 
            : '✓ Đạt chuẩn cả 4 tuần (Có ≥ 1 lần đạt ≥ 5đ mỗi tuần)'
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ThongKe4Tuan');

    // Column widths
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 25 },
      { wch: 8 },
      { wch: 24 },
      { wch: 26 },
      { wch: 26 },
      { wch: 26 },
      { wch: 26 },
      { wch: 26 },
      { wch: 18 },
      { wch: 55 }
    ];

    XLSX.writeFile(workbook, `Bao_Cao_4_Tuan_${school.replace(/\s+/g, '_')}_${className}_${periodLabel}.xlsx`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden">
        
        {/* Header - Compact */}
        <div className="py-2.5 px-4 md:px-6 bg-slate-900 text-white flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-rose-600 text-white rounded-xl flex items-center justify-center shadow-md">
              <AlertTriangle size={18} className="animate-pulse" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm md:text-base font-black tracking-tight">THỐNG KÊ THÁNG THEO LỚP</h3>
              <span className="bg-rose-500/20 text-rose-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border border-rose-500/30">
                Theo dõi 4 tuần
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-all cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Top Toolbar - Exactly 1 Single Row */}
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-1.5 md:gap-2 overflow-x-auto no-scrollbar py-0.5">
            {/* Left Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-xs shrink-0">
                <span className="text-[10px] font-black text-slate-400 uppercase">Trường:</span>
                <select
                  value={school}
                  onChange={e => {
                    const newSchool = e.target.value;
                    setSchool(newSchool);
                    const available = SCHOOL_CLASSES[newSchool] || ['Học thêm'];
                    if (!available.includes(className)) {
                      setClassName(available[0]);
                    }
                  }}
                  className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer"
                >
                  <option value="THCS Nam Cửa Việt">THCS Nam Cửa Việt</option>
                  <option value="TH&THCS Đoàn Khuê">TH&THCS Đoàn Khuê</option>
                </select>
              </div>

              <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-xs shrink-0">
                <span className="text-[10px] font-black text-slate-400 uppercase">Lớp:</span>
                <select
                  value={className}
                  onChange={e => setClassName(e.target.value)}
                  className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer"
                >
                  {(SCHOOL_CLASSES[school] || ['9A8', '9A9', 'Học thêm']).map(cls => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
              </div>

              {/* Time Range Selector */}
              <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-xs shrink-0">
                <Calendar size={13} className="text-slate-400" />
                <select
                  value={timeMode}
                  onChange={e => setTimeMode(e.target.value as any)}
                  className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer pr-1"
                >
                  <option value="month">Theo Tháng</option>
                  <option value="recent4weeks">4 Tuần Gần Nhất</option>
                </select>

                {timeMode === 'month' && (
                  <div className="flex items-center gap-1 pl-1 border-l border-slate-200">
                    <select
                      value={selectedMonth}
                      onChange={e => setSelectedMonth(Number(e.target.value))}
                      className="text-xs font-bold text-blue-600 bg-transparent outline-none cursor-pointer"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>Tháng {m}</option>
                      ))}
                    </select>
                    <select
                      value={selectedYear}
                      onChange={e => setSelectedYear(Number(e.target.value))}
                      className="text-xs font-bold text-slate-600 bg-transparent outline-none cursor-pointer"
                    >
                      <option value={2026}>2026</option>
                      <option value={2025}>2025</option>
                      <option value={2027}>2027</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Nút Thống Kê Chủ Động */}
              <button
                onClick={loadRosterAndResults}
                disabled={loading}
                className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer shadow-xs shrink-0 ${
                  loading 
                    ? 'bg-blue-400 text-white cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
                }`}
                title="Bấm để tải dữ liệu thống kê của lớp"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                <span>{loading ? 'Đang tải...' : 'Thống kê'}</span>
              </button>
            </div>

            {/* Right Action Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowRosterEditor(!showRosterEditor)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer shrink-0 ${
                  showRosterEditor ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white hover:bg-slate-700'
                }`}
                title={`Quản lý / Tải lên danh sách học sinh lớp ${className}`}
              >
                <Users size={13} />
                <span>DS Lớp {className} {hasLoaded ? `(${roster.length})` : ''}</span>
                <Edit3 size={11} className="opacity-60 ml-0.5" />
              </button>

              <button
                onClick={() => setShowDeleteModal(true)}
                className="flex items-center gap-1 px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                title={`Xoá danh sách hoặc bài thi của lớp ${className}`}
              >
                <Trash2 size={12} className="text-rose-600" />
                <span>Xoá lớp {className}</span>
              </button>

              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition shadow-xs shrink-0 cursor-pointer"
              >
                <Download size={13} />
                <span>Xuất Excel</span>
              </button>
            </div>
          </div>

          {/* Roster Editor Inline Panel */}
          {showRosterEditor && (
            <div className="p-3 bg-white rounded-xl border border-blue-200 shadow-md animate-in slide-in-from-top-2 duration-150">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Cập nhật danh sách học sinh lớp {className} - {school}
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[10px] font-bold cursor-pointer transition border border-slate-200">
                    <Upload size={11} />
                    <span>Nhập từ Excel (.xlsx) cho Lớp {className}</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                  <button
                    onClick={() => setShowRosterEditor(false)}
                    className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-500 mb-1.5">
                Dán hoặc nhập danh sách cho <strong>lớp {className}</strong> (mỗi bạn 1 dòng). File Excel nhiều lớp sẽ <strong>tự lọc đúng lớp {className}</strong>.
              </p>

              <textarea
                value={rosterInputText}
                onChange={e => setRosterInputText(e.target.value)}
                placeholder={`Ví dụ danh sách lớp ${className}:\nNguyễn Văn An\nTrần Thị Bình\nLê Hoàng Cường...`}
                rows={3}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white resize-y"
              />

              <div className="flex items-center justify-between mt-1.5 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-[10px] text-slate-500 font-medium">
                    Sĩ số: <span className="font-bold text-blue-600">{rosterInputText.split('\n').filter(s => s.trim()).length} học sinh</span> (Giữ nguyên đúng thứ tự danh sách lớp)
                  </div>
                  {rosterInputText.trim() && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const lines = rosterInputText
                            .split('\n')
                            .map(l => l.replace(/^\s*\d+[\.\-\s\)]+\s*/, '').trim())
                            .filter(Boolean);
                          const sorted = sortVietnameseRosterByGivenName(Array.from(new Set(lines)));
                          setRosterInputText(sorted.join('\n'));
                        }}
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline cursor-pointer"
                        title="Sắp xếp danh sách theo Tên chính A→Z (chuẩn sổ điểm Việt Nam)"
                      >
                        Xếp Tên A→Z
                      </button>
                      <button
                        type="button"
                        onClick={() => setRosterInputText('')}
                        className="text-[10px] text-slate-400 hover:text-rose-600 font-bold underline cursor-pointer"
                      >
                        Xoá trắng
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {rosterSaveSuccess && (
                    <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
                      <CheckCircle2 size={13} /> Đã lưu thành công!
                    </span>
                  )}
                  <button
                    onClick={handleSaveRoster}
                    disabled={isSavingRoster}
                    className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {isSavingRoster ? 'Đang lưu...' : `Lưu DS Lớp ${className}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Compact KPI Filter Bar + Search (Dịch lên trên cực kỳ gọn) */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { 
                  key: 'all', 
                  label: 'Tất cả', 
                  count: hasLoaded ? summaryStats.total : '--',
                  style: filterType === 'all' ? 'bg-slate-900 text-white shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                },
                { 
                  key: 'excellent', 
                  label: '⭐ Xuất sắc', 
                  count: hasLoaded ? summaryStats.excellentCount : '--',
                  style: filterType === 'excellent' ? 'bg-amber-600 text-white shadow-xs font-black' : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 font-bold'
                },
                { 
                  key: 'passed', 
                  label: '✓ Đạt 4 tuần', 
                  count: hasLoaded ? summaryStats.passedCount : '--',
                  style: filterType === 'passed' ? 'bg-emerald-600 text-white shadow-xs font-black' : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 font-bold'
                },
                { 
                  key: 'unmetSome', 
                  label: '⚠️ Chưa đạt 1-3 tuần', 
                  count: hasLoaded ? summaryStats.unmetSomeCount : '--',
                  style: filterType === 'unmetSome' ? 'bg-orange-600 text-white shadow-xs font-black' : 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100 font-bold'
                },
                { 
                  key: 'unmet4', 
                  label: '🚨 4 tuần chưa đạt', 
                  count: hasLoaded ? summaryStats.unmet4Count : '--',
                  style: filterType === 'unmet4' ? 'bg-rose-600 text-white shadow-xs font-black animate-pulse' : 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100 font-bold'
                }
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => setFilterType(item.key as any)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition cursor-pointer flex items-center gap-1.5 ${item.style}`}
                >
                  <span>{item.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-md text-[11px] font-black ${
                    filterType === item.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-800'
                  }`}>
                    {item.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative w-44 md:w-56 ml-auto">
              <input
                type="text"
                placeholder="Tìm tên học sinh..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-7 pr-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Quick Rule Helper Single-Line Note */}
          <div className="flex items-center justify-between gap-2 text-[10px] text-blue-900 bg-blue-50/70 border border-blue-100 px-2.5 py-1 rounded-lg">
            <div className="flex items-center gap-2 truncate flex-wrap">
              <Info size={13} className="text-blue-600 shrink-0" />
              <span><strong>Quy tắc:</strong> ≥1 bài ≥5đ = Đạt tuần.</span>
              <span className="text-amber-800 font-bold">• Tuần có bài ≥8đ (các bài sau ≥5đ) = Tuần XS.</span>
              <span className="text-blue-800 font-bold">• ≥3 tuần XS = Xuất sắc ⭐.</span>
              <span className="text-slate-500">• Bấm vào tên HS để xem chi tiết từng lần thi.</span>
            </div>
            {statusMessage && (
              <div className={`px-2.5 py-0.5 rounded-md font-bold text-[10px] shrink-0 flex items-center gap-1 ${
                statusMessage.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
              }`}>
                <span>{statusMessage.text}</span>
              </div>
            )}
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-400 gap-2">
              <RefreshCw size={32} className="animate-spin text-blue-500" />
              <p className="text-xs font-bold uppercase tracking-wider">Đang tải và tính toán thống kê tháng...</p>
            </div>
          ) : !hasLoaded ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500 gap-4 bg-gradient-to-b from-blue-50/30 to-slate-50/50 rounded-3xl border-2 border-dashed border-blue-200/80 my-4 shadow-xs">
              <div className="w-16 h-16 rounded-3xl bg-blue-600/10 text-blue-600 flex items-center justify-center shadow-inner">
                <BarChart2 size={32} />
              </div>
              <div className="max-w-md space-y-1">
                <h4 className="font-black text-slate-800 text-base">Sẵn sàng tải dữ liệu thống kê</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Đã chọn <strong className="text-slate-700">{school}</strong> • <strong className="text-slate-700">Lớp {className}</strong> {timeMode === 'month' ? `(Tháng ${selectedMonth}/${selectedYear})` : '(4 tuần gần nhất)'}.
                  Bấm nút <strong>Thống kê</strong> để tải báo cáo và hiển thị danh sách học sinh (giúp tối ưu tốc độ và tiết kiệm lượt tải).
                </p>
              </div>
              <button
                onClick={loadRosterAndResults}
                disabled={loading}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-xs uppercase tracking-wider rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition shadow-lg shadow-blue-500/25 flex items-center gap-2 cursor-pointer"
              >
                <BarChart2 size={16} />
                <span>Bấm Để Thống Kê Dữ Liệu Lớp {className}</span>
              </button>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-slate-400 gap-2 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
              <UserX size={40} className="text-slate-300" />
              <p className="font-bold text-slate-600 text-sm">Không có học sinh nào khớp với bộ lọc</p>
              <p className="text-xs text-slate-400 max-w-md">
                {roster.length === 0 
                  ? 'Chưa có danh sách lớp cho lớp này. Nhấn nút "Danh sách lớp" ở trên để nhập danh sách học sinh!'
                  : 'Không tìm thấy học sinh nào phù hợp với từ khóa tìm kiếm hoặc phân loại.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 pl-4 pr-2 w-12 text-center">STT</th>
                    <th className="py-2.5 px-3 min-w-[160px]">Họ và tên học sinh</th>
                    {weeks.map(w => (
                      <th key={w.weekNum} className="py-2.5 px-2 text-center min-w-[130px]">
                        <div>{w.label}</div>
                        <div className="text-[8px] font-normal text-slate-400 font-sans tracking-normal">
                          {w.dateRangeStr}
                        </div>
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-center min-w-[170px]">Đánh giá tháng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                  {filteredStudents.map((student, idx) => {
                    const isAlert = student.is4WeeksConsecutiveUnmet;
                    const isExc = student.isExcellent;

                    return (
                      <tr
                        key={student.name}
                        onClick={() => setSelectedStudentName(student.name)}
                        className={`transition-colors hover:bg-blue-50/50 cursor-pointer ${
                          isAlert 
                            ? 'bg-rose-50/40 font-semibold' 
                            : isExc 
                              ? 'bg-amber-50/20' 
                              : ''
                        }`}
                        title="Bấm để xem lịch sử các bài nộp của học sinh này"
                      >
                        <td className="py-2.5 pl-4 pr-2 text-center font-bold text-slate-400 text-[11px]">
                          {student.rosterIndex.toString().padStart(2, '0')}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isExc ? (
                              <span className="p-0.5 rounded bg-amber-100 text-amber-600 border border-amber-300 shadow-xs" title="Học sinh Xuất sắc (≥3 tuần đạt chuẩn)">
                                <Star size={11} className="fill-amber-500 text-amber-500" />
                              </span>
                            ) : isAlert ? (
                              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" title="4 tuần liên tiếp chưa đạt"></span>
                            ) : student.unmetWeeksCount === 0 ? (
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Đạt cả 4 tuần"></span>
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Chưa đạt một số tuần"></span>
                            )}
                            <span className={`font-bold hover:text-blue-600 transition-colors ${isAlert ? 'text-rose-950' : isExc ? 'text-slate-900 font-black' : 'text-slate-900'}`}>
                              {student.name}
                            </span>
                            {isExc && (
                              <span className="bg-amber-100 text-amber-800 text-[9px] font-black uppercase px-1.5 py-0.2 rounded border border-amber-300 shadow-2xs">
                                Xuất sắc
                              </span>
                            )}
                            {student.isOutsideRoster && (
                              <span className="bg-slate-100 text-slate-600 text-[8px] font-bold px-1.5 py-0.2 rounded border border-slate-200" title="Học sinh có nộp bài nhưng chưa có trong danh sách lớp đã lưu">
                                Ngoài DS lớp
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 ml-5">
                            Lớp {student.className} • Tổng {student.totalSubmissions} lần nộp • {student.countedWeeksCount}/4 tuần được đếm XS
                          </div>
                        </td>

                        {student.weeks.map((w, wIdx) => {
                          let badgeBg = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                          let icon = <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />;

                          if (w.unmetReason === 'no_test') {
                            badgeBg = 'bg-slate-100 text-slate-500 border-slate-200';
                            icon = <span className="text-slate-400 text-xs font-bold shrink-0">✕</span>;
                          } else if (w.unmetReason === 'below_5') {
                            badgeBg = 'bg-rose-50 text-rose-700 border-rose-200 font-bold';
                            icon = <AlertTriangle size={13} className="text-rose-500 shrink-0" />;
                          } else if (w.hasGte8) {
                            badgeBg = 'bg-amber-50 text-amber-900 border-amber-300 font-bold shadow-xs';
                            icon = <Star size={13} className="text-amber-500 fill-amber-400 shrink-0" />;
                          } else if (w.isCountedWeek) {
                            badgeBg = 'bg-emerald-50/90 text-emerald-900 border-emerald-300 font-bold';
                            icon = <Sparkles size={13} className="text-emerald-600 shrink-0" />;
                          }

                          const tooltipScores = w.scores.length > 0
                            ? `Các lần làm trong tuần: ${w.scores.map(s => s.toFixed(1) + 'đ').join(', ')}`
                            : 'Không có lần nộp bài nào trong tuần này';

                          return (
                            <td key={wIdx} className="py-2 px-2 text-center" title={tooltipScores}>
                              <div className={`inline-flex flex-col items-center justify-center p-1.5 px-2 rounded-xl border text-[10px] ${badgeBg} transition hover:scale-105 min-w-[110px]`}>
                                <div className="flex items-center gap-1 font-black">
                                  {icon}
                                  <span>{w.label}</span>
                                </div>
                                <div className="text-[9px] opacity-75 font-medium mt-0.5">
                                  {w.subLabel}
                                </div>
                              </div>
                            </td>
                          );
                        })}

                        <td className="py-2.5 px-3 text-center">
                          {isExc ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-black text-[10px] uppercase tracking-wider shadow-sm shadow-amber-200">
                              <Star size={11} className="fill-white" />
                              XUẤT SẮC ({student.countedWeeksCount}/4 tuần)
                            </span>
                          ) : isAlert ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-600 text-white font-black text-[10px] uppercase tracking-wider shadow-sm animate-pulse">
                              <AlertTriangle size={12} />
                              4 TUẦN LIÊN TIẾP CHƯA ĐẠT
                            </span>
                          ) : student.unmetWeeksCount > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-bold text-[10px]">
                              Chưa đạt {student.unmetWeeksCount}/4 tuần ({student.countedWeeksCount} tuần XS)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]">
                              <CheckCircle2 size={12} /> Đạt chuẩn cả 4 tuần ({student.countedWeeksCount}/4 tuần XS)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer info & quick stats */}
        <div className="p-3 md:px-6 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-slate-500 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-700">Nguyên tắc:</span>
            <span>≥1 lần làm ≥5đ = Đạt tuần.</span>
            <span className="text-amber-700 font-bold">• Tuần đạt ≥8đ (các lần sau trong tuần ≥5đ) = Tuần tính XS (≥3 tuần = Danh sách Xuất sắc).</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[11px] font-bold text-slate-600">
              Đang hiển thị <span className="text-blue-600 font-black">{filteredStudents.length}</span> / {summaryStats.total} học sinh
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition cursor-pointer"
            >
              Đóng lại
            </button>
          </div>
        </div>

      </div>

      {/* Student Detailed Submission History Modal */}
      {selectedStudentName && (() => {
        const studentObj = studentStats.find(s => s.name === selectedStudentName);
        if (!studentObj) return null;
        const submissionsDesc = [...studentObj.studentResults].reverse();

        return (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[82vh] flex flex-col overflow-hidden">
              <div className="p-4 md:px-6 bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm md:text-base font-black">{studentObj.name}</h4>
                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded-full text-[10px] font-black">
                      Lớp {studentObj.className}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Tổng cộng {submissionsDesc.length} lần nộp bài • Cao nhất: {studentObj.highestOverallScore !== null ? `${studentObj.highestOverallScore.toFixed(1)}đ` : 'Chưa có'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedStudentName(null)}
                  className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {submissionsDesc.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs font-bold">
                    Học sinh này chưa có lượt nộp bài nào được ghi nhận.
                  </div>
                ) : (
                  submissionsDesc.map((sub, idx) => {
                    const d = getResultDate(sub.submittedAt);
                    const matchedWeek = d ? weeks.find(w => d >= w.startDate && d <= w.endDate) : null;
                    return (
                      <div key={sub.id || idx} className="p-3 rounded-2xl border border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-800">
                              {d ? d.toLocaleString('vi-VN') : 'N/A'}
                            </span>
                            {matchedWeek && (
                              <span className="px-2 py-0.2 bg-blue-100 text-blue-700 rounded text-[10px] font-black">
                                {matchedWeek.label}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            Phần thi: <strong className="text-slate-700">{sub.chapter || 'Tổng hợp'}</strong>
                            {sub.correctCount !== undefined && ` • Đúng ${sub.correctCount}/${sub.totalQuestions || 16} câu`}
                          </div>
                        </div>
                        <div className={`px-3 py-1.5 rounded-xl font-black text-sm shrink-0 ${
                          sub.score >= 8.0
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : sub.score >= 5.0
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-rose-100 text-rose-700 border border-rose-200'
                        }`}>
                          {sub.score.toFixed(1)}đ
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-3 px-6 bg-slate-50 border-t border-slate-200 flex justify-end">
                <button
                  onClick={() => setSelectedStudentName(null)}
                  className="px-4 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl border border-rose-200 max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 shadow-inner">
                <Trash2 size={22} />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-slate-900">
                  Xoá Dữ Liệu Lớp {className}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {school} • Bạn đang chọn thao tác xoá dữ liệu của riêng lớp <strong className="text-slate-800">{className}</strong>.
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <label 
                onClick={() => setDeleteOption('roster_only')}
                className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition ${
                  deleteOption === 'roster_only'
                    ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/50'
                }`}
              >
                <input
                  type="radio"
                  name="delete_opt"
                  checked={deleteOption === 'roster_only'}
                  onChange={() => setDeleteOption('roster_only')}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-900">
                    Chỉ xoá danh sách học sinh của lớp {className}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    Đặt lại sĩ số lớp về 0 và xoá tệp danh sách đã lưu trên hệ thống. Giữ nguyên lịch sử làm bài thi.
                  </p>
                </div>
              </label>

              <label 
                onClick={() => setDeleteOption('all')}
                className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition ${
                  deleteOption === 'all'
                    ? 'border-rose-500 bg-rose-50/60 ring-2 ring-rose-500/20'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/50'
                }`}
              >
                <input
                  type="radio"
                  name="delete_opt"
                  checked={deleteOption === 'all'}
                  onChange={() => setDeleteOption('all')}
                  className="mt-0.5 text-rose-600 focus:ring-rose-500"
                />
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-rose-950">
                    Xoá danh sách VÀ toàn bộ kết quả bài thi của lớp {className}
                  </p>
                  <p className="text-[11px] text-rose-700/80 leading-normal">
                    Dọn dẹp hoàn toàn danh sách học sinh và toàn bộ bài nộp của lớp {className} trên hệ thống để làm lại từ đầu.
                  </p>
                </div>
              </label>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2 text-amber-800 text-[11px]">
              <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-600" />
              <span>
                Thao tác xoá không thể hoàn tác. Các lớp học khác trong trường sẽ không bị ảnh hưởng.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Huỷ bỏ
              </button>
              <button
                type="button"
                onClick={() => handleDeleteClassData(deleteOption)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-black text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-lg shadow-rose-600/25 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 size={13} />
                <span>{isDeleting ? 'Đang xoá dữ liệu...' : `Xác nhận xoá lớp ${className}`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
