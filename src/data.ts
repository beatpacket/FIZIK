import raw1 from './raw1.json';
import raw2 from './raw2.json';
import raw3 from './raw3.json';

export interface Lesson {
  id: string;
  originalTicketNumber: number;
  title: string;
  content: string;
  imageUrl?: string;
  theme: string;
}

const themeMapping: Record<string, string> = {
  "1.1": "Тепловые явления",
  "2.1": "Тепловые явления",
  "3.1": "Тепловые явления",
  "4.1": "Тепловые явления",
  "6.1": "Тепловые явления",
  "7.1": "Тепловые явления",
  "8.1": "Тепловые явления",
  "9.1": "Тепловые явления",
  "10.1": "Тепловые явления",
  "11.1": "Тепловые явления",
  "12.1": "Тепловые явления",
  "16.1": "Тепловые явления",
  "17.1": "Тепловые явления",
  
  "1.2": "Электричество",
  "2.2": "Электричество",
  "3.2": "Электричество",
  "4.2": "Электричество",
  "5.2": "Электричество",
  "6.2": "Электричество",
  "7.2": "Электричество",
  "8.2": "Электричество",
  "9.2": "Электричество",
  "12.2": "Электричество",
  "13.1": "Электричество",
  "14.1": "Электричество",
  "15.1": "Электричество",

  "5.1": "Магнетизм",
  "10.2": "Магнетизм",
  "11.2": "Магнетизм",
  "15.2": "Магнетизм",
  "16.2": "Магнетизм",
  "17.2": "Магнетизм",

  "13.2": "Оптика",
  "14.2": "Оптика",
};

export const themeColors: Record<string, string> = {
  "Тепловые явления": "bg-green-50 text-green-700 border-green-200",
  "Электричество": "bg-blue-50 text-blue-700 border-blue-200",
  "Магнетизм": "bg-red-50 text-red-700 border-red-200",
  "Оптика": "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Общая тема": "bg-slate-50 text-slate-700 border-slate-200",
};

export const themeOrder: Record<string, number> = {
  "Тепловые явления": 1,
  "Электричество": 2,
  "Магнетизм": 3,
  "Оптика": 4,
  "Общая тема": 5
};

const rawData = [...raw1, ...raw2, ...raw3];

export const LESSONS: Lesson[] = rawData.flatMap((ticket: any) =>
  ticket.questions.map((q: any) => ({
    id: q.id,
    originalTicketNumber: ticket.ticket,
    title: q.topic,
    content: q.answer,
    theme: themeMapping[q.id] || "Общая тема"
  }))
);
