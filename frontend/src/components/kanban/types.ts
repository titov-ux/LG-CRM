// Универсальные типы Kanban-доски. Каждая фича (vacancies, candidates) поставляет
// свой набор статусов + рендерер карточки.

export interface KanbanStatusDescriptor<TStatus extends string> {
  id: TStatus;
  label: string;
  color: string;
}

export interface KanbanItem<TStatus extends string> {
  id: string;
  status: TStatus;
}
