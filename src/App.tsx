import { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, Circle, ChevronLeft, BookOpen, Settings, LogIn, LogOut, Send, Bot, User as UserIcon, Loader2, PanelLeft, History } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { LESSONS, themeColors, themeOrder } from './data';
import { testsData } from './testsData';
import { auth, db, loginWithGoogle, logout, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp } from 'firebase/firestore';

export type ChatMessage = { role: 'user' | 'assistant', content: string };
export type ChatSession = {
  id: string; // lesson.id or 'global'
  title: string;
  theme: string;
  messages: ChatMessage[];
  updatedAt: number;
};

const loadChatHistory = (): Record<string, ChatSession> => {
  try {
    return JSON.parse(localStorage.getItem('deepseek_chats') || '{}');
  } catch {
    return {};
  }
};

const saveChatSession = (session: ChatSession) => {
  const history = loadChatHistory();
  history[session.id] = session;
  localStorage.setItem('deepseek_chats', JSON.stringify(history));
};

const removeChatSession = (id: string) => {
  const history = loadChatHistory();
  delete history[id];
  localStorage.setItem('deepseek_chats', JSON.stringify(history));
};

function TestBlock({ test }: { test: any }) {

  const [answers, setAnswers] = useState<Record<number, string>>({});

  const handleSelect = (idx: number, opt: string) => {
    if (answers[idx]) return; // prevent changing after answered
    const letter = opt.charAt(0);
    setAnswers(prev => ({ ...prev, [idx]: letter }));
  };

  const hasAnyAnswer = Object.keys(answers).length > 0;

  return (
    <div className="bg-slate-50 p-6 rounded-3xl mt-8 border border-slate-100">
      <h3 className="text-xl font-bold text-slate-800 mb-6">Проверьте себя</h3>
      <div className="space-y-6">
        {test.items.map((item: any, idx: number) => {
          const selected = answers[idx];
          const isAnswered = !!selected;
          
          return (
            <div key={idx} className="space-y-3">
              <p className="font-semibold text-slate-800 text-base md:text-lg">{idx + 1}. {item.question}</p>
              <div className="space-y-2.5">
                {item.options.map((opt: string, i: number) => {
                  const letter = opt.charAt(0);
                  const isSelected = selected === letter;
                  const isCorrectOpt = letter === item.correct;
                  const showAsCorrect = isAnswered && isCorrectOpt;
                  const showAsWrong = isAnswered && isSelected && !isCorrectOpt;
                  
                  let btnClass = "w-full text-left px-5 py-3.5 rounded-2xl border-2 transition-all font-medium text-slate-700 ";
                  
                  if (isAnswered) {
                    if (showAsCorrect) btnClass += "bg-green-100 border-green-400 text-green-900";
                    else if (showAsWrong) btnClass += "bg-red-50 border-red-300 text-red-900";
                    else btnClass += "bg-white border-slate-100 opacity-60 cursor-default";
                  } else {
                    btnClass += "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50";
                  }

                  return (
                    <button
                      key={i}
                      disabled={isAnswered}
                      onClick={() => handleSelect(idx, opt)}
                      className={btnClass}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      
      {hasAnyAnswer && (
        <button
          onClick={() => setAnswers({})}
          className="mt-8 w-full py-4 rounded-2xl text-lg font-bold bg-white border-2 border-slate-300 text-slate-700 hover:bg-slate-50 transition-all font-sans"
        >
          Пройти заново
        </button>
      )}
    </div>
  );
}

function DeepSeekChat({ lesson, sessionId, isGlobal = false, onOpenHistory }: { lesson: any, sessionId: string, isGlobal?: boolean, onOpenHistory?: () => void }) {
  const [apiKey, setApiKey] = useState(() => {
    try {
      return (import.meta as any).env.VITE_DEEPSEEK_API_KEY || localStorage.getItem('deepseek_api_key') || '';
    } catch {
      return localStorage.getItem('deepseek_api_key') || '';
    }
  });
  const [isApiKeySet, setIsApiKeySet] = useState(!!apiKey);
  
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const history = loadChatHistory();
    return history[sessionId]?.messages || [];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (messages.length > 0) {
      saveChatSession({
        id: sessionId,
        title: lesson ? lesson.title : 'Общий помощник',
        theme: lesson ? lesson.theme : 'Общая тема',
        messages,
        updatedAt: Date.now()
      });
    }
  }, [messages, sessionId, lesson]);

  const saveKey = (key: string) => {
    setApiKey(key);
    setIsApiKeySet(!!key);
    if (key) {
      localStorage.setItem('deepseek_api_key', key);
    } else {
      localStorage.removeItem('deepseek_api_key');
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !apiKey) return;
    
    const userMsg = input.trim();
    setInput('');
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userMsg }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const systemPrompt = lesson 
        ? `Ты преподаватель физики и помощник для экзаменов. Ученик изучает следующий материал (Тема: ${lesson.theme}, Название: ${lesson.title}):\n${lesson.content}\n\nТвоя задача — отвечать на вопросы ученика по этому билету, объяснять непонятные моменты, решения или задачи подробно и понятно. Поясняй все так, чтобы было понятно. Отвечай на русском языке. Используй markdown.`
        : `Ты преподаватель физики и помощник для экзаменов. Твоя задача — отвечать на любые вопросы ученика по физике за 8 класс, объяснять непонятные моменты подробно и понятно, без привязки к конкретному билету. Отвечай на русском языке. Используй markdown.`;
      
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...newMessages.map(m => ({ role: m.role, content: m.content }))
      ];

      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: apiMessages,
          stream: true
        })
      });

      if (!res.ok) throw new Error(await res.text());
      
      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let assistantMessage = '';
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
              try {
                const data = JSON.parse(trimmedLine.slice(6));
                if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                  assistantMessage += data.choices[0].delta.content;
                  setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantMessage };
                    return newMessages;
                  });
                }
              } catch (e) {
                // ignore partial JSON errors
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'assistant', content: `Ошибка: ${e.message || 'Не удалось получить ответ'}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isApiKeySet) {
    return (
      <div className={isGlobal 
        ? "bg-slate-50 border-y sm:border border-slate-200 p-4 sm:p-6 sm:rounded-3xl rounded-3xl flex-1 flex flex-col"
        : "bg-slate-50 border border-slate-200 p-4 sm:p-6 rounded-2xl sm:rounded-3xl mt-8 w-full"}>
        <div className="flex items-center gap-2 sm:gap-3 mb-4 flex-shrink-0">
          {onOpenHistory && (
             <button 
               onClick={onOpenHistory}
               className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors shrink-0"
               title="История диалогов"
             >
               <PanelLeft className="w-5 h-5" />
             </button>
          )}
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">DeepSeek AI Помощник</h3>
            <p className="text-xs text-slate-500">Введите API ключ DeepSeek для активации</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input 
            type="password" 
            placeholder="sk-..." 
            className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <button onClick={() => saveKey(apiKey)} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition">
            Сохранить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={isGlobal 
        ? "bg-white sm:bg-slate-50 sm:border border-slate-200 p-2 sm:p-6 sm:rounded-3xl rounded-3xl flex-1 flex flex-col min-h-0"
        : "bg-slate-50 border border-slate-200 p-4 sm:p-6 rounded-2xl sm:rounded-3xl mt-8 flex flex-col w-full"}>
      <div className="flex items-center justify-between mb-4 flex-shrink-0 px-2 sm:px-0">
        <div className="flex items-center gap-2 sm:gap-3">
          {onOpenHistory && (
             <button 
               onClick={onOpenHistory}
               className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors shrink-0"
               title="История диалогов"
             >
               <PanelLeft className="w-5 h-5" />
             </button>
          )}
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Помощник DeepSeek</h3>
            <p className="text-xs text-slate-500 leading-tight">Задайте вопрос по текущей теме</p>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 custom-scrollbar min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 mt-10 text-sm p-4 bg-white sm:bg-transparent rounded-2xl">
            Задайте свой первый вопрос, и нейросеть объяснит решение, материал билета или ответит на любой другой вопрос.
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-full sm:max-w-[90%] rounded-2xl px-4 py-3 text-sm overflow-hidden ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-slate-200 text-slate-700 rounded-bl-none'}`}>
               <div className={`markdown-body text-sm break-words overflow-x-auto ${msg.role === 'user' ? 'text-white' : ''}`} style={msg.role === 'user' ? { color: 'white' } : {}}>
                  <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</Markdown>
               </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
             <div className="bg-white border border-slate-200 text-slate-400 rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2">
               <Loader2 className="w-4 h-4 animate-spin" />
               <span className="text-sm">Печатает...</span>
             </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-shrink-0 mt-auto">
        <input 
          type="text" 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Спросите что-нибудь..."
          className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button 
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          className="bg-indigo-600 text-white w-12 flex-shrink-0 flex items-center justify-center rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function GlobalChatScreen({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState<Record<string, ChatSession>>({});
  const [activeSessionId, setActiveSessionId] = useState<string>('global');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setHistory(loadChatHistory());
    
    // Listen for updates (if updated in another tab or component)
    const interval = setInterval(() => {
      setHistory(loadChatHistory());
    }, 2000);
    return () => clearInterval(interval);
  }, [activeSessionId]); // Reload when switching sessions too

  const activeLesson = useMemo(() => {
    if (activeSessionId === 'global') return null;
    return LESSONS.find(l => l.id === activeSessionId) || null;
  }, [activeSessionId]);

  const sortedSessions = Object.values(history).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="animate-in slide-in-from-bottom-4 fade-in duration-300 w-full flex-1 flex flex-col mt-2 sm:mt-4 min-h-0 relative">
      
      <div className="flex items-center w-full px-2 sm:px-0 mb-2 sm:mb-4 shrink-0 relative z-10">
        <button
          onClick={onClose}
          className="group flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 mr-1 group-hover:-translate-x-1 transition-transform" />
          Назад к темам
        </button>
      </div>

      {/* Sliding Drawer Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/10 z-40 backdrop-blur-[2px] transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sliding Drawer */}
      <div className={`fixed top-0 left-0 h-full w-[85vw] max-w-[320px] bg-white/95 backdrop-blur-xl border-r border-indigo-50 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-50 transform transition-transform duration-500 flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 sm:p-6 flex items-center justify-between border-b border-slate-100/60">
          <h3 className="font-medium text-slate-800 text-lg flex items-center gap-2">
             <History className="w-5 h-5 text-indigo-500" />
             История
          </h3>
          <button onClick={() => setIsSidebarOpen(false)} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
             <ChevronLeft className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-2 custom-scrollbar">
          <button
            onClick={() => { setActiveSessionId('global'); setIsSidebarOpen(false); }}
            className={`text-left px-3 py-3 sm:px-4 sm:py-4 rounded-2xl text-sm font-medium transition-all flex flex-col gap-1 ${
              activeSessionId === 'global' ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-50 text-slate-700 border border-transparent hover:border-slate-200'
            }`}
          >
            <span className="font-bold text-sm sm:text-base">Общий помощник</span>
            <span className={`text-xs ${activeSessionId === 'global' ? 'text-indigo-200' : 'text-slate-400'}`}>Любая тема по физике</span>
          </button>

          {sortedSessions.filter(s => s.id !== 'global').map(session => (
            <button
              key={session.id}
              onClick={() => { setActiveSessionId(session.id); setIsSidebarOpen(false); }}
              className={`text-left px-3 py-3 sm:px-4 sm:py-4 rounded-2xl text-sm font-medium transition-all flex flex-col gap-1.5 ${
                activeSessionId === session.id ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-50 text-slate-700 border border-transparent hover:border-slate-200'
              }`}
            >
              <div className="flex justify-between items-start gap-2 w-full">
                <span className="font-bold leading-tight line-clamp-2">{session.title}</span>
                <span className={`text-[10px] whitespace-nowrap shrink-0 ${activeSessionId === session.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                  {new Date(session.updatedAt).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})}
                </span>
              </div>
              <span className={`text-[10px] line-clamp-2 ${activeSessionId === session.id ? 'text-indigo-200' : 'text-slate-400'}`}>{session.theme}</span>
            </button>
          ))}
          {sortedSessions.length === 0 && (
             <div className="text-center text-slate-400 text-sm py-8 px-4 bg-slate-50 rounded-2xl">
               Пока здесь ничего нет.
             </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-h-0 relative z-0">
        <DeepSeekChat key={activeSessionId} lesson={activeLesson} sessionId={activeSessionId} isGlobal={true} onOpenHistory={() => setIsSidebarOpen(true)} />
      </div>

    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [completedTickets, setCompletedTickets] = useState<Set<string>>(new Set());
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'theme' | 'ticket'>('theme');
  const [examDate, setExamDate] = useState<string | null>(null);
  const [firstLoginDate, setFirstLoginDate] = useState<number | null>(null);
  const [pastExams, setPastExams] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showGlobalChat, setShowGlobalChat] = useState(false);
  const [tempExamDate, setTempExamDate] = useState('');

  const [isExamMode, setIsExamMode] = useState<boolean>(false);
  const [examQuestions, setExamQuestions] = useState<any[]>([]);
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [showExamResults, setShowExamResults] = useState<boolean>(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [selectedTicketId, isExamMode, showExamResults, showGlobalChat]);

  const startExam = () => {
    const allQuestionsPool = testsData.flatMap(t => t.tests.flatMap(test => test.items));
    const shuffled = [...allQuestionsPool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 25);
    setExamQuestions(selected);
    setExamAnswers({});
    setShowExamResults(false);
    setIsExamMode(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Firebase auth & data
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // user profile
        const userRef = doc(db, 'users', u.uid);
        const unsubUser = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.examDate !== undefined) setExamDate(data.examDate);
            const ts = snap.get('createdAt', { serverTimestamps: 'estimate' });
            if (ts) setFirstLoginDate(ts.toMillis());
          } else {
             // Create initial profile
             setDoc(userRef, {
               createdAt: serverTimestamp(),
               updatedAt: serverTimestamp(),
             }).catch(e => handleFirestoreError(e, OperationType.CREATE, 'users'));
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, 'users'));

        // completed tickets
        const ticketsRef = collection(db, `users/${u.uid}/completedTickets`);
        const unsubTickets = onSnapshot(ticketsRef, (snap) => {
          const tickets = new Set<string>();
          snap.forEach(d => tickets.add(d.id));
          setCompletedTickets(tickets);
        }, (err) => handleFirestoreError(err, OperationType.LIST, 'completedTickets'));

        // past exams
        const examsRef = collection(db, `users/${u.uid}/examResults`);
        const unsubExams = onSnapshot(examsRef, (snap) => {
          const examsData = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            date: doc.data().date?.toMillis() || Date.now()
          })).sort((a: any, b: any) => b.date - a.date);
          setPastExams(examsData);
        }, (err) => handleFirestoreError(err, OperationType.LIST, 'examResults'));

        return () => {
          unsubUser();
          unsubTickets();
          unsubExams();
        };
      } else {
        setCompletedTickets(new Set());
        setExamDate(null);
        setFirstLoginDate(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const toggleCompletion = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!user) {
      alert("Необходимо войти в аккаунт");
      return;
    }
    
    if (completedTickets.has(id)) {
      await deleteDoc(doc(db, `users/${user.uid}/completedTickets/${id}`));
    } else {
      await setDoc(doc(db, `users/${user.uid}/completedTickets/${id}`), {
        id,
        completedAt: serverTimestamp()
      });
    }
  };

  const saveSettings = async () => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        examDate: tempExamDate,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setShowSettings(false);
    } catch (e: any) {
      alert("Ошибка сохранения: " + e.message);
      console.error(e);
      handleFirestoreError(e, OperationType.UPDATE, 'users');
    }
  };

  const selectedTicket = LESSONS.find(t => t.id === selectedTicketId);
  const totalTickets = LESSONS.length;
  const masteredTickets = completedTickets.size;
  const progressPercentage = Math.round((masteredTickets / totalTickets) * 100) || 0;
  
  let timeProgressPercentage = 0;
  const startOfMay = new Date(new Date().getFullYear(), 4, 1).getTime();
  let daysLeft = 0;
  
  if (examDate) {
    const examMs = new Date(examDate).getTime();
    const nowMs = Date.now();
    const totalMs = examMs - startOfMay;
    const passedMs = nowMs - startOfMay;
    
    daysLeft = Math.ceil((examMs - nowMs) / (1000 * 60 * 60 * 24));
    
    if (totalMs > 0) {
      timeProgressPercentage = Math.max(0, Math.min(100, (passedMs / totalMs) * 100));
    } else {
      timeProgressPercentage = 100;
    }
  }

  const tasksLeft = totalTickets - masteredTickets;
  const tasksPerDay = (daysLeft > 0 && tasksLeft > 0) ? Math.ceil(tasksLeft / daysLeft) : 0;
  
  const themeStats = useMemo(() => {
    const stats: Record<string, { total: number, done: number }> = {
      "Тепловые явления": { total: 0, done: 0 },
      "Электричество": { total: 0, done: 0 },
      "Магнетизм": { total: 0, done: 0 },
      "Оптика": { total: 0, done: 0 },
      "ЗАДАЧА": { total: 0, done: 0 },
    };
    LESSONS.forEach(l => {
      if (stats[l.theme]) {
        stats[l.theme].total++;
        if (completedTickets.has(l.id)) {
          stats[l.theme].done++;
        }
      }
    });
    return stats;
  }, [completedTickets]);
  
  const sortedLessons = useMemo(() => {
    return [...LESSONS].sort((a, b) => {
      if (sortBy === 'theme') {
        const orderDiff = (themeOrder[a.theme] || 99) - (themeOrder[b.theme] || 99);
        if (orderDiff !== 0) return orderDiff;
        return a.originalTicketNumber - b.originalTicketNumber;
      } else {
        const numDiff = a.originalTicketNumber - b.originalTicketNumber;
        if (numDiff !== 0) return numDiff;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      }
    });
  }, [sortBy]);

  const groupedByTicket = useMemo(() => {
    if (sortBy !== 'ticket') return null;
    const groups = new Map<number, typeof sortedLessons>();
    sortedLessons.forEach(lesson => {
      if (!groups.has(lesson.originalTicketNumber)) {
        groups.set(lesson.originalTicketNumber, []);
      }
      groups.get(lesson.originalTicketNumber)!.push(lesson);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [sortedLessons, sortBy]);

  const nextTicket = sortedLessons.find(t => !completedTickets.has(t.id));

  if (isExamMode) {
    if (showExamResults) {
      const correctCount = examQuestions.reduce((acc, q, idx) => {
        return acc + (examAnswers[idx] === q.correct ? 1 : 0);
      }, 0);
      const isPassed = correctCount > 19;

      return (
        <div className="w-full min-h-screen bg-slate-50 p-4 md:p-8 font-sans flex flex-col items-center">
            <div className="max-w-[800px] w-full flex flex-col gap-6">
                <button onClick={() => setIsExamMode(false)} className="self-start text-slate-500 hover:text-slate-800 flex items-center gap-2 mb-4 font-medium transition-colors">
                    <ChevronLeft className="w-5 h-5" /> Вернуться на главную
                </button>
                <div className="bg-white p-8 sm:p-12 rounded-[2rem] text-center shadow-lg border border-slate-100 relative overflow-hidden flex flex-col items-center">
                    <h2 className="text-3xl font-black text-slate-800 mb-6">Результат теста</h2>
                    <div className="text-7xl font-black mb-8 tracking-tighter">
                        <span className={isPassed ? "text-green-500" : "text-red-500"}>{correctCount}</span>
                        <span className="text-slate-300 text-5xl">/25</span>
                    </div>
                    <div className={`px-10 py-3 rounded-2xl text-2xl font-black uppercase tracking-widest ${isPassed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {isPassed ? "Сдал!" : "Не сдал"}
                    </div>
                </div>

                <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col gap-4">
                    <h3 className="font-bold text-slate-800 text-xl mb-2">Детали:</h3>
                    {examQuestions.map((q, idx) => {
                        const isCorrect = examAnswers[idx] === q.correct;
                        return (
                            <div key={idx} className="flex items-center justify-between p-5 rounded-2xl border bg-slate-50 border-slate-100">
                                <span className="font-bold text-slate-600">Вопрос {idx + 1}</span>
                                <span className={`font-black uppercase tracking-wider text-sm px-4 py-1.5 rounded-xl ${isCorrect ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                    {isCorrect ? "Правильно" : "Неправильно"}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
      );
    }

    const isAllAnswered = Object.keys(examAnswers).length === examQuestions.length;

    return (
        <div className="w-full min-h-screen bg-slate-50 p-4 md:p-8 font-sans flex flex-col items-center">
            <div className="max-w-[800px] w-full flex flex-col gap-6 relative">
                <div className="flex justify-between items-center bg-white p-5 rounded-3xl shadow-sm border border-slate-100 sticky top-4 z-10 backdrop-blur-md bg-white/90">
                   <button onClick={() => setIsExamMode(false)} className="text-slate-500 hover:text-slate-800 flex items-center gap-2 font-medium">
                       <ChevronLeft className="w-5 h-5" /> Отмена
                   </button>
                   <div className="font-bold text-slate-700 bg-slate-100 px-4 py-1.5 rounded-full">
                      {Object.keys(examAnswers).length} / 25
                   </div>
                </div>

                <div className="flex flex-col gap-6 mt-4">
                    {examQuestions.map((item, idx) => (
                        <div key={idx} className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100">
                            <p className="font-bold text-slate-800 text-lg md:text-xl mb-6 leading-snug">{idx + 1}. {item.question}</p>
                            <div className="space-y-3">
                                {item.options.map((opt: string, i: number) => {
                                    const letter = opt.charAt(0);
                                    const isSelected = examAnswers[idx] === letter;
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => setExamAnswers(prev => ({ ...prev, [idx]: letter }))}
                                            className={`w-full text-left px-6 py-4 rounded-2xl border-2 transition-all font-semibold md:text-lg ${isSelected ? "bg-indigo-50 border-indigo-500 text-indigo-900 shadow-[0_0_0_4px_rgba(99,102,241,0.1)]" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
                                        >
                                            {opt}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="sticky bottom-4 z-10 mt-8 mb-8 pb-8">
                  <button
                      disabled={!isAllAnswered}
                      onClick={async () => {
                        if (user) {
                          const correctCount = examQuestions.reduce((acc, q, idx) => acc + (examAnswers[idx] === q.correct ? 1 : 0), 0);
                          const isPassed = correctCount > 19;
                          try {
                            const newDoc = doc(collection(db, `users/${user.uid}/examResults`));
                            await setDoc(newDoc, {
                              score: correctCount,
                              passed: isPassed,
                              date: serverTimestamp()
                            });
                          } catch (e) {
                            handleFirestoreError(e, OperationType.CREATE, 'examResults');
                          }
                        }
                        setShowExamResults(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={`w-full p-6 rounded-[2rem] text-xl font-black uppercase tracking-wider transition-all shadow-xl ${isAllAnswered ? "bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.02] shadow-indigo-200" : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"}`}
                  >
                      Готово
                  </button>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-slate-50 p-4 md:p-8 font-sans flex flex-col selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-[1200px] w-full mx-auto flex-1 flex flex-col gap-6">
        
        {/* Header Section */}
        <header className="flex flex-row justify-between items-center mb-2">
          <h1 className="text-2xl sm:text-3xl font-light text-slate-800">
            Физика <span className="font-bold">Подготовка</span>
          </h1>
          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={() => setShowGlobalChat(true)}
              className="bg-indigo-100/50 hover:bg-indigo-100 text-indigo-700 p-2 sm:px-4 sm:py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors relative"
            >
              <Bot className="w-5 h-5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">ИИ Ассистент</span>
            </button>
            {user ? (
              <div className="flex items-center gap-3">
                <button onClick={logout} className="text-sm font-medium text-slate-500 hover:text-slate-700 hidden sm:flex items-center gap-1">
                  <LogOut className="w-4 h-4" /> Выйти
                </button>
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || 'User'} className="w-10 h-10 rounded-full bg-slate-100 object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold">
                    {user.email?.[0].toUpperCase() || 'U'}
                  </div>
                )}
              </div>
            ) : (
              <button onClick={loginWithGoogle} className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-100 transition-colors">
                <LogIn className="w-4 h-4" /> Google Вход
              </button>
            )}
          </div>
        </header>

        {/* Global Progress Header */}
        {!showGlobalChat && (
        <div className="bg-white rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="flex-1 w-full space-y-4">
            <div className="flex justify-between text-sm font-bold text-green-600">
              <span className="flex items-center gap-2">
                Прогресс изучения 
                {tasksPerDay > 0 && <span className="text-xs font-medium opacity-80 bg-green-50 px-2 py-0.5 rounded-full">~{tasksPerDay} вопр/день</span>}
              </span>
              <span>{progressPercentage}% ({masteredTickets}/{totalTickets})</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-1000 ease-out" style={{ width: `${progressPercentage}%` }}></div>
            </div>
            
            <div className="flex justify-between text-sm font-bold pt-2">
              <span className="flex items-center gap-1.5 text-blue-600 uppercase">
                ОСТАЛОСЬ: {examDate ? <span className="font-black">{Math.max(0, daysLeft)} дн.</span> : "—"}
              </span>
              <button 
                onClick={() => { 
                  if (!user) {
                    alert("Сначала выполните вход!");
                    return;
                  }
                  setTempExamDate(examDate || ''); 
                  setShowSettings(true); 
                }} 
                className="text-blue-500 hover:text-blue-600 transition underline decoration-dotted underline-offset-4 flex items-center gap-1.5"
              >
                {examDate ? new Date(examDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'Задать дату'}
                <Settings className="w-4 h-4 opacity-75" />
              </button>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-out" style={{ width: `${timeProgressPercentage}%` }}></div>
            </div>
          </div>
        </div>
        )}

        {/* Dynamic Area */}
        {showGlobalChat ? (
          <GlobalChatScreen onClose={() => setShowGlobalChat(false)} />
        ) : !selectedTicket ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 animate-in fade-in duration-500">
            
            {/* THEMES COLUMN */}
            <div className="col-span-1 lg:col-span-4 lg:col-start-1 lg:row-start-1 order-1 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {Object.entries(themeStats).map(([themeName, stats]) => {
                  const themeColorClass = themeColors[themeName] || "bg-slate-50 text-slate-700 border-slate-200";
                  return (
                    <div key={themeName} className={`p-3 rounded-2xl border flex flex-col justify-between relative overflow-hidden ${themeColorClass}`}>
                      <div className="relative z-10 flex flex-col h-full justify-between gap-3">
                        <span className="font-bold text-[11px] sm:text-xs tracking-tight leading-tight uppercase">{themeName}</span>
                        <div className="flex items-center justify-between mt-auto">
                          <span className="text-sm font-black tracking-tighter opacity-90">{stats.done}/{stats.total}</span>
                          {stats.done === stats.total && stats.total > 0 && (
                            <CheckCircle2 className="w-4 h-4 opacity-80" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TICKETS COLUMN */}
            <div className="col-span-1 lg:col-span-8 lg:col-start-5 lg:row-start-1 lg:row-span-2 order-2 flex flex-col h-full">
              
              {/* Ticket List Card */}
              <div className="flex flex-col h-full bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-100">
                <div className="pb-4 flex flex-col sm:flex-row justify-between sm:items-center gap-3 sm:gap-0">
                  <h2 className="font-bold text-slate-800 text-lg">Порядок изучения</h2>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                      onClick={() => setSortBy('theme')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${sortBy === 'theme' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      По темам
                    </button>
                    <button 
                      onClick={() => setSortBy('ticket')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${sortBy === 'ticket' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      По билетам
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 space-y-3">
                  {sortBy === 'theme' ? (
                    <div className="space-y-2">
                      {sortedLessons.map((ticket) => {
                        const isDone = completedTickets.has(ticket.id);
                        return (
                          <div 
                            key={ticket.id}
                            onClick={() => setSelectedTicketId(ticket.id)}
                            className={`flex items-center p-3 rounded-2xl cursor-pointer transition-all relative ${
                              isDone 
                                ? "bg-green-50/50 hover:bg-green-50" 
                                : "bg-slate-50 hover:bg-slate-100"
                            }`}
                          >
                            <div 
                              onClick={(e) => toggleCompletion(e, ticket.id)}
                              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mr-3 sm:mr-4 transition-transform hover:scale-110 cursor-pointer ${
                                isDone 
                                  ? "bg-green-500 text-white" 
                                  : "border-2 border-slate-300 text-transparent hover:border-green-400"
                              }`}
                            >
                              {isDone && (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                              )}
                            </div>
                            
                            <div className="flex-1 min-w-0 pr-8 sm:pr-2">
                              <p className={`text-[10px] uppercase tracking-wider font-bold mb-1 whitespace-nowrap overflow-hidden text-ellipsis px-2 py-0.5 rounded inline-block ${
                                isDone ? "text-green-600 bg-green-100/50" : (themeColors[ticket.theme] || themeColors["Общая тема"])
                              }`}>
                                {ticket.theme}
                              </p>
                              <h4 className={`text-sm tracking-tight leading-snug mt-0.5 line-clamp-2 sm:line-clamp-none ${
                                isDone ? "text-slate-600 line-through opacity-80 font-medium" : "text-slate-800 font-semibold"
                              }`}>
                                {ticket.title}
                              </h4>
                            </div>
                            
                            <div className="text-right flex-shrink-0 flex flex-col items-end justify-center absolute top-2 right-3 sm:static sm:ml-4">
                              <span className="text-[9px] uppercase tracking-widest font-medium text-slate-400 mb-0.5 sm:mb-1 hidden sm:block">Билет</span>
                              <span className="text-xs sm:text-2xl font-bold tracking-tight text-slate-500 sm:text-slate-600 leading-none">№{String(ticket.originalTicketNumber).padStart(2, '0')}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    groupedByTicket!.map(([ticketNum, questions]) => {
                      const isAllDone = questions.every(q => completedTickets.has(q.id));
                      return (
                        <div key={ticketNum} className={`flex flex-col sm:flex-row p-3 rounded-3xl transition-all gap-3 sm:gap-4 relative ${isAllDone ? "bg-green-50/50" : "bg-slate-50"}`}>
                          <div className="flex-1 space-y-2 min-w-0">
                            {questions.map((ticket) => {
                              const isDone = completedTickets.has(ticket.id);
                              return (
                                <div 
                                  key={ticket.id}
                                  onClick={() => setSelectedTicketId(ticket.id)}
                                  className={`flex items-start sm:items-center p-3 rounded-2xl cursor-pointer transition-all ${
                                    isDone 
                                      ? "bg-green-100/50 hover:bg-green-100/80" 
                                      : "bg-white hover:bg-slate-50"
                                  }`}
                                >
                                  <div 
                                    onClick={(e) => toggleCompletion(e, ticket.id)}
                                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mr-3 sm:mr-4 transition-transform hover:scale-110 cursor-pointer mt-1 sm:mt-0 ${
                                      isDone 
                                        ? "bg-green-500 text-white" 
                                        : "border-2 border-slate-300 text-transparent hover:border-green-400"
                                    }`}
                                  >
                                    {isDone && (
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                                    )}
                                  </div>
                                  
                                  <div className="flex-1 min-w-0 pr-8 sm:pr-2">
                                    <p className={`text-[10px] uppercase tracking-wider font-bold mb-1 whitespace-nowrap overflow-hidden text-ellipsis px-2 py-0.5 rounded inline-block ${
                                      isDone ? "text-green-600 bg-green-100/50" : (themeColors[ticket.theme] || themeColors["Общая тема"])
                                    }`}>
                                      {ticket.theme}
                                    </p>
                                    <h4 className={`text-sm tracking-tight leading-snug mt-0.5 line-clamp-2 sm:line-clamp-none ${
                                      isDone ? "text-slate-600 line-through opacity-80 font-medium" : "text-slate-800 font-semibold"
                                    }`}>
                                      {ticket.title}
                                    </h4>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="w-auto sm:w-24 flex-shrink-0 flex flex-row sm:flex-col items-center justify-center sm:border-l border-slate-200/60 sm:ml-1 sm:pl-3 absolute top-3 right-4 sm:static">
                            <span className="text-[9px] sm:text-[10px] uppercase tracking-widest font-medium text-slate-400 mb-1 hidden sm:block">Билет</span>
                            <span className="text-xs sm:text-4xl font-bold tracking-tight text-slate-500 sm:text-slate-600 leading-none sm:mb-2">№{String(ticketNum).padStart(2, '0')}</span>
                            {isAllDone && (
                              <div className="ml-2 sm:ml-0">
                                <span className="hidden sm:block text-[9px] uppercase font-bold text-green-600 bg-green-100/50 px-2 py-0.5 rounded-full border border-green-200/50 text-center justify-center w-full max-w-[80px]">Пройден</span>
                                <div className="sm:hidden w-2 h-2 rounded-full bg-green-500" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

              </div>
            </div>
            
            {/* EXAM COLUMN */}
            <div className="col-span-1 lg:col-span-4 lg:col-start-1 lg:row-start-2 order-3 flex flex-col h-full">
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col flex-1">
                <button 
                  onClick={startExam} 
                  className="w-full py-5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-[1.5rem] font-black text-xl tracking-wide uppercase hover:scale-[1.02] hover:shadow-xl hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg active:scale-95 mb-6"
                >
                  Пройти тест
                </button>

                <div className="flex flex-col flex-1">
                  <h3 className="font-bold text-slate-700 uppercase tracking-wider text-xs mb-3 px-1">Прошлые результаты</h3>
                  {pastExams.length > 0 ? (
                    <div className="flex flex-col gap-2">
                       {pastExams.map((exam, i) => (
                         <div key={i} className="flex justify-between items-center bg-slate-50 border border-slate-100 p-3 rounded-2xl">
                            <span className="text-slate-500 font-medium text-sm">
                              {exam.date ? new Date(exam.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '—'}
                            </span>
                            <div className="flex items-center gap-3">
                               <span className="font-bold text-slate-700 tracking-tight">{exam.score}/25</span>
                               <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-lg ${exam.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                 {exam.passed ? "Сдал" : "Не сдал"}
                               </span>
                            </div>
                         </div>
                       ))}
                    </div>
                  ) : (
                     <div className="flex-1 flex flex-col items-center justify-center py-6 text-slate-400">
                       <BookOpen className="w-8 h-8 mb-2 opacity-50" />
                       <p className="text-center text-sm font-medium">Сдайте тест, чтобы увидеть<br/>результаты</p>
                     </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        ) : (
          /* Страница конкретного билета */
          <div className="animate-in slide-in-from-right-4 fade-in duration-300 max-w-3xl mx-auto w-full flex-1 flex flex-col">
            <button
              onClick={() => setSelectedTicketId(null)}
              className="group flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 mb-6 transition-colors self-start"
            >
              <ChevronLeft className="w-5 h-5 mr-1 group-hover:-translate-x-1 transition-transform" />
              Назад
            </button>

            <article className="bg-white rounded-3xl p-6 sm:p-8 md:p-10 flex flex-col flex-1">
              <header className="mb-8 md:mb-10 pb-6 md:pb-8 flex flex-col gap-4">
                <span className={`inline-flex items-center self-start gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-2 px-3 py-1 rounded-full border ${themeColors[selectedTicket.theme] || themeColors['Общая тема']}`}>
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Билет №{String(selectedTicket.originalTicketNumber).padStart(2, '0')} • {selectedTicket.theme}</span>
                </span>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 leading-tight">
                  {selectedTicket.title}
                </h1>
              </header>

              <div className="prose prose-slate max-w-none text-slate-700 text-base md:text-lg leading-relaxed mb-12">
                <div className="markdown-body">
                  <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {selectedTicket.content}
                  </Markdown>
                </div>
                {selectedTicket.imageUrl && (
                  <div className="mt-8 rounded-2xl overflow-hidden bg-white p-2">
                    <img src={selectedTicket.imageUrl} alt={selectedTicket.title} className="w-full h-auto object-contain max-h-[60vh] mx-auto" />
                  </div>
                )}
              </div>

              {/* DeepSeek Chat Block */}
              <div className="mb-6">
                <DeepSeekChat lesson={selectedTicket} sessionId={selectedTicket.id} />
              </div>

              {/* Test Block */}
              {testsData.flatMap(t => t.tests).find(test => test.for_question === selectedTicket.id) && (
                <div className="mb-6">
                  <TestBlock test={testsData.flatMap(t => t.tests).find(test => test.for_question === selectedTicket.id)} />
                </div>
              )}

              {/* Bottom Complete Button */}
              <div className="mt-auto pt-6">
                <button
                  onClick={(e) => toggleCompletion(e, selectedTicket.id)}
                  className={`w-full py-4 rounded-2xl text-lg font-bold flex items-center justify-center gap-3 transition-all ${
                    completedTickets.has(selectedTicket.id)
                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                      : "bg-indigo-600 text-white hover:bg-indigo-700"
                  }`}
                >
                  {completedTickets.has(selectedTicket.id) ? (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                      Изучено
                    </>
                  ) : (
                    <>
                      <Circle className="w-6 h-6 opacity-50" />
                      Отметить как изученное
                    </>
                  )}
                </button>
              </div>
            </article>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold text-slate-800 mb-4">Настройки экзамена</h2>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">Дата экзамена</label>
              <input 
                type="date" 
                value={tempExamDate} 
                onChange={(e) => setTempExamDate(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Отмена
              </button>
              <button 
                onClick={saveSettings}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
