/* eslint-disable @typescript-eslint/no-require-imports */
/* One-time script run with `node restore-dictionaries.js` (CommonJS). */
const fs = require('fs');
const path = require('path');

const enDictPath = path.join(__dirname, 'app/[lang]/dictionaries/en.json');
const arDictPath = path.join(__dirname, 'app/[lang]/dictionaries/ar.json');

const enDict = JSON.parse(fs.readFileSync(enDictPath, 'utf8').replace(/^\uFEFF/, ''));
const arDict = JSON.parse(fs.readFileSync(arDictPath, 'utf8').replace(/^\uFEFF/, ''));

// Add resourcesPage to EN dictionary
enDict.resourcesPage = {
  kicker: "Summaries",
  title: "Educational Summaries",
  subtitle: "Student-made summaries, cheat sheets, and guides — organized by subject so you can find what you need fast.",
  categories: [
    { id: "all", label: "All" },
    { id: "programming", label: "Programming" },
    { id: "engineering", label: "Engineering" },
    { id: "math", label: "Mathematics" },
    { id: "science", label: "Science" },
    { id: "general", label: "General" }
  ],
  items: [
    {
      id: "networks",
      title: "Computer Networks",
      category: "engineering",
      excerpt: "Comprehensive coverage of networking fundamentals, OSI model, protocols, and network architecture.",
      tags: ["Networking", "OSI", "Protocols"],
      summaries: [
        {
          id: "networks-comprehensive",
          title: "Comprehensive Summary — Computer Networks",
          description: "Complete coverage of all networking topics from fundamentals to advanced protocols.",
          files: [
            {
              id: "networks-comprehensive-pdf",
              file: "Comprehensive Summary.pdf",
              type: "pdf",
              uploader: "Committee",
              uploadedAt: "Aug 2026",
              pages: 25,
              size: "2.4 MB",
              url: "/files/sample.pdf"
            }
          ],
          externalResources: [
            {
              id: "networks-video-1",
              title: "Computer Networks Lecture",
              url: "https://www.youtube.com/watch?v=example",
              type: "youtube"
            }
          ]
        },
        {
          id: "networks-osi",
          title: "OSI Model Summary",
          description: "Detailed explanation of the seven-layer OSI model with examples.",
          files: [],
          externalResources: []
        },
        {
          id: "networks-chapter1",
          title: "Chapter One Comprehensive Review",
          description: "Complete review of chapter one covering network basics and terminology.",
          files: [],
          externalResources: []
        },
        {
          id: "networks-qa",
          title: "Questions and Answers on the Subject",
          description: "Collection of common exam questions with detailed answers.",
          files: [],
          externalResources: []
        },
        {
          id: "networks-brief",
          title: "Brief Note — Computer Networks",
          description: "Concise summary of key networking concepts for quick review.",
          files: [],
          externalResources: []
        }
      ]
    },
    {
      id: "oop",
      title: "Object-Oriented Programming",
      category: "programming",
      excerpt: "Classes, inheritance, polymorphism, and interfaces explained with practical examples.",
      tags: ["OOP", "Java", "Programming"],
      summaries: [
        {
          id: "oop-basics",
          title: "OOP Fundamentals",
          description: "Core concepts of object-oriented programming with Java examples.",
          files: [],
          externalResources: []
        }
      ]
    },
    {
      id: "os",
      title: "Operating Systems",
      category: "programming",
      excerpt: "Processes, threads, scheduling, and memory management condensed into an exam-ready reference.",
      tags: ["OS", "Processes", "Memory"],
      summaries: [
        {
          id: "os-processes",
          title: "Process Management",
          description: "Complete guide to process lifecycle, scheduling, and synchronization.",
          files: [],
          externalResources: []
        }
      ]
    },
    {
      id: "dld",
      title: "Digital Logic Design",
      category: "engineering",
      excerpt: "From truth tables to sequential circuits: the essentials of digital logic design.",
      tags: ["Logic", "Circuits", "Digital"],
      summaries: [
        {
          id: "dld-gates",
          title: "Logic Gates Summary",
          description: "Comprehensive overview of all logic gates and their applications.",
          files: [],
          externalResources: []
        }
      ]
    }
  ],
  stage: {
    hint: "Drag · scroll · or use the arrow keys to move through the archive.",
    filter: "Filter summaries",
    flip: "Flip card",
    back: "Back to summary",
    open: "Open summary",
    of: "of",
    prev: "Previous summary",
    next: "Next summary"
  },
  library: {
    kicker: "Library",
    title: "All materials",
    subtitle: "Every material in one place.",
    open: "Open material",
    empty: "No materials yet.",
    search: "Search materials...",
    noResults: "No materials found"
  },
  detail: {
    back: "All summaries",
    backToSubject: "Back to material",
    files: "Summaries",
    filesSubtitle: "Available summaries for this material.",
    readFile: "Read",
    uploadedBy: "Uploaded by",
    pages: "pages",
    view: "View",
    externalResources: "External Resources",
    externalResourcesSubtitle: "Additional resources and videos.",
    watch: "Watch"
  }
};

// Add homeResources to EN dictionary
enDict.homeResources = {
  readMore: "Read"
};

// Add resourcesPage to AR dictionary
arDict.resourcesPage = {
  kicker: "الملخصات",
  title: "ملخصات تعليمية",
  subtitle: "ملخصات وأوراق مراجعة وأدلة من إعداد الطلبة، منظمة حسب المادة لتجد ما تحتاجه بسرعة.",
  categories: [
    { id: "all", label: "الكل" },
    { id: "programming", label: "البرمجة" },
    { id: "engineering", label: "الهندسة" },
    { id: "math", label: "الرياضيات" },
    { id: "science", label: "العلوم" },
    { id: "general", label: "عام" }
  ],
  items: [
    {
      id: "networks",
      title: "شبكات الحاسوب",
      category: "engineering",
      excerpt: "تغطية شاملة لأساسيات الشبكات، نموذج OSI، البروتوكولات، وهندسة الشبكات.",
      tags: ["شبكات", "OSI", "بروتوكولات"],
      summaries: [
        {
          id: "networks-comprehensive",
          title: "ملخص شامل — شبكات الحاسوب",
          description: "تغطية كاملة لجميع مواضيع الشبكات من الأساسيات إلى البروتوكولات المتقدمة.",
          files: [
            {
              id: "networks-comprehensive-pdf",
              file: "ملخص شامل.pdf",
              type: "pdf",
              uploader: "اللجنة",
              uploadedAt: "آب 2026",
              pages: 25,
              size: "2.4 MB",
              url: "/files/sample.pdf"
            }
          ],
          externalResources: [
            {
              id: "networks-video-1",
              title: "محاضرة شبكات الحاسوب",
              url: "https://www.youtube.com/watch?v=example",
              type: "youtube"
            }
          ]
        },
        {
          id: "networks-osi",
          title: "ملخص نموذج OSI",
          description: "شرح مفصل لطبقات نموذج OSI السبع مع أمثلة.",
          files: [],
          externalResources: []
        },
        {
          id: "networks-chapter1",
          title: "مراجعة شاملة للفصل الأول",
          description: "مراجعة كاملة للفصل الأول تغطي أساسيات الشبكات والمصطلحات.",
          files: [],
          externalResources: []
        },
        {
          id: "networks-qa",
          title: "أسئلة وأجوبة على المادة",
          description: "مجموعة من أسئلة الامتحانات الشائعة مع إجابات مفصلة.",
          files: [],
          externalResources: []
        },
        {
          id: "networks-brief",
          title: "مذكرة مختصرة — شبكات الحاسوب",
          description: "ملخص موجز للمفاهيم الرئيسية للشبكات للمراجعة السريعة.",
          files: [],
          externalResources: []
        }
      ]
    },
    {
      id: "oop",
      title: "البرمجة كائنية التوجه",
      category: "programming",
      excerpt: "الكلاسات والوراثة وتعدد الأشكال والواجهات موضحة بأمثلة عملية.",
      tags: ["OOP", "جافا", "برمجة"],
      summaries: [
        {
          id: "oop-basics",
          title: "أساسيات البرمجة كائنية التوجه",
          description: "المفاهيم الأساسية للبرمجة كائنية التوجه مع أمثلة جافا.",
          files: [],
          externalResources: []
        }
      ]
    },
    {
      id: "os",
      title: "أنظمة التشغيل",
      category: "programming",
      excerpt: "العمليات والخيوط والجدولة وإدارة الذاكرة مختصرة في مرجع جاهز للامتحان.",
      tags: ["أنظمة تشغيل", "عمليات", "ذاكرة"],
      summaries: [
        {
          id: "os-processes",
          title: "إدارة العمليات",
          description: "دليل كامل لدورة حياة العملية والجدولة والمزامنة.",
          files: [],
          externalResources: []
        }
      ]
    },
    {
      id: "dld",
      title: "تصميم المنطق الرقمي",
      category: "engineering",
      excerpt: "من جداول الصواب إلى الدارات التتابعية: أساسيات تصميم المنطق الرقمي.",
      tags: ["منطق", "دارات", "رقمي"],
      summaries: [
        {
          id: "dld-gates",
          title: "ملخص البوابات المنطقية",
          description: "نظرة شاملة على جميع البوابات المنطقية وتطبيقاتها.",
          files: [],
          externalResources: []
        }
      ]
    }
  ],
  stage: {
    hint: "اسحب · مرّر · أو استخدم مفاتيح الأسهم للتنقل في الأرشيف.",
    filter: "تصفية الملخصات",
    flip: "اقلب البطاقة",
    back: "العودة إلى الملخص",
    open: "فتح الملخص",
    of: "من",
    prev: "الملخص السابق",
    next: "الملخص التالي"
  },
  library: {
    kicker: "المكتبة",
    title: "جميع المواد",
    subtitle: "كل مادة في مكان واحد.",
    open: "فتح المادة",
    empty: "لا توجد مواد بعد.",
    search: "ابحث عن المادة...",
    noResults: "لم يتم العثور على مواد"
  },
  detail: {
    back: "كل الملخصات",
    backToSubject: "العودة إلى المادة",
    files: "الملخصات",
    filesSubtitle: "الملخصات المتاحة لهذه المادة.",
    readFile: "اقرأ",
    uploadedBy: "رفع بواسطة",
    pages: "صفحات",
    view: "عرض",
    externalResources: "مصادر خارجية",
    externalResourcesSubtitle: "موارد وفيديوهات إضافية.",
    watch: "مشاهدة"
  }
};

// Add homeResources to AR dictionary
arDict.homeResources = {
  readMore: "اقرأ"
};

// Update nav to use "Summaries" instead of "Resources"
enDict.nav.resources = "Summaries";
arDict.nav.resources = "الملخصات";

// Write back to files
fs.writeFileSync(enDictPath, JSON.stringify(enDict, null, 2) + '\n', 'utf8');
fs.writeFileSync(arDictPath, JSON.stringify(arDict, null, 2) + '\n', 'utf8');

console.log('Dictionaries updated successfully');
console.log('EN resourcesPage items:', enDict.resourcesPage.items.length);
console.log('AR resourcesPage items:', arDict.resourcesPage.items.length);
