import React, { useState, useMemo, useRef } from 'react';
import { Search, Plus, Bell, ChevronDown, Filter, MoreHorizontal, Users, Briefcase, Building2, BarChart3, Settings, FileText, LayoutGrid, List, Calendar, Star, Phone, Mail, MessageCircle, MapPin, Clock, TrendingUp, ChevronRight, X, Check, AlertCircle, Paperclip, Send, Eye, Edit3, Trash2, Copy, Download, Upload, Tag, User as UserIcon, ArrowRight, Inbox, ChevronLeft, Layers, Activity } from 'lucide-react';

// ============ DATA ============
const users = [
  { id: 'u1', name: 'Алексей Титов', initials: 'АТ', role: 'admin', color: '#0f172a' },
  { id: 'u2', name: 'Мария Соколова', initials: 'МС', role: 'account_manager', color: '#7c3aed' },
  { id: 'u3', name: 'Дмитрий Орлов', initials: 'ДО', role: 'account_manager', color: '#0891b2' },
  { id: 'u4', name: 'Анна Кузнецова', initials: 'АК', role: 'recruiter', color: '#db2777' },
  { id: 'u5', name: 'Игорь Васильев', initials: 'ИВ', role: 'recruiter', color: '#ea580c' },
  { id: 'u6', name: 'Елена Морозова', initials: 'ЕМ', role: 'recruiter', color: '#16a34a' },
];

const initialClients = [
  { id: 'c1', name: 'X5 Retail Group', inn: '7728029110', industry: 'Ритейл', amId: 'u2', status: 'active', vacancies: 8, contacts: 3 },
  { id: 'c2', name: 'Т1 Консалтинг', inn: '7730215257', industry: 'IT-консалтинг', amId: 'u2', status: 'active', vacancies: 12, contacts: 5 },
  { id: 'c3', name: 'Газпром Нефть', inn: '5504036333', industry: 'Нефтегаз', amId: 'u3', status: 'active', vacancies: 6, contacts: 4 },
  { id: 'c4', name: 'Московская Биржа', inn: '7702077840', industry: 'Финансы', amId: 'u3', status: 'in_progress', vacancies: 4, contacts: 2 },
  { id: 'c5', name: 'Umbrella IT', inn: '7707083893', industry: 'IT', amId: 'u2', status: 'lead', vacancies: 2, contacts: 1 },
  { id: 'c6', name: 'Альфа-Банк', inn: '7728168971', industry: 'Финансы', amId: 'u3', status: 'paused', vacancies: 0, contacts: 2 },
];

const vacancyStatuses = [
  { id: 'new', label: 'Новая', color: '#94a3b8' },
  { id: 'briefing', label: 'Брифинг', color: '#64748b' },
  { id: 'in_work', label: 'В работе', color: '#3b82f6' },
  { id: 'proposed', label: 'Кандидаты предложены', color: '#8b5cf6' },
  { id: 'interview', label: 'Интервью', color: '#a855f7' },
  { id: 'offer', label: 'Оффер', color: '#f59e0b' },
  { id: 'closed_success', label: 'Закрыта успешно', color: '#10b981' },
  { id: 'paused', label: 'На паузе', color: '#cbd5e1' },
];

const candidateStatuses = [
  { id: 'new', label: 'Новый', color: '#94a3b8' },
  { id: 'screening', label: 'Скрининг', color: '#64748b' },
  { id: 'recruiter_iv', label: 'Интервью с рекрутером', color: '#3b82f6' },
  { id: 'ready', label: 'Готов к презентации', color: '#06b6d4' },
  { id: 'presented', label: 'Презентован клиенту', color: '#8b5cf6' },
  { id: 'client_iv', label: 'На интервью у клиента', color: '#a855f7' },
  { id: 'offer', label: 'Оффер', color: '#f59e0b' },
  { id: 'hired', label: 'Трудоустроен', color: '#10b981' },
  { id: 'reserve', label: 'Резерв', color: '#cbd5e1' },
];

const initialVacancies = [
  { id: 'v1', title: 'Senior Backend (Java)', clientId: 'c1', grade: 'Senior', stack: ['Java', 'Spring', 'Kafka', 'PostgreSQL'], format: 'Гибрид', rateClient: 4500, rateMax: 3200, positions: 2, status: 'in_work', priority: 'high', recruiters: ['u4', 'u5'], daysInStatus: 5, candidates: 4, deadline: '2026-06-15' },
  { id: 'v2', title: 'Senior Frontend (React)', clientId: 'c1', grade: 'Senior', stack: ['React', 'TypeScript', 'Redux'], format: 'Удалённо', rateClient: 4200, rateMax: 3000, positions: 1, status: 'interview', priority: 'urgent', recruiters: ['u4'], daysInStatus: 11, candidates: 3, deadline: '2026-05-30' },
  { id: 'v3', title: 'DevOps Engineer', clientId: 'c2', grade: 'Middle', stack: ['Kubernetes', 'Terraform', 'AWS'], format: 'Удалённо', rateClient: 3800, rateMax: 2700, positions: 1, status: 'proposed', priority: 'medium', recruiters: ['u5'], daysInStatus: 3, candidates: 2, deadline: '2026-07-01' },
  { id: 'v4', title: 'Lead Data Engineer', clientId: 'c2', grade: 'Lead', stack: ['Python', 'Spark', 'Airflow'], format: 'Гибрид', rateClient: 5500, rateMax: 4000, positions: 1, status: 'briefing', priority: 'medium', recruiters: ['u6'], daysInStatus: 2, candidates: 0, deadline: '2026-08-01' },
  { id: 'v5', title: 'QA Automation', clientId: 'c3', grade: 'Middle', stack: ['Python', 'Selenium', 'Pytest'], format: 'Офис', rateClient: 3200, rateMax: 2400, positions: 2, status: 'in_work', priority: 'low', recruiters: ['u4'], daysInStatus: 15, candidates: 5, deadline: '2026-06-30' },
  { id: 'v6', title: 'Senior iOS Developer', clientId: 'c1', grade: 'Senior', stack: ['Swift', 'SwiftUI', 'Combine'], format: 'Гибрид', rateClient: 4800, rateMax: 3400, positions: 1, status: 'offer', priority: 'high', recruiters: ['u6'], daysInStatus: 4, candidates: 1, deadline: '2026-05-25' },
  { id: 'v7', title: 'Middle Backend (Go)', clientId: 'c4', grade: 'Middle', stack: ['Go', 'gRPC', 'PostgreSQL'], format: 'Офис', rateClient: 3900, rateMax: 2800, positions: 3, status: 'new', priority: 'medium', recruiters: [], daysInStatus: 1, candidates: 0, deadline: '2026-07-15' },
  { id: 'v8', title: 'ML Engineer', clientId: 'c3', grade: 'Senior', stack: ['Python', 'PyTorch', 'MLOps'], format: 'Удалённо', rateClient: 5200, rateMax: 3700, positions: 1, status: 'in_work', priority: 'high', recruiters: ['u5', 'u6'], daysInStatus: 8, candidates: 3, deadline: '2026-06-20' },
  { id: 'v9', title: 'Senior SRE', clientId: 'c2', grade: 'Senior', stack: ['Kubernetes', 'Prometheus', 'Go'], format: 'Удалённо', rateClient: 5000, rateMax: 3600, positions: 1, status: 'closed_success', priority: 'medium', recruiters: ['u5'], daysInStatus: 22, candidates: 1, deadline: '2026-05-10' },
  { id: 'v10', title: 'Product Analyst', clientId: 'c4', grade: 'Middle', stack: ['SQL', 'Python', 'Tableau'], format: 'Гибрид', rateClient: 3400, rateMax: 2500, positions: 1, status: 'paused', priority: 'low', recruiters: ['u4'], daysInStatus: 6, candidates: 2, deadline: null },
];

const initialCandidates = [
  { id: 'k1', name: 'Иван Петров', role: 'Senior Java Developer', grade: 'Senior', experience: 7, stack: ['Java', 'Spring', 'Kafka', 'PostgreSQL', 'Docker'], rate: 3000, format: 'Гибрид', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'presented', daysInStatus: 3, vacancies: ['v1'], hot: false },
  { id: 'k2', name: 'Алина Смирнова', role: 'Senior React Developer', grade: 'Senior', experience: 6, stack: ['React', 'TypeScript', 'Next.js'], rate: 2900, format: 'Удалённо', location: 'СПб', source: 'LinkedIn', recruiterId: 'u4', status: 'client_iv', daysInStatus: 9, vacancies: ['v2'], hot: true },
  { id: 'k3', name: 'Сергей Николаев', role: 'DevOps Engineer', grade: 'Middle', experience: 4, stack: ['Kubernetes', 'AWS', 'Terraform'], rate: 2500, format: 'Удалённо', location: 'Екатеринбург', source: 'Telegram', recruiterId: 'u5', status: 'recruiter_iv', daysInStatus: 2, vacancies: ['v3'], hot: false },
  { id: 'k4', name: 'Мария Иванова', role: 'Lead Data Engineer', grade: 'Lead', experience: 10, stack: ['Python', 'Spark', 'Airflow', 'AWS'], rate: 3900, format: 'Гибрид', location: 'Москва', source: 'Рекомендация', recruiterId: 'u6', status: 'ready', daysInStatus: 1, vacancies: [], hot: false },
  { id: 'k5', name: 'Дмитрий Козлов', role: 'QA Automation Engineer', grade: 'Middle', experience: 5, stack: ['Python', 'Selenium', 'Pytest', 'Postman'], rate: 2300, format: 'Офис', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'presented', daysInStatus: 6, vacancies: ['v5'], hot: false },
  { id: 'k6', name: 'Ольга Лебедева', role: 'Senior iOS Developer', grade: 'Senior', experience: 8, stack: ['Swift', 'SwiftUI', 'Combine', 'Objective-C'], rate: 3300, format: 'Гибрид', location: 'Москва', source: 'LinkedIn', recruiterId: 'u6', status: 'offer', daysInStatus: 4, vacancies: ['v6'], hot: false },
  { id: 'k7', name: 'Андрей Соколов', role: 'Backend Developer (Go)', grade: 'Middle', experience: 4, stack: ['Go', 'gRPC', 'PostgreSQL'], rate: 2700, format: 'Офис', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'new', daysInStatus: 1, vacancies: [], hot: false },
  { id: 'k8', name: 'Наталья Волкова', role: 'ML Engineer', grade: 'Senior', experience: 6, stack: ['Python', 'PyTorch', 'MLOps', 'Kubernetes'], rate: 3500, format: 'Удалённо', location: 'СПб', source: 'GitHub', recruiterId: 'u5', status: 'client_iv', daysInStatus: 11, vacancies: ['v8'], hot: true },
  { id: 'k9', name: 'Михаил Зайцев', role: 'SRE Engineer', grade: 'Senior', experience: 7, stack: ['Kubernetes', 'Prometheus', 'Go', 'Terraform'], rate: 3500, format: 'Удалённо', location: 'Казань', source: 'Telegram', recruiterId: 'u5', status: 'hired', daysInStatus: 18, vacancies: ['v9'], hot: false },
  { id: 'k10', name: 'Екатерина Беляева', role: 'Product Analyst', grade: 'Middle', experience: 4, stack: ['SQL', 'Python', 'Tableau', 'PowerBI'], rate: 2400, format: 'Гибрид', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'screening', daysInStatus: 5, vacancies: [], hot: false },
  { id: 'k11', name: 'Павел Морозов', role: 'Senior Backend (Java)', grade: 'Senior', experience: 9, stack: ['Java', 'Spring', 'Kafka'], rate: 3100, format: 'Гибрид', location: 'Москва', source: 'Рекомендация', recruiterId: 'u5', status: 'presented', daysInStatus: 2, vacancies: ['v1'], hot: false },
  { id: 'k12', name: 'Юлия Тарасова', role: 'ML Engineer', grade: 'Senior', experience: 5, stack: ['Python', 'PyTorch', 'TensorFlow'], rate: 3400, format: 'Удалённо', location: 'СПб', source: 'LinkedIn', recruiterId: 'u6', status: 'reserve', daysInStatus: 30, vacancies: [], hot: false },
];

// ============ HELPERS ============
const getUser = (id) => users.find(u => u.id === id);
const getClient = (id) => initialClients.find(c => c.id === id);
const getVacancyStatus = (id) => vacancyStatuses.find(s => s.id === id);
const getCandidateStatus = (id) => candidateStatuses.find(s => s.id === id);

const daysColor = (days) => {
  if (days < 7) return { bg: '#dcfce7', fg: '#15803d', dot: '#16a34a' };
  if (days <= 14) return { bg: '#fef3c7', fg: '#a16207', dot: '#eab308' };
  return { bg: '#fee2e2', fg: '#b91c1c', dot: '#dc2626' };
};

const priorityBadge = (p) => {
  const map = {
    urgent:  { label: 'Срочно', fg: '#b91c1c', bg: '#fee2e2' },
    high:    { label: 'Высокий', fg: '#a16207', bg: '#fef3c7' },
    medium:  { label: 'Средний', fg: '#475569', bg: '#f1f5f9' },
    low:     { label: 'Низкий', fg: '#64748b', bg: '#f8fafc' },
  };
  return map[p] || map.medium;
};

const clientStatusLabel = (s) => ({
  lead: 'Лид', in_progress: 'В работе', active: 'Активный', paused: 'Приостановлен', archived: 'Архив'
}[s] || s);

// ============ AVATAR ============
const Avatar = ({ user, size = 24, ring = false }) => {
  if (!user) return null;
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', background: user.color,
        color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.42, fontWeight: 600, letterSpacing: '-0.02em', flexShrink: 0,
        boxShadow: ring ? '0 0 0 2px #fff' : 'none', fontFamily: 'ui-sans-serif, system-ui'
      }}
      title={user.name}
    >{user.initials}</div>
  );
};

const AvatarStack = ({ userIds = [], max = 3 }) => {
  const shown = userIds.slice(0, max);
  const rest = userIds.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((id, i) => (
        <div key={id} style={{ marginLeft: i === 0 ? 0 : -6, position: 'relative', zIndex: shown.length - i }}>
          <Avatar user={getUser(id)} size={22} ring />
        </div>
      ))}
      {rest > 0 && (
        <div style={{
          marginLeft: -6, width: 22, height: 22, borderRadius: '50%', background: '#f1f5f9',
          border: '2px solid #fff', fontSize: 10, fontWeight: 600, color: '#475569',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>+{rest}</div>
      )}
    </div>
  );
};

// ============ TAG ============
const Tag = ({ children, color = '#f1f5f9', fg = '#475569' }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', padding: '2px 7px',
    background: color, color: fg, fontSize: 11, fontWeight: 500,
    borderRadius: 4, lineHeight: '16px', letterSpacing: '-0.005em'
  }}>{children}</span>
);

// ============ MAIN ============
export default function CRM() {
  const [section, setSection] = useState('vacancies-kanban');
  const [currentUser] = useState(users[0]);
  const [vacancies, setVacancies] = useState(initialVacancies);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [draggedVacancyId, setDraggedVacancyId] = useState(null);
  const [draggedCandidateId, setDraggedCandidateId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [view, setView] = useState('kanban'); // kanban | list
  const [selectedEntity, setSelectedEntity] = useState(null); // {type, id}
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ grade: null, priority: null, recruiter: null, client: null });

  // ============ KANBAN: VACANCIES ============
  const VacanciesKanban = () => {
    const visible = vacancies.filter(v => {
      if (search && !v.title.toLowerCase().includes(search.toLowerCase()) && !getClient(v.clientId)?.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filters.grade && v.grade !== filters.grade) return false;
      if (filters.priority && v.priority !== filters.priority) return false;
      if (filters.client && v.clientId !== filters.client) return false;
      if (filters.recruiter && !v.recruiters.includes(filters.recruiter)) return false;
      return true;
    });

    return (
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '4px 24px 24px', flex: 1, alignItems: 'flex-start' }}>
        {vacancyStatuses.map(status => {
          const cards = visible.filter(v => v.status === status.id);
          const isOver = dragOverColumn === status.id;
          return (
            <div
              key={status.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverColumn(status.id); }}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedVacancyId) {
                  setVacancies(prev => prev.map(v => v.id === draggedVacancyId ? { ...v, status: status.id, daysInStatus: 0 } : v));
                }
                setDraggedVacancyId(null);
                setDragOverColumn(null);
              }}
              style={{
                width: 280, flexShrink: 0, background: isOver ? '#f8fafc' : 'transparent',
                borderRadius: 8, padding: 4, transition: 'background 0.15s',
                outline: isOver ? '1px dashed #cbd5e1' : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', letterSpacing: '-0.01em' }}>{status.label}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontFeatureSettings: '"tnum"' }}>{cards.length}</span>
                </div>
                <button style={iconBtn}><Plus size={13} /></button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cards.map(v => {
                  const client = getClient(v.clientId);
                  const dc = daysColor(v.daysInStatus);
                  const pr = priorityBadge(v.priority);
                  return (
                    <div
                      key={v.id}
                      draggable
                      onDragStart={() => setDraggedVacancyId(v.id)}
                      onDragEnd={() => { setDraggedVacancyId(null); setDragOverColumn(null); }}
                      onClick={() => setSelectedEntity({ type: 'vacancy', id: v.id })}
                      style={{
                        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10,
                        cursor: 'pointer', transition: 'all 0.12s',
                        opacity: draggedVacancyId === v.id ? 0.4 : 1,
                        boxShadow: '0 1px 0 rgba(15, 23, 42, 0.02)'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.04)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 0 rgba(15, 23, 42, 0.02)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: '17px', letterSpacing: '-0.01em' }}>{v.title}</div>
                        {(v.priority === 'urgent' || v.priority === 'high') && (
                          <Tag color={pr.bg} fg={pr.fg}>{pr.label}</Tag>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#64748b', marginBottom: 8 }}>
                        <Building2 size={11} strokeWidth={1.8} />
                        <span style={{ fontWeight: 500 }}>{client?.name}</span>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span>{v.grade}</span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 9 }}>
                        {v.stack.slice(0, 3).map(s => <Tag key={s}>{s}</Tag>)}
                        {v.stack.length > 3 && <Tag>+{v.stack.length - 3}</Tag>}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px',
                            background: dc.bg, color: dc.fg, borderRadius: 4, fontWeight: 500,
                            fontFeatureSettings: '"tnum"'
                          }}>
                            <Clock size={10} strokeWidth={2} />{v.daysInStatus}д
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFeatureSettings: '"tnum"' }}>
                            <Users size={11} strokeWidth={1.8} />{v.candidates}
                          </span>
                        </div>
                        <AvatarStack userIds={v.recruiters} max={2} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ============ KANBAN: CANDIDATES ============
  const CandidatesKanban = () => {
    const visible = candidates.filter(c => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.role.toLowerCase().includes(search.toLowerCase())) return false;
      if (filters.grade && c.grade !== filters.grade) return false;
      if (filters.recruiter && c.recruiterId !== filters.recruiter) return false;
      return true;
    });

    return (
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '4px 24px 24px', flex: 1, alignItems: 'flex-start' }}>
        {candidateStatuses.map(status => {
          const cards = visible.filter(c => c.status === status.id);
          const isOver = dragOverColumn === status.id;
          return (
            <div
              key={status.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverColumn(status.id); }}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedCandidateId) {
                  setCandidates(prev => prev.map(c => c.id === draggedCandidateId ? { ...c, status: status.id, daysInStatus: 0 } : c));
                }
                setDraggedCandidateId(null);
                setDragOverColumn(null);
              }}
              style={{
                width: 280, flexShrink: 0, background: isOver ? '#f8fafc' : 'transparent',
                borderRadius: 8, padding: 4, transition: 'background 0.15s',
                outline: isOver ? '1px dashed #cbd5e1' : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', letterSpacing: '-0.01em' }}>{status.label}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontFeatureSettings: '"tnum"' }}>{cards.length}</span>
                </div>
                <button style={iconBtn}><Plus size={13} /></button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cards.map(c => {
                  const dc = daysColor(c.daysInStatus);
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDraggedCandidateId(c.id)}
                      onDragEnd={() => { setDraggedCandidateId(null); setDragOverColumn(null); }}
                      onClick={() => setSelectedEntity({ type: 'candidate', id: c.id })}
                      style={{
                        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10,
                        cursor: 'pointer', transition: 'all 0.12s',
                        opacity: draggedCandidateId === c.id ? 0.4 : 1,
                        boxShadow: '0 1px 0 rgba(15, 23, 42, 0.02)'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.04)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 0 rgba(15, 23, 42, 0.02)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: '17px', letterSpacing: '-0.01em' }}>{c.name}</div>
                        {c.hot && (
                          <span title="Горячий: в работе по 2+ вакансиям" style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 18, height: 18, borderRadius: '50%', background: '#fef3c7', flexShrink: 0
                          }}>
                            <span style={{ fontSize: 11 }}>🔥</span>
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 8 }}>
                        {c.role} · <span style={{ color: '#94a3b8' }}>{c.grade}</span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 9 }}>
                        {c.stack.slice(0, 3).map(s => <Tag key={s}>{s}</Tag>)}
                        {c.stack.length > 3 && <Tag>+{c.stack.length - 3}</Tag>}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b' }}>
                          <span style={{ fontFeatureSettings: '"tnum"', fontWeight: 600, color: '#0f172a' }}>
                            {c.rate.toLocaleString('ru-RU')} ₽
                          </span>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px',
                            background: dc.bg, color: dc.fg, borderRadius: 4, fontWeight: 500,
                            fontFeatureSettings: '"tnum"'
                          }}>
                            <Clock size={10} strokeWidth={2} />{c.daysInStatus}д
                          </span>
                        </div>
                        <Avatar user={getUser(c.recruiterId)} size={20} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ============ CLIENTS LIST ============
  const ClientsList = () => (
    <div style={{ padding: '0 24px 24px', flex: 1, overflow: 'auto' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 1fr 1.2fr 80px 80px',
          padding: '11px 16px', fontSize: 11.5, fontWeight: 600, color: '#64748b',
          textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0',
          background: '#fafbfc'
        }}>
          <div>Название</div><div>ИНН</div><div>Отрасль</div><div>Статус</div><div>Менеджер</div><div style={{textAlign:'right'}}>Вакансии</div><div style={{textAlign:'right'}}>Контакты</div>
        </div>
        {initialClients.map((c, i) => {
          const am = getUser(c.amId);
          const statusColor = { active: '#10b981', in_progress: '#3b82f6', lead: '#94a3b8', paused: '#eab308', archived: '#cbd5e1' }[c.status];
          return (
            <div
              key={c.id}
              onClick={() => setSelectedEntity({ type: 'client', id: c.id })}
              style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 1fr 1.2fr 80px 80px',
                padding: '13px 16px', fontSize: 13, alignItems: 'center', cursor: 'pointer',
                borderBottom: i === initialClients.length - 1 ? 'none' : '1px solid #f1f5f9',
                transition: 'background 0.1s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#fafbfc'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
            >
              <div style={{ fontWeight: 600, color: '#0f172a', letterSpacing: '-0.01em' }}>{c.name}</div>
              <div style={{ color: '#64748b', fontFeatureSettings: '"tnum"', fontSize: 12.5 }}>{c.inn}</div>
              <div style={{ color: '#475569' }}>{c.industry}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
                {clientStatusLabel(c.status)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Avatar user={am} size={22} />
                <span style={{ color: '#475569', fontSize: 12.5 }}>{am?.name}</span>
              </div>
              <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600, color: '#0f172a' }}>{c.vacancies}</div>
              <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"', color: '#64748b' }}>{c.contacts}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ============ DASHBOARD ============
  const Dashboard = () => {
    const totalOpen = vacancies.filter(v => !['closed_success', 'paused'].includes(v.status)).length;
    const totalClosed = vacancies.filter(v => v.status === 'closed_success').length;
    const activeCandidates = candidates.filter(c => !['hired', 'reserve'].includes(c.status)).length;
    const hiredThisMonth = candidates.filter(c => c.status === 'hired').length;

    const metrics = [
      { label: 'Открытых вакансий', value: totalOpen, delta: '+3', accent: '#0f172a' },
      { label: 'Активных кандидатов', value: activeCandidates, delta: '+12', accent: '#0f172a' },
      { label: 'Закрыто в этом месяце', value: totalClosed, delta: '+2', accent: '#10b981' },
      { label: 'Трудоустроено', value: hiredThisMonth, delta: '+1', accent: '#10b981' },
    ];

    const fillByStatus = vacancyStatuses.map(s => ({
      ...s, count: vacancies.filter(v => v.status === s.id).length
    }));
    const maxFill = Math.max(...fillByStatus.map(x => x.count), 1);

    return (
      <div style={{ padding: '0 24px 24px', flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {metrics.map(m => (
            <div key={m.label} style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px'
            }}>
              <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500, marginBottom: 8, letterSpacing: '-0.005em' }}>{m.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: m.accent, fontFeatureSettings: '"tnum"', letterSpacing: '-0.03em', lineHeight: 1 }}>{m.value}</div>
                <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>{m.delta}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 16, letterSpacing: '-0.01em' }}>Воронка вакансий</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {fillByStatus.map(s => (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 28px', alignItems: 'center', gap: 12, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#475569' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                    {s.label}
                  </div>
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(s.count / maxFill) * 100}%`, height: '100%', background: s.color, transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 600, color: '#0f172a' }}>{s.count}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 16, letterSpacing: '-0.01em' }}>Нагрузка рекрутеров</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {users.filter(u => u.role === 'recruiter').map(r => {
                const myCands = candidates.filter(c => c.recruiterId === r.id && !['hired', 'reserve'].includes(c.status));
                const pct = Math.min(myCands.length / 6, 1);
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar user={r} size={26} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12.5, color: '#0f172a', fontWeight: 500 }}>{r.name}</span>
                        <span style={{ fontSize: 12, color: '#64748b', fontFeatureSettings: '"tnum"', fontWeight: 600 }}>{myCands.length}</span>
                      </div>
                      <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct * 100}%`, height: '100%', background: r.color, transition: 'width 0.4s' }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 14, letterSpacing: '-0.01em' }}>Топ-клиенты по вакансиям</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {initialClients.slice(0, 5).map((c, i) => (
              <div key={c.id} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr 100px 80px',
                alignItems: 'center', gap: 12, padding: '9px 0',
                borderBottom: i === 4 ? 'none' : '1px solid #f1f5f9', fontSize: 13
              }}>
                <div style={{ fontFeatureSettings: '"tnum"', color: '#94a3b8', fontWeight: 600, fontSize: 12 }}>{i + 1}</div>
                <div style={{ fontWeight: 500, color: '#0f172a' }}>{c.name}</div>
                <div style={{ color: '#64748b', fontSize: 12 }}>{c.industry}</div>
                <div style={{ textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 700, color: '#0f172a' }}>{c.vacancies}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ============ DETAIL DRAWER ============
  const Drawer = () => {
    if (!selectedEntity) return null;
    let content;
    if (selectedEntity.type === 'vacancy') {
      const v = vacancies.find(x => x.id === selectedEntity.id);
      if (!v) return null;
      const client = getClient(v.clientId);
      const status = getVacancyStatus(v.status);
      const attached = candidates.filter(c => v.candidates && c.vacancies?.includes(v.id));
      content = (
        <>
          <div style={{ padding: '0 24px 18px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500, marginBottom: 6 }}>ВАКАНСИЯ · {client?.name}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.025em', marginBottom: 10 }}>{v.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', background: '#f1f5f9', borderRadius: 4, fontSize: 12, fontWeight: 500, color: '#0f172a' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: status?.color }} />
                {status?.label}
              </span>
              <Tag color={priorityBadge(v.priority).bg} fg={priorityBadge(v.priority).fg}>
                {priorityBadge(v.priority).label}
              </Tag>
              <span style={{ fontSize: 12, color: '#64748b' }}>{v.grade} · {v.format}</span>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 28px', marginBottom: 24 }}>
              <DrawerField label="Клиент" value={client?.name} />
              <DrawerField label="Аккаунт-менеджер" value={<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={getUser(client?.amId)} size={20} /><span>{getUser(client?.amId)?.name}</span></div>} />
              <DrawerField label="Ставка для клиента" value={`${v.rateClient.toLocaleString('ru-RU')} ₽/час`} />
              <DrawerField label="Бюджет на кандидата" value={`${v.rateMax.toLocaleString('ru-RU')} ₽/час`} />
              <DrawerField label="Позиций" value={v.positions} />
              <DrawerField label="Дедлайн" value={v.deadline ? new Date(v.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'} />
            </div>

            <DrawerSection title="Стек технологий">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {v.stack.map(s => <Tag key={s} color="#eef2ff" fg="#4338ca">{s}</Tag>)}
              </div>
            </DrawerSection>

            <DrawerSection title="Назначенные рекрутеры">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {v.recruiters.map(id => (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 4px', background: '#f8fafc', borderRadius: 999 }}>
                    <Avatar user={getUser(id)} size={20} />
                    <span style={{ fontSize: 12, color: '#0f172a' }}>{getUser(id)?.name}</span>
                  </div>
                ))}
                {v.recruiters.length === 0 && <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Не назначены</span>}
              </div>
            </DrawerSection>

            <DrawerSection title="Описание">
              <div style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6 }}>
                Поиск <b style={{color:'#0f172a'}}>{v.grade}</b> {v.title.toLowerCase()} в команду {client?.name}. Опыт работы со стеком {v.stack.join(', ')}. Участие в проектировании архитектуры, code review, развитии CI/CD. Формат — {v.format.toLowerCase()}, проект {v.deadline ? `на 6+ месяцев с продлением` : 'долгосрочный'}.
              </div>
            </DrawerSection>

            <DrawerSection title={`Прикреплённые кандидаты · ${candidates.filter(c => c.vacancies?.includes(v.id)).length}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {candidates.filter(c => c.vacancies?.includes(v.id)).map(c => (
                  <div key={c.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 12px', background: '#fafbfc', border: '1px solid #f1f5f9', borderRadius: 6, cursor: 'pointer'
                  }} onClick={() => setSelectedEntity({ type: 'candidate', id: c.id })}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar user={{ initials: c.name.split(' ').map(x => x[0]).join('').slice(0,2), color: '#475569' }} size={26} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: '#64748b' }}>{c.role}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#0f172a', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>{c.rate.toLocaleString('ru-RU')} ₽</span>
                      <ChevronRight size={14} color="#94a3b8" />
                    </div>
                  </div>
                ))}
                {candidates.filter(c => c.vacancies?.includes(v.id)).length === 0 && (
                  <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '8px 0' }}>Кандидаты пока не прикреплены.</div>
                )}
              </div>
            </DrawerSection>
          </div>
        </>
      );
    } else if (selectedEntity.type === 'candidate') {
      const c = candidates.find(x => x.id === selectedEntity.id);
      if (!c) return null;
      const status = getCandidateStatus(c.status);
      content = (
        <>
          <div style={{ padding: '0 24px 18px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500, marginBottom: 6 }}>КАНДИДАТ · {c.grade}</div>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom: 12 }}>
              <Avatar user={{ initials: c.name.split(' ').map(x => x[0]).join('').slice(0,2), color: '#475569' }} size={48} />
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.025em' }}>{c.name}</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{c.role}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', background: '#f1f5f9', borderRadius: 4, fontSize: 12, fontWeight: 500, color: '#0f172a' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: status?.color }} />
                {status?.label}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>{c.experience} лет опыта · {c.location}</span>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 28px', marginBottom: 24 }}>
              <DrawerField label="Email" value={<span style={{display:'flex',alignItems:'center',gap:5}}><Mail size={12} color="#94a3b8" />ivan.petrov@mail.ru</span>} />
              <DrawerField label="Телефон" value={<span style={{display:'flex',alignItems:'center',gap:5}}><Phone size={12} color="#94a3b8" />+7 (916) ***-**-23</span>} />
              <DrawerField label="Ожидаемая ставка" value={<span style={{fontWeight:600, color:'#0f172a'}}>{c.rate.toLocaleString('ru-RU')} ₽/час</span>} />
              <DrawerField label="Формат работы" value={c.format} />
              <DrawerField label="Источник" value={c.source} />
              <DrawerField label="Ответственный рекрутер" value={<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={getUser(c.recruiterId)} size={20} /><span>{getUser(c.recruiterId)?.name}</span></div>} />
            </div>

            <DrawerSection title="Стек технологий">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {c.stack.map(s => <Tag key={s} color="#eef2ff" fg="#4338ca">{s}</Tag>)}
              </div>
            </DrawerSection>

            <DrawerSection title="История взаимодействий">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 2 }}>
                {[
                  { type: 'status', icon: ArrowRight, text: <>Статус изменён на <b style={{color:'#0f172a'}}>{status?.label}</b></>, who: 'Анна Кузнецова', when: '2 часа назад' },
                  { type: 'note', icon: MessageCircle, text: 'Прошёл техническое интервью на 4/5. Сильные стороны: архитектура, кэширование. Рекомендую к презентации клиенту.', who: 'Анна Кузнецова', when: 'вчера, 16:42' },
                  { type: 'call', icon: Phone, text: 'Скрининг-звонок 30 минут. Подтвердил готовность к гибриду в Москве.', who: 'Анна Кузнецова', when: '17 мая, 11:00' },
                  { type: 'create', icon: Plus, text: 'Кандидат добавлен в систему', who: 'Анна Кузнецова', when: '16 мая' },
                ].map((act, i, arr) => {
                  const Icon = act.icon;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: i === arr.length - 1 ? 0 : 14 }}>
                      {i < arr.length - 1 && (
                        <div style={{ position: 'absolute', left: 11, top: 24, bottom: 0, width: 1, background: '#f1f5f9' }} />
                      )}
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', background: '#fff', border: '1px solid #e2e8f0',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1
                      }}>
                        <Icon size={11} color="#64748b" strokeWidth={1.8} />
                      </div>
                      <div style={{ flex: 1, paddingTop: 1 }}>
                        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>{act.text}</div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>{act.who} · {act.when}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </DrawerSection>
          </div>
        </>
      );
    } else if (selectedEntity.type === 'client') {
      const c = getClient(selectedEntity.id);
      if (!c) return null;
      const am = getUser(c.amId);
      const myVacs = vacancies.filter(v => v.clientId === c.id);
      content = (
        <>
          <div style={{ padding: '0 24px 18px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500, marginBottom: 6 }}>КЛИЕНТ · {c.industry}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.025em', marginBottom: 10 }}>{c.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#64748b' }}>
              <span style={{ fontFeatureSettings: '"tnum"' }}>ИНН {c.inn}</span>
              <span style={{ color: '#cbd5e1' }}>·</span>
              <span style={{ display:'flex',alignItems:'center',gap:5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
                {clientStatusLabel(c.status)}
              </span>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 28px', marginBottom: 24 }}>
              <DrawerField label="Аккаунт-менеджер" value={<div style={{display:'flex',alignItems:'center',gap:6}}><Avatar user={am} size={20} /><span>{am?.name}</span></div>} />
              <DrawerField label="Отрасль" value={c.industry} />
              <DrawerField label="Открытых вакансий" value={<b style={{color:'#0f172a',fontFeatureSettings:'"tnum"'}}>{myVacs.length}</b>} />
              <DrawerField label="Контактных лиц" value={c.contacts} />
            </div>

            <DrawerSection title="Контактные лица">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {['Александр Петров · CTO', 'Ирина Смирнова · HRD', 'Михаил Иванов · Project Manager'].slice(0, c.contacts).map((p, i, arr) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 0', borderBottom: i === arr.length - 1 ? 'none' : '1px solid #f1f5f9'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                        {p.split(' ').map(x => x[0]).slice(0,2).join('')}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>{p.split(' · ')[0]}</div>
                        <div style={{ fontSize: 11.5, color: '#64748b' }}>{p.split(' · ')[1]}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button style={iconBtn}><Mail size={13} /></button>
                      <button style={iconBtn}><Phone size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </DrawerSection>

            <DrawerSection title={`Вакансии · ${myVacs.length}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {myVacs.map(v => {
                  const st = getVacancyStatus(v.status);
                  return (
                    <div key={v.id} onClick={() => setSelectedEntity({ type: 'vacancy', id: v.id })} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', background: '#fafbfc', border: '1px solid #f1f5f9', borderRadius: 6, cursor: 'pointer'
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{v.title}</div>
                        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{v.grade} · {v.format} · {v.candidates} канд.</div>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#475569' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st?.color }} />
                        {st?.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </DrawerSection>
          </div>
        </>
      );
    }

    return (
      <>
        <div onClick={() => setSelectedEntity(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.20)',
          zIndex: 50, backdropFilter: 'blur(2px)', animation: 'fadeIn 0.15s ease-out'
        }} />
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 580, background: '#fff',
          boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.06)', zIndex: 51, overflow: 'auto',
          animation: 'slideIn 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 24px', borderBottom: '1px solid #f1f5f9', position: 'sticky', top: 0, background: '#fff', zIndex: 1
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button style={iconBtn} onClick={() => setSelectedEntity(null)}><ChevronLeft size={14} /></button>
              <button style={iconBtn}><Edit3 size={13} /></button>
              <button style={iconBtn}><Copy size={13} /></button>
              <button style={iconBtn}><MoreHorizontal size={14} /></button>
            </div>
            <button style={iconBtn} onClick={() => setSelectedEntity(null)}><X size={14} /></button>
          </div>
          <div style={{ paddingTop: 24 }}>{content}</div>
        </div>
      </>
    );
  };

  // ============ LAYOUT ============
  const sidebarItems = [
    { id: 'dashboard', label: 'Главная', icon: BarChart3 },
    { id: 'separator', type: 'sep' },
    { id: 'group1', type: 'group', label: 'Работа' },
    { id: 'vacancies-kanban', label: 'Вакансии', icon: Briefcase, count: vacancies.length },
    { id: 'candidates-kanban', label: 'Кандидаты', icon: Users, count: candidates.length },
    { id: 'clients', label: 'Клиенты', icon: Building2, count: initialClients.length },
    { id: 'separator2', type: 'sep' },
    { id: 'group2', type: 'group', label: 'Прочее' },
    { id: 'inbox', label: 'Уведомления', icon: Inbox, badge: 3 },
    { id: 'analytics', label: 'Аналитика', icon: TrendingUp },
    { id: 'audit', label: 'Журнал действий', icon: Activity },
    { id: 'settings', label: 'Настройки', icon: Settings },
  ];

  const titleMap = {
    dashboard: 'Главная',
    'vacancies-kanban': 'Вакансии',
    'candidates-kanban': 'Кандидаты',
    clients: 'Клиенты',
    inbox: 'Уведомления',
    analytics: 'Аналитика',
    audit: 'Журнал действий',
    settings: 'Настройки'
  };

  const isKanban = section === 'vacancies-kanban' || section === 'candidates-kanban';

  return (
    <div style={{
      display: 'flex', height: '100vh', background: '#fafbfc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: 14, color: '#0f172a', letterSpacing: '-0.005em', WebkitFontSmoothing: 'antialiased'
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        * { box-sizing: border-box; }
        button { font-family: inherit; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 5px; border: 2px solid transparent; background-clip: padding-box; }
        ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; background-clip: padding-box; border: 2px solid transparent; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {/* SIDEBAR */}
      <aside style={{
        width: 232, background: '#fafbfc', borderRight: '1px solid #f1f5f9',
        display: 'flex', flexDirection: 'column', flexShrink: 0
      }}>
        <div style={{ padding: '14px 12px 10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 5, background: '#0f172a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em'
          }}>ЛГ</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', letterSpacing: '-0.015em', lineHeight: 1.2 }}>ЛГ Интеграция</div>
            <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 1 }}>CRM · аутстаффинг</div>
          </div>
        </div>

        <div style={{ padding: '6px 8px' }}>
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px',
            background: 'transparent', border: 'none', color: '#64748b', fontSize: 13,
            cursor: 'pointer', borderRadius: 4, transition: 'background 0.1s'
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Search size={14} strokeWidth={1.8} />
            <span style={{ flex: 1, textAlign: 'left' }}>Поиск</span>
            <span style={{ fontSize: 10.5, color: '#cbd5e1', fontFamily: 'ui-monospace, SF Mono, monospace' }}>⌘K</span>
          </button>
        </div>

        <nav style={{ flex: 1, padding: '4px 8px', overflowY: 'auto' }}>
          {sidebarItems.map(item => {
            if (item.type === 'sep') return <div key={item.id} style={{ height: 12 }} />;
            if (item.type === 'group') return (
              <div key={item.id} style={{ padding: '4px 7px 4px', fontSize: 10.5, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {item.label}
              </div>
            );
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px',
                  background: active ? '#eef2f7' : 'transparent', border: 'none',
                  color: active ? '#0f172a' : '#475569', fontSize: 13,
                  cursor: 'pointer', borderRadius: 4, transition: 'all 0.1s',
                  fontWeight: active ? 600 : 500, marginBottom: 1
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#f1f5f9'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon size={14} strokeWidth={active ? 2 : 1.7} />
                <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                {item.count !== undefined && (
                  <span style={{ fontSize: 11, color: '#94a3b8', fontFeatureSettings: '"tnum"' }}>{item.count}</span>
                )}
                {item.badge && (
                  <span style={{
                    minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: '#0f172a',
                    color: '#fff', fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFeatureSettings: '"tnum"'
                  }}>{item.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* USER FOOTER */}
        <div style={{ padding: '8px 8px 14px', borderTop: '1px solid #f1f5f9', marginTop: 4 }}>
          <button style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '5px 6px',
            background: 'transparent', border: 'none', borderRadius: 5, cursor: 'pointer',
            transition: 'background 0.1s', textAlign: 'left'
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Avatar user={currentUser} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser.name}</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8' }}>Администратор</div>
            </div>
            <ChevronDown size={13} color="#94a3b8" />
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* TOPBAR */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', height: 52, borderBottom: '1px solid #f1f5f9', background: '#fff', flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#64748b' }}>
            <span style={{ color: '#0f172a', fontWeight: 600, letterSpacing: '-0.015em', fontSize: 14.5 }}>{titleMap[section]}</span>
            {isKanban && (
              <>
                <ChevronRight size={12} color="#cbd5e1" />
                <span style={{ fontSize: 12.5 }}>Канбан</span>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {(isKanban || section === 'clients') && (
              <div style={{ position: 'relative' }}>
                <Search size={13} color="#94a3b8" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск..."
                  style={{
                    height: 30, padding: '0 10px 0 28px', fontSize: 12.5, color: '#0f172a',
                    background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 6, outline: 'none', width: 200,
                    fontFamily: 'inherit', transition: 'all 0.12s'
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.background = '#fff'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.background = '#f8fafc'; }}
                />
              </div>
            )}
            {isKanban && (
              <button
                onClick={() => setFilterOpen(!filterOpen)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', height: 30,
                  fontSize: 12.5, background: filterOpen ? '#eef2f7' : '#fff', border: '1px solid #e2e8f0',
                  borderRadius: 6, color: '#0f172a', cursor: 'pointer', fontWeight: 500, transition: 'all 0.1s'
                }}
              >
                <Filter size={12} strokeWidth={1.8} /> Фильтр
                {Object.values(filters).filter(Boolean).length > 0 && (
                  <span style={{
                    minWidth: 16, height: 16, padding: '0 4px', background: '#0f172a', color: '#fff',
                    borderRadius: 8, fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFeatureSettings: '"tnum"'
                  }}>{Object.values(filters).filter(Boolean).length}</span>
                )}
              </button>
            )}
            <button style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '0 11px', height: 30,
              fontSize: 12.5, background: '#0f172a', border: 'none',
              borderRadius: 6, color: '#fff', cursor: 'pointer', fontWeight: 500
            }}>
              <Plus size={13} strokeWidth={2.2} /> Создать
            </button>
            <div style={{ width: 1, height: 18, background: '#f1f5f9', margin: '0 4px' }} />
            <button style={iconBtn}><Bell size={14} /></button>
          </div>
        </header>

        {/* FILTERS BAR */}
        {isKanban && filterOpen && (
          <div style={{
            padding: '10px 24px', borderBottom: '1px solid #f1f5f9', background: '#fafbfc',
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5
          }}>
            <FilterDropdown label="Грейд" value={filters.grade} options={['Junior', 'Middle', 'Senior', 'Lead']} onChange={(v) => setFilters({...filters, grade: v})} />
            {section === 'vacancies-kanban' && (
              <>
                <FilterDropdown label="Приоритет" value={filters.priority} options={[['low','Низкий'],['medium','Средний'],['high','Высокий'],['urgent','Срочно']]} onChange={(v) => setFilters({...filters, priority: v})} />
                <FilterDropdown label="Клиент" value={filters.client} options={initialClients.map(c => [c.id, c.name])} onChange={(v) => setFilters({...filters, client: v})} />
              </>
            )}
            <FilterDropdown label="Рекрутер" value={filters.recruiter} options={users.filter(u => u.role === 'recruiter').map(u => [u.id, u.name])} onChange={(v) => setFilters({...filters, recruiter: v})} />
            {Object.values(filters).filter(Boolean).length > 0 && (
              <button onClick={() => setFilters({ grade: null, priority: null, recruiter: null, client: null })} style={{
                padding: '4px 9px', background: 'transparent', border: 'none', color: '#64748b',
                fontSize: 12, cursor: 'pointer', fontWeight: 500
              }}>Сбросить все</button>
            )}
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <button onClick={() => setView('kanban')} style={{
                padding: '3px 7px', background: view === 'kanban' ? '#eef2f7' : 'transparent', border: 'none',
                borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#0f172a', fontWeight: 500
              }}><LayoutGrid size={11} /> Канбан</button>
              <button onClick={() => setView('list')} style={{
                padding: '3px 7px', background: view === 'list' ? '#eef2f7' : 'transparent', border: 'none',
                borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#0f172a', fontWeight: 500
              }}><List size={11} /> Список</button>
            </div>
          </div>
        )}

        {/* CONTENT */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingTop: 18 }}>
          {section === 'dashboard' && <Dashboard />}
          {section === 'vacancies-kanban' && <VacanciesKanban />}
          {section === 'candidates-kanban' && <CandidatesKanban />}
          {section === 'clients' && <ClientsList />}
          {!['dashboard', 'vacancies-kanban', 'candidates-kanban', 'clients'].includes(section) && (
            <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Раздел <b style={{color:'#475569'}}>{titleMap[section]}</b> — следующая итерация (см. ТЗ §5—§8).
            </div>
          )}
        </div>
      </main>

      <Drawer />
    </div>
  );
}

// ============ SUBCOMPONENTS ============
const iconBtn = {
  width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', borderRadius: 5, cursor: 'pointer', color: '#64748b',
  transition: 'background 0.1s'
};

const DrawerField = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    <div style={{ fontSize: 13, color: '#0f172a' }}>{value}</div>
  </div>
);

const DrawerSection = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
    {children}
  </div>
);

const FilterDropdown = ({ label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const display = value ? (Array.isArray(options[0]) ? options.find(o => o[0] === value)?.[1] : value) : null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', fontSize: 12, color: '#0f172a',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', fontWeight: 500
      }}>
        <span style={{ color: '#64748b' }}>{label}{value ? ':' : ''}</span>
        {display && <span style={{ fontWeight: 600 }}>{display}</span>}
        <ChevronDown size={11} color="#94a3b8" />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 6px 16px rgba(15, 23, 42, 0.08)',
          padding: 4, zIndex: 10, minWidth: 160
        }}>
          {options.map((opt, i) => {
            const [val, txt] = Array.isArray(opt) ? opt : [opt, opt];
            return (
              <button key={i} onClick={() => { onChange(value === val ? null : val); setOpen(false); }} style={{
                width: '100%', padding: '5px 9px', background: value === val ? '#eef2f7' : 'transparent',
                border: 'none', borderRadius: 4, textAlign: 'left', cursor: 'pointer',
                fontSize: 12.5, color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}
                onMouseEnter={(e) => { if (value !== val) e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={(e) => { if (value !== val) e.currentTarget.style.background = 'transparent'; }}
              >
                {txt}
                {value === val && <Check size={11} color="#0f172a" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
