import { useEffect, useMemo, useRef } from 'react';

// Палитра проекта: цвета из аватаров (mocks/handlers.ts) и статусов
// вакансий/кандидатов (mocks/db/vacancies.ts, mocks/db/candidates.ts).
const CONFETTI_COLORS = [
  '#7c3aed', // violet-600 — account_manager / Соколова
  '#0891b2', // cyan-600 — account_manager / Орлов
  '#db2777', // pink-600 — recruiter / Кузнецова
  '#ea580c', // orange-600 — recruiter / Васильев
  '#16a34a', // green-600 — recruiter / Морозова
  '#2563eb', // blue-600 — аватар
  '#b45309', // amber-700 — аватар
  '#3b82f6', // blue-500 — статус «В работе»
  '#8b5cf6', // violet-500 — «Кандидаты предложены»
  '#a855f7', // purple-500 — «Интервью»
  '#f59e0b', // amber-500 — «Ждём ОС» / «Оффер»
  '#10b981', // emerald-500 — «Закрыта успешно» / «Трудоустроен»
  '#ef4444', // red-500 — «Закрыта» / «Отказ клиента»
  '#06b6d4', // cyan-500 — «Готов к презентации»
  '#fbbf24', // amber-400 — «Ждём ОС» (кандидаты)
  '#f97316', // orange-500 — «Отказ кандидата»
];

type Bubble = {
  id: number;
  size: number;
  left: number;
  top: number;
  color: string;
  duration: number;
  delay: number;
  opacity: number;
  blur: number;
  // 3 промежуточных точки маршрута (плюс старт = 0,0)
  dx1: number; dy1: number;
  dx2: number; dy2: number;
  dx3: number; dy3: number;
  s1: number; s2: number; s3: number;
  // Иногда шарики сходятся к midpoint своей пары, создавая эффект столкновения.
  cdx: string;
  cdy: string;
  collisionScale: number;
  // Сила параллакса (чем меньше blur — тем «ближе» шарик, тем сильнее реагирует на мышь)
  parallax: number;
};

function useBubbles(count: number): Bubble[] {
  return useMemo(() => {
    const rand = (range: number) => (Math.random() - 0.5) * range;
    const randScale = () => 0.85 + Math.random() * 0.4; // 0.85–1.25
    const bubbles = Array.from({ length: count }).map((_, i) => {
      const size = 24 + Math.random() * 200; // 24–224px
      const blur = 18 + Math.random() * 40; // 18–58px
      return {
        id: i,
        size,
        blur,
        left: Math.random() * 100,
        top: Math.random() * 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        duration: 28 + Math.random() * 32, // 28–60s — длиннее, потому что путь из 4 точек
        delay: -Math.random() * 60,
        opacity: 0.35 + Math.random() * 0.45,
        dx1: rand(280), dy1: rand(280),
        dx2: rand(280), dy2: rand(280),
        dx3: rand(280), dy3: rand(280),
        s1: randScale(), s2: randScale(), s3: randScale(),
        cdx: '0vw',
        cdy: '0vh',
        collisionScale: 1,
        // blur 18 → ~50, blur 58 → ~3. Передний план — больше, задний — почти не двигается.
        parallax: Math.max(3, (60 - blur) * 1.2),
      };
    });

    // Для части соседних пар: оба шара в середине цикла сходятся в midpoint пары.
    // Это создаёт редкие "столкновения" без расчёта физики.
    for (let i = 0; i < bubbles.length - 1; i += 2) {
      if (Math.random() > 0.35) continue;
      const a = bubbles[i];
      const b = bubbles[i + 1];
      const midLeft = (a.left + b.left) / 2;
      const midTop = (a.top + b.top) / 2;
      a.cdx = `${midLeft - a.left}vw`;
      a.cdy = `${midTop - a.top}vh`;
      b.cdx = `${midLeft - b.left}vw`;
      b.cdy = `${midTop - b.top}vh`;
      const impactScale = 0.86 + Math.random() * 0.1; // лёгкое "сжатие" в момент столкновения
      a.collisionScale = impactScale;
      b.collisionScale = impactScale;
      // Сталкивающиеся пары двигаются медленнее, чтобы "отталкивание" не выглядело резким.
      a.duration *= 1.45;
      b.duration *= 1.45;
    }

    return bubbles;
  }, [count]);
}

/**
 * Плавно гонит CSS-переменные --mx и --my на контейнере шариков
 * в диапазоне [-0.5, 0.5] (доля от половины окна). Через lerp +
 * requestAnimationFrame, чтобы не дёргать React-стейт на каждом мове мыши.
 */
function useMouseParallax(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const tick = () => {
      raf = 0;
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      const el = ref.current;
      if (el) {
        el.style.setProperty('--mx', currentX.toFixed(4));
        el.style.setProperty('--my', currentY.toFixed(4));
      }
      if (Math.abs(targetX - currentX) > 0.0005 || Math.abs(targetY - currentY) > 0.0005) {
        raf = requestAnimationFrame(tick);
      }
    };

    const onMove = (e: PointerEvent) => {
      targetX = e.clientX / window.innerWidth - 0.5;
      targetY = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

/**
 * Анимированный фон с разноцветными размытыми «пузырями» и мягкой виньеткой.
 * Используется на всех публичных страницах входа/активации, чтобы они
 * выглядели как одно семейство экранов.
 *
 * Сам компонент рендерит только фон — оборачивать контент должен родитель,
 * чтобы можно было передать произвольную карточку (логин, инвайт, и т.п.).
 */
export function BubbleBackdrop({ children, count = 42 }: { children: React.ReactNode; count?: number }) {
  const bubbles = useBubbles(count);
  const bubblesRef = useRef<HTMLDivElement>(null);
  useMouseParallax(bubblesRef);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6">
      {/* Floating blurred confetti background */}
      <div
        ref={bubblesRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {bubbles.map((b) => (
          // Внешний span — параллакс от мыши (плавная transition по transform).
          // Внутренний span — собственное броуновское движение через keyframes.
          <span
            key={b.id}
            className="absolute will-change-transform"
            style={{
              left: `${b.left}%`,
              top: `${b.top}%`,
              transform:
                'translate3d(calc(var(--mx, 0) * var(--strength) * 1px), calc(var(--my, 0) * var(--strength) * 1px), 0)',
              transition: 'transform 400ms cubic-bezier(0.16, 1, 0.3, 1)',
              ['--strength' as never]: `${b.parallax}`,
            }}
          >
            <span
              className="block rounded-full will-change-transform"
              style={{
                width: `${b.size}px`,
                height: `${b.size}px`,
                background: b.color,
                opacity: b.opacity,
                filter: `blur(${b.blur}px)`,
                animation: `lg-wander ${b.duration}s ease-in-out ${b.delay}s infinite`,
                ['--dx1' as never]: `${b.dx1}px`,
                ['--dy1' as never]: `${b.dy1}px`,
                ['--dx2' as never]: `${b.dx2}px`,
                ['--dy2' as never]: `${b.dy2}px`,
                ['--dx3' as never]: `${b.dx3}px`,
                ['--dy3' as never]: `${b.dy3}px`,
                ['--s1' as never]: `${b.s1}`,
                ['--s2' as never]: `${b.s2}`,
                ['--s3' as never]: `${b.s3}`,
                ['--cdx' as never]: b.cdx,
                ['--cdy' as never]: b.cdy,
                ['--cs' as never]: `${b.collisionScale}`,
              }}
            />
          </span>
        ))}
      </div>

      {/* Soft top/bottom vignette to keep the form legible */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-transparent to-white/40"
      />

      <style>{`
        @keyframes lg-wander {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          25%  { transform: translate3d(var(--dx1), var(--dy1), 0) scale(var(--s1)); }
          40%  { transform: translate3d(var(--cdx), var(--cdy), 0) scale(var(--cs)); }
          50%  { transform: translate3d(var(--dx2), var(--dy2), 0) scale(var(--s2)); }
          60%  { transform: translate3d(var(--cdx), var(--cdy), 0) scale(var(--cs)); }
          75%  { transform: translate3d(var(--dx3), var(--dy3), 0) scale(var(--s3)); }
          100% { transform: translate3d(0, 0, 0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          span[style*="lg-wander"] { animation: none !important; }
        }
      `}</style>

      {children}
    </div>
  );
}
