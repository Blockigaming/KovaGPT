export const SUPPORTED_LOCALES = ["en", "es", "fr", "de", "pt-BR", "ja", "ko", "ar"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const RTL_LOCALES = new Set<SupportedLocale>(["ar"]);
export const translations: Record<
  SupportedLocale,
  { product: string; title: string; description: string; open: string; complete: boolean }
> = {
  en: {
    product: "Product",
    title: "A focused AI workspace",
    description: "Chat, create, research, and organize work with KovaGPT.",
    open: "Open KovaGPT",
    complete: true,
  },
  es: {
    product: "Producto",
    title: "Un espacio de trabajo de IA enfocado",
    description: "Conversa, crea, investiga y organiza tu trabajo con KovaGPT.",
    open: "Abrir KovaGPT",
    complete: true,
  },
  fr: {
    product: "Produit",
    title: "Un espace de travail IA ciblé",
    description: "Discutez, créez, recherchez et organisez votre travail avec KovaGPT.",
    open: "Ouvrir KovaGPT",
    complete: true,
  },
  de: {
    product: "Produkt",
    title: "Ein fokussierter KI-Arbeitsbereich",
    description: "Mit KovaGPT chatten, erstellen, recherchieren und Arbeit organisieren.",
    open: "KovaGPT öffnen",
    complete: true,
  },
  "pt-BR": {
    product: "Produto",
    title: "Um espaço de trabalho de IA focado",
    description: "Converse, crie, pesquise e organize seu trabalho com o KovaGPT.",
    open: "Abrir KovaGPT",
    complete: true,
  },
  ja: {
    product: "製品",
    title: "集中できるAIワークスペース",
    description: "KovaGPTで会話、作成、調査、整理ができます。",
    open: "KovaGPTを開く",
    complete: true,
  },
  ko: {
    product: "제품",
    title: "집중형 AI 작업 공간",
    description: "KovaGPT로 대화하고, 만들고, 조사하고, 업무를 정리하세요.",
    open: "KovaGPT 열기",
    complete: true,
  },
  ar: {
    product: "المنتج",
    title: "مساحة عمل مركزة بالذكاء الاصطناعي",
    description: "تحدث وأنشئ وابحث ونظّم عملك باستخدام KovaGPT.",
    open: "افتح KovaGPT",
    complete: true,
  },
};
export function resolveLocale(value: string): SupportedLocale | null {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as SupportedLocale)
    : null;
}
