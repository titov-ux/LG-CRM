import type { Candidate, SkillCategory } from '@/api/types';
import type { ImprovedResume } from '@/api/candidates';

/**
 * Применить адаптированные AI-поля поверх кандидата.
 *
 * Контракт:
 *  - Любое непустое поле в `improvement` ПЕРЕЗАПИСЫВАЕТ исходное поле кандидата.
 *  - `experience` — патч по индексу: i-й элемент `improvement.experience` обновляет
 *    `project`/`achievements` i-го `candidate.experience`. Длины должны совпадать,
 *    иначе мы оставляем оригинал (бэк уже валидирует длину, но защита нелишняя).
 *  - Поля `id` у skillCategories восстанавливаем, иначе React useFieldArray
 *    и резюме-рендер ругаются — но в нашем случае рендер живёт через
 *    `buildResumeModel`, которому id не нужен. Тем не менее держим стабильный id.
 *
 * Возвращает НОВЫЙ Candidate; исходный объект не мутируем.
 */
export function applyImprovementToCandidate(
  candidate: Candidate,
  improvement: ImprovedResume,
): Candidate {
  const next: Candidate = { ...candidate };

  if (typeof improvement.summary === 'string' && improvement.summary.trim()) {
    next.summary = improvement.summary;
  }

  if (typeof improvement.experienceYears === 'number' && improvement.experienceYears >= 0) {
    next.experienceYears = improvement.experienceYears;
  }

  if (Array.isArray(improvement.stack) && improvement.stack.length > 0) {
    next.stack = improvement.stack.filter((s) => typeof s === 'string' && s.trim());
  }

  if (Array.isArray(improvement.skillCategories) && improvement.skillCategories.length > 0) {
    // У бэка категории без `id` (он не нужен LLM). Подставляем стабильный id
    // на базе индекса — этого достаточно для рендера, переэкспорта и т.п.
    next.skillCategories = improvement.skillCategories.map<SkillCategory>((c, idx) => ({
      id: `improved-${idx}`,
      name: c.name,
      items: (c.items ?? []).filter((it) => typeof it === 'string' && it.trim()),
    }));
  }

  if (
    Array.isArray(improvement.experience) &&
    Array.isArray(candidate.experience) &&
    improvement.experience.length === candidate.experience.length
  ) {
    next.experience = candidate.experience.map((orig, i) => {
      const patch = improvement.experience?.[i];
      if (!patch) return orig;
      const updated = { ...orig };
      if (typeof patch.project === 'string' && patch.project.trim()) {
        updated.project = patch.project;
      }
      if (Array.isArray(patch.achievements) && patch.achievements.length > 0) {
        updated.achievements = patch.achievements.filter(
          (a) => typeof a === 'string' && a.trim(),
        );
      }
      return updated;
    });
  }

  return next;
}
