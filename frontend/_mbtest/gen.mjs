import { generateResumeDocxBlobKhronyuk } from './generateDocxKhronyuk.mjs';
import { writeFileSync } from 'fs';

const candidate = {
  fullName: 'Иванов Иван Иванович',
  role: 'Java-разработчик',
  grade: 'Middle',
  location: 'г. Москва',
  birthday: '1994-05-16',
  summary: 'Занимаюсь backend-разработкой более 5 лет. Проектирую микросервисы на Spring Boot, работаю с высоконагруженными системами и брокерами сообщений. Имею опыт менторинга junior-разработчиков.',
  skillCategories: [
    { name: 'Платформы', items: ['Linux', 'Docker', 'Kubernetes'] },
    { name: 'Языки программирования', items: ['Java', 'Kotlin', 'SQL'] },
    { name: 'Фреймворки и инструменты', items: ['Spring Boot', 'Spring Security', 'Hibernate', 'Kafka', 'Gradle', 'Jenkins', 'Git', 'JUnit', 'Mockito'] },
    { name: 'Базы данных', items: ['PostgreSQL', 'Oracle', 'Redis'] },
  ],
  experience: [
    {
      company: 'Сбербанк — Платформа платежей',
      position: 'Senior Java Developer',
      startMonth: '2021-03', endMonth: null,
      project: 'Разработка платёжного шлюза для обработки массовых транзакций с гарантией доставки.',
      achievements: ['Спроектировал модуль идемпотентности, снизивший дублирование платежей до нуля', 'Внедрил Kafka для асинхронной обработки, ускорив пиковую пропускную способность на 40%', 'Настроил CI/CD в Jenkins и покрытие тестами до 85%'],
      stack: ['Java 17', 'Spring Boot', 'Kafka', 'PostgreSQL', 'Docker'],
    },
    {
      company: 'Тинькофф — Кредитный конвейер',
      position: 'Java Developer',
      startMonth: '2019-01', endMonth: '2021-02',
      project: 'Сервис скоринга заявок в реальном времени.',
      achievements: ['Реализовал REST API интеграции с бюро кредитных историй', 'Оптимизировал SQL-запросы, сократив время ответа с 800 до 120 мс'],
      stack: ['Java 11', 'Spring', 'Oracle', 'Hibernate'],
    },
  ],
  education: [
    { degree: 'магистр', specialty: 'Прикладная математика и информатика', institution: 'МГУ им. Ломоносова', city: 'Москва', graduationYear: 2018, period: '' },
  ],
  certifications: [{ title: 'Oracle Certified Professional', issuer: 'Oracle', period: '2020' }],
  languages: [{ language: 'Русский', level: 'родной' }, { language: 'Английский', level: 'B2' }],
};

const blob = await generateResumeDocxBlobKhronyuk(candidate);
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync('/sessions/sweet-zealous-cray/mnt/outputs/sample_mb.docx', buf);
console.log('written', buf.length, 'bytes');
