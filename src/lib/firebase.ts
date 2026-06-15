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
  category: string;
  chapter?: string;
  createdAt: Timestamp | Date;
}

export const PART_CHAPTERS: Record<string, string[]> = {
  'Số và Đại số': [
    'Chương I. PHƯƠNG TRÌNH VÀ HỆ HAI PHƯƠNG TRÌNH BẬC NHẤT HAI ẨN',
    'Chương II. PHƯƠNG TRÌNH VÀ BẤT PHƯƠNG TRÌNH BẬC NHẤT MỘT ẨN',
    'Chương III. CĂN BẬC HAI VÀ CĂN BẬC BA',
    'Chương VI. HÀM SỐ y = ax² (a ≠ 0). PHƯƠNG TRÌNH BẬC HAI MỘT ẨN'
  ],
  'Hình học và Đo lường': [
    'Chương IV. HỆ THỨC LƯỢNG TRONG TAM GIÁC VUÔNG',
    'Chương V. ĐƯỜNG TRÒN',
    'Chương IX. ĐƯỜNG TRÒN NGOẠI TIẾP VÀ ĐƯỜNG TRÒN NỘI TIẾP',
    'Chương X. MỘT SỐ HÌNH KHỐI TRONG THỰC TIỄN'
  ],
  'Thống kê và Xác suất': [
    'Chương VII. TẦN SỐ VÀ TẦN SỐ TƯƠNG ĐỐI',
    'Chương VIII. XÁC SUẤT CỦA BIẾN CỐ TRONG MỘT SỐ MÔ HÌNH XÁC SUẤT ĐƠN GIẢN'
  ]
};

export interface QuizResult {
  id?: string;
  name: string;
  class: string;
  school?: string;
  score: number;
  startTime: Timestamp | Date;
  submittedAt: Timestamp | Date;
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
