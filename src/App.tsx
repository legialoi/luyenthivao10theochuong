/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import Quiz from './components/Quiz';
import AdminPanel from './components/AdminPanel';
import { Lock, GraduationCap, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, PART_CHAPTERS } from './lib/firebase';

// Utility for password hashing
async function hashSecret(text: string) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function App() {
  const [view, setView] = useState<'landing' | 'quiz' | 'admin' | 'admin_login'>('landing');
  const [adminCreds, setAdminCreds] = useState({ user: '', pass: '' });
  const [isQuickPractice, setIsQuickPractice] = useState(false);
  const [quickPracticeChapter, setQuickPracticeChapter] = useState('all');
  useEffect(() => {
    // Kiểm tra session cục bộ (local)
    const isAdminSession = sessionStorage.getItem('isAdmin') === 'true';
    if (isAdminSession) {
      setView('admin'); // Tự động vào lại Admin nếu đã đăng nhập
    }
  }, []);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = adminCreds.user.trim();
    const pass = adminCreds.pass.trim();

    // Hashes for: "101   101!@#" (1, 2, or 3 spaces)
    const h1 = 'd2cdf3f325473e109ce29c85e017aeb7763ae9b0a5d55cda5891ffd515e68266'; // 3 spaces
    const h2 = '6788db3d91c10705f4df8cf781ec7d1889813e339cd58ca68c4d51624b45502c'; // 2 spaces
    const h3 = '6f98725838531776992520330dc372f87ee56b0d91244e837ea8a46b5fd66835'; // 1 space
    
    const inputHash = await hashSecret(pass);

    if (user === 'legialoi' && (inputHash === h1 || inputHash === h2 || inputHash === h3)) {
      // Vì lỗi auth/admin-restricted-operation từ Firebase, chúng ta chuyển sang 
      // quản lý session cục bộ kết hợp với Relaxed Security Rules của Firestore.
      setView('admin');
      sessionStorage.setItem('isAdmin', 'true');
    } else {
      alert('Sai thông tin đăng nhập! Vui lòng kiểm tra lại Username/Password.');
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] text-slate-900 font-sans">
      <AnimatePresence mode="wait">
        {view === 'landing' && (
          <motion.div 
            key="landing"
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center p-4 pt-6 md:pt-10 relative"
          >
            {/* Nút đăng nhập Admin nhỏ ở góc trái */}
            <button 
              onClick={() => setView('admin_login')}
              className="absolute top-6 left-6 flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-slate-400 hover:text-blue-600 hover:border-blue-200 hover:shadow-sm transition-all text-[10px] font-bold group"
            >
              <Lock size={12} className="group-hover:scale-110 transition-transform" />
              ADMIN
            </button>

            <div className="text-center mb-4">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-200">Σ</div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-800">
                  LUYỆN THI <span className="text-blue-600">LÊ LỢI</span>
                </h1>
              </div>
              <p className="text-slate-500 text-[11px] md:text-xs max-w-xl mx-auto font-medium italic">
                Hệ thống luyện thi trắc nghiệm vào lớp 10
              </p>
            </div>

            <div className="w-full max-w-4xl px-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
                {/* Luyện thi Chính thức */}
                <button 
                  onClick={() => {
                    setIsQuickPractice(false);
                    setView('quiz');
                  }}
                  className="group relative w-full p-5 md:p-6 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 hover:border-blue-500 transition-all text-left flex flex-col items-center text-center cursor-pointer"
                >
                  <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-lg shadow-blue-200">
                    <GraduationCap size={20} />
                  </div>
                  <h3 className="text-lg font-black mb-1 text-slate-800">Luyện Thi Chính Thức</h3>
                  <p className="text-slate-500 mb-4 leading-relaxed text-[11px] font-medium max-w-xs">
                    Phần thi đầy đủ 16 câu (10 điểm), yêu cầu nhập tên lớp và lưu lịch sử bài làm.
                  </p>
                  <div className="inline-flex items-center gap-2 px-5 py-1.5 bg-blue-600 text-white rounded-lg font-bold text-sm shadow-lg shadow-blue-200 group-hover:bg-blue-700 transition-colors mt-auto">
                    VÀO THI NGAY <ArrowRight size={16} />
                  </div>
                </button>

                {/* Luyện tập Nhanh */}
                <div 
                  className="group relative w-full p-5 md:p-6 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 hover:border-amber-500 transition-all text-left flex flex-col items-center text-center"
                >
                  <div className="w-10 h-10 bg-amber-500 text-white rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-lg shadow-amber-200">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46L12.14 10l5.84.57a1 1 0 0 1 .77 1.62l-9.9 10.2a.5.5 0 0 1-.86-.46L9.86 14Z"/></svg>
                  </div>
                  <h3 className="text-lg font-black mb-1 text-slate-800">Luyện Tập Nhanh</h3>
                  <p className="text-slate-500 mb-4 leading-relaxed text-[11px] font-medium max-w-xs">
                    Thử sức nhẹ nhàng với 16 câu hỏi ngẫu nhiên lập tức mà không cần khai báo danh tính.
                  </p>

                  {/* Menu thả xuống chọn chương học */}
                  <div className="w-full mt-1 mb-4 select-none">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 text-center">
                      Chọn chương học luyện tập (16 câu)
                    </label>
                    <div className="relative max-w-xs mx-auto">
                      <select
                        value={quickPracticeChapter}
                        onChange={(e) => setQuickPracticeChapter(e.target.value)}
                        className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white text-xs font-bold text-slate-700 cursor-pointer appearance-none shadow-sm pr-8 pl-4"
                      >
                        <option value="all">⚡ Ngẫu nhiên tất cả chương</option>
                        {Object.values(PART_CHAPTERS).flat().map((chap, idx) => (
                          <option key={idx} value={chap}>
                            📖 {chap}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-right rotate-90"><path d="m9 18 6-6-6-6"/></svg>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      setIsQuickPractice(true);
                      setView('quiz');
                    }}
                    className="inline-flex items-center gap-2 px-6 py-2 bg-amber-500 text-white rounded-lg font-bold text-sm shadow-lg shadow-amber-100 hover:bg-amber-600 transition-all hover:scale-105 active:scale-95 cursor-pointer mt-auto"
                  >
                    LUYỆN TẬP NGAY <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>
            
            <footer className="mt-8 text-slate-400 text-[10px] md:text-sm font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              &copy; 2026 LUYỆN THI LÊ LỢI. Người tạo web: Lê Gia Lợi
            </footer>
          </motion.div>
        )}

        {view === 'quiz' && (
          <motion.div key="quiz" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-[#f0f4f8]">
            <nav className="h-14 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between shrink-0 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-base">Σ</div>
                <span className="text-base font-bold tracking-tight text-slate-800">LUYỆN THI <span className="text-blue-600">LÊ LỢI</span></span>
              </div>
              <button 
                onClick={() => {
                  setView('landing');
                  setIsQuickPractice(false);
                }} 
                className="text-slate-400 hover:text-blue-600 font-bold text-[10px] md:text-sm flex items-center gap-2 transition-colors cursor-pointer"
              >
                ← THOÁT
              </button>
            </nav>
            <div className="p-1 md:p-4 pb-10">
              <Quiz 
                onBack={() => {
                  setView('landing');
                  setIsQuickPractice(false);
                }} 
                isQuickPractice={isQuickPractice}
                quickPracticeChapter={quickPracticeChapter}
              />
            </div>
          </motion.div>
        )}

        {view === 'admin_login' && (
          <motion.div 
            key="login"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-h-screen flex items-center justify-center p-4 bg-[#f0f4f8]"
          >
            <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl shadow-slate-300 border border-white w-full max-w-md">
              <div className="text-center mb-10">
                 <div className="w-20 h-20 bg-slate-50 text-slate-900 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <Lock size={32} />
                 </div>
                 <h2 className="text-3xl font-black text-slate-800">Admin Access</h2>
                 <p className="text-slate-400 mt-2 font-medium">Xác thực quyền quản trị viên</p>
              </div>
              <form onSubmit={handleAdminLogin} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Tên đăng nhập</label>
                  <input 
                    type="text" 
                    placeholder=""
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-lg font-medium"
                    value={adminCreds.user}
                    onChange={e => setAdminCreds({...adminCreds, user: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Mật khẩu</label>
                  <input 
                    type="password" 
                    placeholder=""
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-lg font-medium"
                    value={adminCreds.pass}
                    onChange={e => setAdminCreds({...adminCreds, pass: e.target.value})}
                  />
                </div>
                <button className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition shadow-lg shadow-blue-200 mt-4 active:scale-95 transform">
                  ĐĂNG NHẬP
                </button>
                <div className="text-center">
                  <button 
                    type="button"
                    onClick={() => setView('landing')} 
                    className="text-slate-400 font-bold text-sm tracking-widest hover:text-slate-600 transition uppercase"
                  >
                    HỦY BỎ
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}

        {view === 'admin' && (
          <div className="min-h-screen bg-[#f0f4f8]">
            <AdminPanel onLogout={() => { 
              setView('landing'); 
              sessionStorage.removeItem('isAdmin');
              auth.signOut();
            }} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
