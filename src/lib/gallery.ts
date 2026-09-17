import type { Locale } from "@/lib/i18n/config";

export type GalleryItem = {
  src: string;
  width: number;
  height: number;
  alt: Record<Locale, string>;
  caption?: Record<Locale, string>;
};

// Adicione itens aqui quando as imagens reais do portfolio estiverem
// disponiveis em public/gallery/. Sem imagens reais, a galeria mostra
// o estado vazio localizado (sem portfolio falso).
export const GALLERY_ITEMS: GalleryItem[] = [];
