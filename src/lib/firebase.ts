import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, query, where, deleteDoc, doc, Timestamp, orderBy, limit } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const loginAnonymously = () => signInAnonymously(auth);
export const logout = () => signOut(auth);

export interface Question {
  id?: string;
  content: string;
  options: string[];
  correctAnswer: number;
  answerSeal?: string;
  _runtimeSeal?: string;
  category: string;
  chapter?: string;
  createdAt: Timestamp | Date;
}

export const CHAPTER_NAMES = {
  CH1: 'Chương I. PHƯƠNG TRÌNH VÀ HỆ HAI PHƯƠNG TRÌNH BẬC NHẤT HAI ẨN',
  CH2: 'Chương II. PHƯƠNG TRÌNH VÀ BẤT PHƯƠNG TRÌNH BẬC NHẤT MỘT ẨN',
  CH3: 'Chương III. CĂN BẬC HAI VÀ CĂN BẬC BA',
  CH4: 'Chương IV. HỆ THỨC LƯỢNG TRONG TAM GIÁC VUÔNG',
  CH5: 'Chương V. ĐƯỜNG TRÒN',
  CH6: 'Chương VI. HÀM SỐ y = ax² (a ≠ 0). PHƯƠNG TRÌNH BẬC HAI MỘT ẨN',
  CH7: 'Chương VII. TẦN SỐ VÀ TẦN SỐ TƯƠNG ĐỐI',
  CH8: 'Chương VIII. XÁC SUẤT CỦA BIẾN CỐ TRONG MỘT SỐ MÔ HÌNH XÁC SUẤT ĐƠN GIẢN',
  CH9: 'Chương IX. ĐƯỜNG TRÒN NGOẠI TIẾP VÀ ĐƯỜNG TRÒN NỘI TIẾP',
  CH10: 'Chương X. MỘT SỐ HÌNH KHỐI TRONG THỰC TIỄN'
} as const;

export const PART_CHAPTERS: Record<string, string[]> = {
  'Số và Đại số': [
    CHAPTER_NAMES.CH1,
    CHAPTER_NAMES.CH2,
    CHAPTER_NAMES.CH3,
    CHAPTER_NAMES.CH6
  ],
  'Hình học và Đo lường': [
    CHAPTER_NAMES.CH4,
    CHAPTER_NAMES.CH5,
    CHAPTER_NAMES.CH9,
    CHAPTER_NAMES.CH10
  ],
  'Thống kê và Xác suất': [
    CHAPTER_NAMES.CH7,
    CHAPTER_NAMES.CH8
  ]
};

export interface SpecialExamConfig {
  key: string;
  label: string;
  description: string;
  fixedQuotas: Record<string, number>;
  fillChapters: string[];
  fallbackChapters: string[];
}

export const SPECIAL_EXAMS: Record<string, SpecialExamConfig> = {
  'Kiểm tra giữa học kỳ I': {
    key: 'Kiểm tra giữa học kỳ I',
    label: 'Kiểm tra giữa học kỳ I',
    description: 'Gồm Chương I, Chương II, Chương III — Tỉ lệ đều ~33% mỗi chương (5 - 5 - 6 câu, tự động bù qua lại để đủ 16 câu).',
    fixedQuotas: {},
    fillChapters: [CHAPTER_NAMES.CH1, CHAPTER_NAMES.CH2, CHAPTER_NAMES.CH3],
    fallbackChapters: []
  },
  'Kiểm tra cuối học kỳ I': {
    key: 'Kiểm tra cuối học kỳ I',
    label: 'Kiểm tra cuối học kỳ I',
    description: 'Chương I, II, III (mỗi chương 2 câu = 6 câu) + Chương IV, V (chia đều mỗi chương 5 câu, tự động trích đủ 16 câu).',
    fixedQuotas: {
      [CHAPTER_NAMES.CH1]: 2,
      [CHAPTER_NAMES.CH2]: 2,
      [CHAPTER_NAMES.CH3]: 2
    },
    fillChapters: [CHAPTER_NAMES.CH4, CHAPTER_NAMES.CH5],
    fallbackChapters: [CHAPTER_NAMES.CH1, CHAPTER_NAMES.CH2, CHAPTER_NAMES.CH3]
  },
  'Kiểm tra giữa học kỳ II': {
    key: 'Kiểm tra giữa học kỳ II',
    label: 'Kiểm tra giữa học kỳ II',
    description: 'Gồm Chương VI, Chương VII, Chương VIII (Chương 6, 7, 8) — Tỉ lệ đều ~33% mỗi chương (5 - 5 - 6 câu, tự động bù qua lại để đủ 16 câu).',
    fixedQuotas: {},
    fillChapters: [CHAPTER_NAMES.CH6, CHAPTER_NAMES.CH7, CHAPTER_NAMES.CH8],
    fallbackChapters: []
  },
  'Kiểm tra cuối học kỳ II': {
    key: 'Kiểm tra cuối học kỳ II',
    label: 'Kiểm tra cuối học kỳ II',
    description: 'Chương VI, VII, VIII (mỗi chương 2 câu = 6 câu) + Chương IX, X (chia đều mỗi chương 5 câu, tự động trích đủ 16 câu).',
    fixedQuotas: {
      [CHAPTER_NAMES.CH6]: 2,
      [CHAPTER_NAMES.CH7]: 2,
      [CHAPTER_NAMES.CH8]: 2
    },
    fillChapters: [CHAPTER_NAMES.CH9, CHAPTER_NAMES.CH10],
    fallbackChapters: [CHAPTER_NAMES.CH6, CHAPTER_NAMES.CH7, CHAPTER_NAMES.CH8]
  }
};


export const SCHOOL_CLASSES: Record<string, string[]> = {
  'THCS Nam Cửa Việt': ['9A8', '9A9', 'Học thêm'],
  'TH&THCS Đoàn Khuê': ['Học thêm']
};

export interface QuizResult {
  id?: string;
  name: string;
  class: string;
  school?: string;
  score: number;
  correctCount?: number;
  totalQuestions?: number;
  chapter?: string;
  encryptedAnswers?: string;
  tabSwitchCount?: number;
  startTime: Timestamp | Date;
  submittedAt: Timestamp | Date;
}

export interface ClassRoster {
  id?: string;
  school: string;
  class: string;
  students: string[];
  updatedAt?: Timestamp | Date;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
