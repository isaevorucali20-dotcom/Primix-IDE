import React, { useState, useEffect, useRef } from "react";
import MonacoEditor, { Monaco } from "@monaco-editor/react";
import {
  Terminal,
  Cpu,
  Play,
  Square,
  Save,
  BookOpen,
  Database,
  Network,
  Send,
  Bot,
  Sparkles,
  Code,
  FileCode,
  Plus,
  RefreshCw,
  Copy,
  ExternalLink,
  ShieldAlert,
  HelpCircle,
  Activity,
  Layers,
  ChevronRight,
  UserCheck,
  Check,
  Smartphone,
  CheckCircle,
  FileText,
  // Added cloud integration icons
  Cloud,
  CloudOff,
  LogOut,
  LogIn,
  TrendingUp
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from "recharts";
import { TEMPLATES } from "./data/templates";
import { ProjectFile, PXVMState, DiagnosticError, ChatMessage } from "./types";
import { diagnosePrimixCode, compilePrimixCode } from "./utils/compiler";
import { 
  auth, 
  signInAnonymously, 
  signInWithPopup, 
  googleProvider, 
  signOut, 
  syncFilesToCloud, 
  getFilesFromCloud, 
  saveChatMessageToCloud, 
  loadChatHistoryFromCloud 
} from "./lib/firebase";
import { User as FirebaseUser } from "firebase/auth";

export default function App() {
  // Files system state - preload with platform templates, merging new ones dynamically
  const [files, setFiles] = useState<ProjectFile[]>(() => {
    const saved = localStorage.getItem("primix_files");
    if (!saved) return TEMPLATES;
    try {
      const parsed = JSON.parse(saved) as ProjectFile[];
      // Filter out obsolete win_launcher.bat template
      const filtered = parsed.filter(f => f.path !== "/win_launcher.bat");
      const merged = [...filtered];
      TEMPLATES.forEach(t => {
        if (!merged.some(f => f.path === t.path)) {
          merged.push(t);
        }
      });
      return merged;
    } catch {
      return TEMPLATES;
    }
  });

  const [activeFilePath, setActiveFilePath] = useState<string>(() => {
    return TEMPLATES[4]?.path || "/universal_android_cloud.pmx";
  });

  const activeFile = files.find(f => f.path === activeFilePath) || files[0];

  // Editor states
  const [activeTab, setActiveTab] = useState<"explorer" | "api" | "debugger" | "docs">("explorer");
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // LSP & compilation error states
  const [lspDiagnostics, setLspDiagnostics] = useState<DiagnosticError[]>([]);

  // Debugger VM States
  const [vmState, setVmState] = useState<PXVMState>({
    isBooted: false,
    port: null,
    tables: [],
    routes: [],
    bridges: [],
    watches: [],
    customLogs: [],
    variables: {}
  });

  // REST emulator variables
  const [selectedSimRoute, setSelectedSimRoute] = useState<string>("");
  const [simResponse, setSimResponse] = useState<{ status: string; data: string; time: string } | null>(null);

  // Database emulator variables
  const [selectedSimTable, setSelectedSimTable] = useState<string>("");
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});
  const [showAddRowForm, setShowAddRowForm] = useState<boolean>(false);

  // Debugger sub panel navigation & real-time telemetry variables history
  const [debuggerSubTab, setDebuggerSubTab] = useState<"controls" | "chart">("controls");
  const [isLiveTelemetryEmulation, setIsLiveTelemetryEmulation] = useState<boolean>(false);
  const [watchHistory, setWatchHistory] = useState<Array<{ timestamp: string; [varName: string]: any }>>([]);
  const latestVariablesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    latestVariablesRef.current = vmState.variables;
  }, [vmState.variables]);

  // Jitter variables periodically to show moving real-time graphs on Recharts
  useEffect(() => {
    if (!vmState.isBooted || !isLiveTelemetryEmulation) return;

    const interval = setInterval(() => {
      const currentVars = latestVariablesRef.current;
      const numericVars = Object.entries(currentVars).filter(([k, v]) => !isNaN(parseFloat(v as string)));
      if (numericVars.length === 0) return;

      // Jitter a random numeric variable to show real-time stream updates.
      const randIndex = Math.floor(Math.random() * numericVars.length);
      const [vName, vVal] = numericVars[randIndex];
      const valNum = parseFloat(vVal as string);
      
      const delta = (Math.random() * 12 - 6); // Delta between -6 and +6
      const newVal = Math.max(5, Math.min(145, Math.round(valNum + delta)));
      
      handleVariableChange(vName, String(newVal));
    }, 1500);

    return () => clearInterval(interval);
  }, [vmState.isBooted, isLiveTelemetryEmulation]);

  // Gemini assistant states
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "model",
      text: "👋 Привет! Я твой интеллектуальный ассистент Primix Copilot.\n\nЯ — твой надежный **помощник** для ускорения работы, я в совершенстве знаю весь декларативный синтаксис языка **Primix (PX)**!\n\nЯ помогу спроектировать базы данных, написать интеграционные C# или Android (Kotlin) мосты, составить пошаговые скрипты деплоя сервера, выявить баги и подробно разобрать логику реактивного вещания в коде.\n\nВыберите подходящий шаблон слева (включая конфигурации запуска под Windows 7/10/11, WebView-клиент под iOS/Android и скрипт серверной автоматизации) или задайте свой вопрос!",
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [userInput, setUserInput] = useState<string>("");
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  // Interactive terminals
  const [terminalLogs, setTerminalLogs] = useState<Array<{ text: string; type: "input" | "output" | "error" | "system" }>>([
    { text: "=== SYSTEM CORE PRIMIX TERMINAL ===", type: "system" },
    { text: "Type 'help' list commands or click 'Debug' tab below to activate compiler backend VM.", type: "output" }
  ]);
  const [terminalCommand, setTerminalCommand] = useState<string>("");
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const vmLendingLogsRef = useRef<HTMLDivElement>(null);

  // Notification notification State
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" } | null>(null);

  // Firebase Auth & Cloud Sync State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isCloudSyncing, setIsCloudSyncing] = useState<boolean>(false);

  // Auto-save files with Real-time Cloud Sync
  const saveFilesToStore = async (newFiles: ProjectFile[]) => {
    setFiles(newFiles);
    localStorage.setItem("primix_files", JSON.stringify(newFiles));
    
    if (user) {
      setIsCloudSyncing(true);
      try {
        await syncFilesToCloud(user.uid, newFiles);
      } catch (err) {
        console.error("Failed to sync updated files:", err);
      } finally {
        setIsCloudSyncing(false);
      }
    }
  };

  // Track Firebase Auth and load Cloud files/chat
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        setIsCloudSyncing(true);
        try {
          // Push existing local files as a merge fallback first
          await syncFilesToCloud(currentUser.uid, files);
          
          // Download remote files from Cloud database
          const cloudFiles = await getFilesFromCloud(currentUser.uid);
          if (cloudFiles && cloudFiles.length > 0) {
            setFiles(prev => {
              const merged = [...prev];
              cloudFiles.forEach(cf => {
                const index = merged.findIndex(f => f.path === cf.path);
                if (index !== -1) {
                  const localTime = new Date(merged[index].updatedAt || 0).getTime();
                  const remoteTime = new Date(cf.updatedAt || 0).getTime();
                  if (remoteTime > localTime) {
                    merged[index] = {
                      path: cf.path,
                      name: cf.name,
                      platform: cf.platform,
                      content: cf.content,
                      updatedAt: cf.updatedAt
                    };
                  }
                } else {
                  merged.push({
                    path: cf.path,
                    name: cf.name,
                    platform: cf.platform,
                    content: cf.content,
                    updatedAt: cf.updatedAt
                  });
                }
              });
              localStorage.setItem("primix_files", JSON.stringify(merged));
              return merged;
            });
          }
          
          // Load chat conversation history from cloud
          const remoteChat = await loadChatHistoryFromCloud(currentUser.uid);
          if (remoteChat && remoteChat.length > 0) {
            setChatMessages(prev => {
              const welcome = prev.find(m => m.id === "welcome");
              const formatted = remoteChat.map((m, idx) => ({
                id: `cloud_${idx}_${m.createdAt || Date.now()}`,
                role: m.role as "user" | "model",
                text: m.text,
                timestamp: m.timestamp
              }));
              return welcome ? [welcome, ...formatted] : formatted;
            });
          }
        } catch (err) {
          console.error("Initial cloud data sync failed:", err);
        } finally {
          setIsCloudSyncing(false);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const showToastMsg = (msg: string, type: "success" | "info" = "success") => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Sync scroll on terminal bottom
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLogs]);

  useEffect(() => {
    vmLendingLogsRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [vmState.customLogs]);

  // Set file changes in editor back to model
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    const updated = files.map(f => {
      if (f.path === activeFilePath) {
        return { ...f, content: value };
      }
      return f;
    });
    saveFilesToStore(updated);
  };

  // Compile / Run VM
  const startDebuggerVM = () => {
    const diagnostics = diagnosePrimixCode(activeFile.content);
    const hasErrors = diagnostics.some(d => d.severity === "error");

    if (hasErrors) {
      showToastMsg("Компиляция сорвана: исправьте ошибки синтаксиса в коде", "info");
      
      // Print compilation output inside the console terminal
      const errLogs = diagnostics.map(d => `STRM Error: line ${d.line} col ${d.column} - ${d.message}`);
      setTerminalLogs(prev => [
        ...prev,
        { text: `> Running build check inside /${activeFile.name}...`, type: "input" },
        { text: `💥 Compiling failed with ${diagnostics.length} issue(s)`, type: "error" },
        ...errLogs.map(e => ({ text: e, type: "error" as const }))
      ]);
      return;
    }

    const parsed = compilePrimixCode(activeFile.content);
    const mockPort = parsed.port || 8080;

    // Build standard simulated logs
    const initialLogs = [
      { timestamp: new Date().toLocaleTimeString(), type: "info" as const, message: "⚙️ Инициализация виртуального процессора Primix PX VM..." },
      { timestamp: new Date().toLocaleTimeString(), type: "success" as const, message: `🚀 Сервер успешно запущен. Прослушивается порт TCP: ${mockPort}` },
    ];

    parsed.tables.forEach(t => {
      initialLogs.push({
        timestamp: new Date().toLocaleTimeString(),
        type: "success" as const,
        message: `🗄️ Хранилище: Инициализирована БД таблица '${t.name}' c полями (${t.columns.join(", ")})`
      });
    });

    parsed.bridges.forEach(b => {
      initialLogs.push({
        timestamp: new Date().toLocaleTimeString(),
        type: "info" as const,
        message: `🔌 Интеграционный шлюз: Активирован Bridge [${b.client}] по протоколу [${b.protocol}]`
      });
    });

    parsed.watches.forEach(w => {
      initialLogs.push({
        timestamp: new Date().toLocaleTimeString(),
        type: "info" as const,
        message: `👁️ Reactive Core: Запущен фоновый наблюдатель (watch) за переменной '${w.variable}'`
      });
    });

    // Initialize watch history state for Recharts
    const initialHistPoint: Record<string, any> = {
      timestamp: new Date().toLocaleTimeString()
    };
    Object.entries(parsed.variables).forEach(([k, v]) => {
      const parsedNum = parseFloat(v);
      if (!isNaN(parsedNum)) {
        initialHistPoint[k] = parsedNum;
      } else {
        if (v === "Online" || v === "OK" || v === "ADMIN") {
          initialHistPoint[k] = 1;
        } else if (v === "Offline" || v === "RESTRICTED") {
          initialHistPoint[k] = 0;
        } else if (v === "BREACH") {
          initialHistPoint[k] = -1;
        } else {
          initialHistPoint[k] = 0;
        }
      }
    });
    setWatchHistory([initialHistPoint]);

    setVmState({
      isBooted: true,
      port: mockPort,
      tables: parsed.tables,
      routes: parsed.routes,
      bridges: parsed.bridges,
      watches: parsed.watches,
      customLogs: initialLogs,
      variables: parsed.variables
    });

    // Populate drop-downs stateful variables
    if (parsed.routes.length > 0) {
      setSelectedSimRoute(parsed.routes[0].path);
    }
    if (parsed.tables.length > 0) {
      setSelectedSimTable(parsed.tables[0].name);
      // Pre-fill columns keys for add row state
      const initialForm: Record<string, string> = {};
      parsed.tables[0].columns.forEach(col => {
        initialForm[col] = "";
      });
      setNewRowData(initialForm);
    }

    setTerminalLogs(prev => [
      ...prev,
      { text: `[PX VM] booting compiler server environment...`, type: "system" },
      { text: `[PX VM] Success! Host binds on socket 0.0.0.0:${mockPort}`, type: "output" },
      { text: `[PX VM] ${parsed.tables.length} tables parsed and allocated in-memory.`, type: "output" }
    ]);

    showToastMsg("Primix PX VM запущена успешно!");
  };

  const stopDebuggerVM = () => {
    setVmState(prev => ({
      ...prev,
      isBooted: false,
      customLogs: [
        ...prev.customLogs,
        { timestamp: new Date().toLocaleTimeString(), type: "warning" as const, message: "🛑 Виртуальная машина Primix остановлена. Сокеты закрыты." }
      ]
    }));
    setTerminalLogs(prev => [
      ...prev,
      { text: `[PX VM] shutting down and releasing TCP bindings.`, type: "system" }
    ]);
    showToastMsg("Primix VM остановлена", "info");
  };

  // Dynamic compiler validation when content changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      const model = editor.getModel();

      const diagnostics = diagnosePrimixCode(activeFile.content);
      const markers = diagnostics.map(d => ({
        startLineNumber: d.line,
        endLineNumber: d.line,
        startColumn: d.column,
        endColumn: d.column + 25,
        message: d.message,
        severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
      }));

      monaco.editor.setModelMarkers(model, "lsp-diagnostic-parser", markers);
      setLspDiagnostics(diagnostics);
    }
  }, [activeFile.content, activeFilePath, editorRef.current, monacoRef.current]);

  // Editor did mount - setup language constraints
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register Primix PX custom language for VS Code visual output
    if (!monaco.languages.getLanguages().some(lang => lang.id === "primix")) {
      monaco.languages.register({ id: "primix" });

      // Monarch Token Parser for accurate text coloring
      monaco.languages.setMonarchTokensProvider("primix", {
        keywords: [
          "port", "table", "path", "block", "match", "case", "bridge", "watch", "trigger", "welcome"
        ],
        typeKeywords: [
          "users", "telemetry", "active_processes", "local_store", "cloud_sync"
        ],
        operators: [
          "->", "="
        ],
        symbols:  /[=><!~?:&|+\-*\/\^%]+/,
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
        tokenizer: {
          root: [
            [/[a-zA-Z_$][\w$]*/, {
              cases: {
                "@keywords": "keyword",
                "@typeKeywords": "type",
                "@default": "identifier"
              }
            }],
            { include: "@whitespace" },
            [/[{}()\[\]]/, "@brackets"],
            [/@symbols/, {
              cases: {
                "@operators": "operator",
                "@default": ""
              }
            }],
            [/\d+/, "number"],
            [/"([^"\\]|\\.)*"/, "string"],
          ],
          whitespace: [
            [/[ \t\r\n]+/, "white"],
            [/#.*$/, "comment"],
          ],
        },
      });

      // Intellisense Autocomplete Engine (LSP)
      monaco.languages.registerCompletionItemProvider("primix", {
        triggerCharacters: [".", " "],
        provideCompletionItems: (model: any, position: any) => {
          const suggestions: any[] = [
            {
              label: "port",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "port ${1:8080}",
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "Конфигурация ядра",
              documentation: "Задает сетевой TCP порт для прослушивания сокетов VM."
            },
            {
              label: "table",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "table ${1:users} (${2:id, name, status})",
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "Схема базы данных",
              documentation: "Создает индексированное декларативное in-memory или SQLite хранилище."
            },
            {
              label: "path",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'path /${1:endpoint} -> welcome "${2:pong}"',
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "REST API эндпоинт",
              documentation: "Создает HTTP GET точку входа для клиентов и мобильных APK."
            },
            {
              label: "block",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "block ${1:MyBlock} {\n\t$0\n}",
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "Область памяти",
              documentation: "Изолирует операции и переменные внутри безопасного замыкания."
            },
            {
              label: "match",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'match ${1:variable} -> case "${2:val}" -> ${3:action}',
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "Ветвление (Jump-Table)",
              documentation: "Быстрое бинарное ветвление, работающее на скорости O(1)."
            },
            {
              label: "bridge",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "bridge ${1:android_apk} -> ${2:http-post}",
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "Интеграционный мост",
              documentation: "Связывает виртуальный хост с внешними API, Android клиентами или веб-сервисами."
            },
            {
              label: "watch",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "watch ${1:variable} -> trigger ${2:action}",
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "Реактивный наблюдатель",
              documentation: "Следит за изменением реестра памяти и автоматически запускает действие trigger."
            },
            {
              label: "trigger",
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: "trigger ${1:MyEventHandler}",
              insertTextRules: monaco.languages.CompletionItemInsertRule.InsertAsSnippet,
              detail: "Вызвать событие",
              documentation: "Инициирует отправку данных или срабатывание хуков обратного вызова."
            }
          ];

          // Real-time Database schema dynamic autocomplete parsing inside the editor!
          const codeVal = model.getValue();
          const tableRegex = /table\s+([a-zA-Z_$][\w_$]*)\s*\(([^)]+)\)/g;
          let tableMatch;
          const userTables: Record<string, string[]> = {};
          
          while ((tableMatch = tableRegex.exec(codeVal)) !== null) {
            const tName = tableMatch[1];
            const tCols = tableMatch[2].split(",").map(c => c.trim());
            userTables[tName] = tCols;
          }

          const lineContent = model.getLineContent(position.lineNumber);
          const currentText = lineContent.substring(0, position.column - 1);
          const dotMatch = currentText.match(/([a-zA-Z_$][\w_$]*)\.$/);

          if (dotMatch) {
            const tableWord = dotMatch[1];
            if (userTables[tableWord]) {
              return {
                suggestions: userTables[tableWord].map(col => ({
                  label: col,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col,
                  detail: `Колонка b-дерева таблицы ${tableWord}`,
                  documentation: `Поле доступа к симулированным данным: ${tableWord}.${col}`
                }))
              };
            }
          }

          // Suggest evaluated database targets
          Object.keys(userTables).forEach(t => {
            suggestions.push({
              label: t,
              kind: monaco.languages.CompletionItemKind.Struct,
              insertText: t,
              detail: "Пользовательское хранилище данных (Table)",
              documentation: `Таблица со структурой колонок: ${userTables[t].join(", ")}`
            });
          });

          return { suggestions };
        }
      });

      // Hover Tooltip Documentation Engine (LSP simulated)
      monaco.languages.registerHoverProvider("primix", {
        provideHover: (model, position) => {
          const rWord = model.getWordAtPosition(position);
          if (!rWord) return null;

          const syntaxDocs: Record<string, string> = {
            port: "**Конфигурация ядра — Port**\n\n```text\nport [номер_порта]\n```\n\nУказывает сетевой порт TCP для прослушивания веб-сокетов и трансляции API запросов. Primix VM биндит сокет на локальный дебаг-сервер.",
            table: "**Инициализация Реляционной Базы Данных — Table**\n\n```text\ntable [имя] ([колонки...])\n```\n\nДекларативная абстракция СУБД. Автоматически компилирует схему SQLite/In-Memory таблицы с индексацией колонок без необходимости ручной сборки схем и разработки SQL-инъекционных boilerplate-запросов.",
            path: "**Маршрутизатор REST API — Path**\n\n```text\npath /маршрут -> welcome \"ответ\" \n```\n\nРегистрирует асинхронный веб-эндпоинт GET-запроса. Передает статическую или динамическую строку welcome-ответа клиентам, мобильному Android APK или веб-приложению.",
            block: "**Область изоляции (Scope) — Block**\n\n```text\nblock ИмяБлока {\n    переменная = \"значение\"\n}\n```\n\nСоздает строгое изолированное ядро памяти. Защищает контексты вычисления внутри фигурных скобок, предотвращая пересечения данных. Переменные внутри доступны через `ИмяБлока.имя`.",
            match: "**Интеллектуальное Ветвление — Match**\n\n```text\nmatch переменная -> case \"значение\" -> trigger событие\n```\n\nВысокоскоростная таблица переходов (Jump Table). Транслируется парсером компилятора в прямую выборку в памяти, что гарантирует работу за время O(1) и опережает обычные конструкции IF-ELSE.",
            bridge: "**Дополнительный шлюз — Bridge**\n\n```text\nbridge андроид_приложение -> websocket-rpc\n```\n\nИнтегрированный шлюз данных к внешней системе. Создает сквозную маршрутизацию сигналов, событий и REST логов на Android пакеты, десктопные C# приложения или веб-браузеры.",
            watch: "**Реактивный Инспектор Состояния — Watch**\n\n```text\nwatch имя_переменной -> trigger действие\n```\n\nКлючевая реактивная функция. Парсер навешивает наблюдатель на ячейку памяти. При перерасчете или замене значения переменной, реактивное ядро моментально выполняет вызов trigger."
          };

          const key = rWord.word.toLowerCase();
          if (syntaxDocs[key]) {
            return {
              contents: [{ value: syntaxDocs[key] }]
            };
          }
          return null;
        }
      });
    }

    const diagnostics = diagnosePrimixCode(activeFile.content);
    setLspDiagnostics(diagnostics);
  };

  // REST Emulator dispatch function
  const executeSimulatedRequest = () => {
    if (!vmState.isBooted) {
      showToastMsg("Сначала запустите Primix VM!", "info");
      return;
    }

    const routeObj = vmState.routes.find(r => r.path === selectedSimRoute);
    if (!routeObj) return;

    setSimResponse(null);

    // Dynamic latency calculation
    const delay = Math.floor(Math.random() * 20) + 5; 

    setTimeout(() => {
      setSimResponse({
        status: "200 OK — Success",
        data: routeObj.action,
        time: `${delay}ms`
      });

      // Append request execution logs into VM event stream
      setVmState(prev => ({
        ...prev,
        customLogs: [
          ...prev.customLogs,
          {
            timestamp: new Date().toLocaleTimeString(),
            type: "event" as const,
            message: `🌐 [REST API] GET запрос к ${selectedSimRoute} (ответ: "${routeObj.action}") в течение ${delay}ms`
          }
        ]
      }));

      // Append info to global terminal
      setTerminalLogs(prev => [
        ...prev,
        { text: `GET http://localhost:${vmState.port}${selectedSimRoute} -> 200 OK (${delay}ms)`, type: "output" }
      ]);
    }, 400);
  };

  // Database simulator adding new row handler
  const handleAddRow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vmState.isBooted) return;

    setVmState(prev => {
      const updatedTables = prev.tables.map(tbl => {
        if (tbl.name === selectedSimTable) {
          return {
            ...tbl,
            rows: [...tbl.rows, { ...newRowData }]
          };
        }
        return tbl;
      });

      const itemsStr = Object.entries(newRowData).map(([k, v]) => `${k}: "${v}"`).join(", ");

      return {
        ...prev,
        tables: updatedTables,
        customLogs: [
          ...prev.customLogs,
          {
            timestamp: new Date().toLocaleTimeString(),
            type: "success" as const,
            message: `💾 [DB INSERT] В таблицу '${selectedSimTable}' успешно занесено: { ${itemsStr} }`
          }
        ]
      };
    });

    setTerminalLogs(prev => [
      ...prev,
      { text: `INSERT INTO ${selectedSimTable} VALUES: Success! Row reflected in-memory.`, type: "output" }
    ]);

    // Clear form inputs
    const clearedForm: Record<string, string> = {};
    Object.keys(newRowData).forEach(k => {
      clearedForm[k] = "";
    });
    setNewRowData(clearedForm);
    setShowAddRowForm(false);
    showToastMsg("Запись добавлена в симулятор СУБД!");
  };

  // Modify simulated variable to trigger react watch
  const handleVariableChange = (varName: string, newValue: string) => {
    if (!vmState.isBooted) return;

    // Record the telemetry coordinate in real-time history for Recharts
    setWatchHistory(prev => {
      const currentVars = { ...latestVariablesRef.current, [varName]: newValue };
      const newPoint: Record<string, any> = {
        timestamp: new Date().toLocaleTimeString()
      };
      
      Object.entries(currentVars).forEach(([k, v]) => {
        const valStr = String(v);
        const parsedNum = parseFloat(valStr);
        if (!isNaN(parsedNum)) {
          newPoint[k] = parsedNum;
        } else {
          if (valStr === "Online" || valStr === "OK" || valStr === "ADMIN") {
            newPoint[k] = 1;
          } else if (valStr === "Offline" || valStr === "RESTRICTED") {
            newPoint[k] = 0;
          } else if (valStr === "BREACH") {
            newPoint[k] = -1;
          } else {
            newPoint[k] = 0;
          }
        }
      });

      const updated = [...prev, newPoint];
      if (updated.length > 30) {
        return updated.slice(updated.length - 30);
      }
      return updated;
    });

    setVmState(prev => {
      const updatedVars = { ...prev.variables, [varName]: newValue };
      
      // Look for custom watches
      const hitWatch = prev.watches.find(w => w.variable === varName);
      const isCpu = varName.includes("cpu_usage");
      
      const newLogs = [...prev.customLogs];
      newLogs.push({
        timestamp: new Date().toLocaleTimeString(),
        type: "info" as const,
        message: `📝 [MEMORY WRITE] Переменная '${varName}' перезаписана значением: "${newValue}"`
      });

      if (hitWatch) {
        newLogs.push({
          timestamp: new Date().toLocaleTimeString(),
          type: "warning" as const,
          message: `👁️ [WATCH TRIGGER] Наблюдатель обнаружил изменение! Срабатывает: '${hitWatch.action}'!`
        });
      }

      return {
        ...prev,
        variables: updatedVars,
        customLogs: newLogs
      };
    });

    // Check watch for terminal print
    const matchedWatch = vmState.watches.find(w => w.variable === varName);
    if (matchedWatch) {
      setTerminalLogs(prev => [
        ...prev,
        { text: `[PX WATCH] Reactive change: ${varName} => ${newValue}. Invoking: ${matchedWatch.action}`, type: "system" }
      ]);
    }
  };

  // Terminal manual command inputs handler
  const handleTerminalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = terminalCommand.trim().toLowerCase();
    if (!cmd) return;

    setTerminalLogs(prev => [...prev, { text: `user@primix-core:~$ ${terminalCommand}`, type: "input" }]);
    setTerminalCommand("");

    // Simulate simple command parser responses
    if (cmd === "help") {
      setTerminalLogs(prev => [
        ...prev,
        { text: "Доступные терминальные PX утилиты:", type: "output" },
        { text: "  help                  — Показать справочник консоли.", type: "output" },
        { text: "  clear                 — Очистить историю логов.", type: "output" },
        { text: "  diagnose              — Запустить статический компилятор-анализатор над файлом.", type: "output" },
        { text: "  px-run                — Запустить локальную VM-среду Primix.", type: "output" },
        { text: "  px-stop               — Остановить выполнение VM-среды.", type: "output" },
        { text: "  info-bridges          — Вывести список подключенных внешних мостов.", type: "output" },
        { text: "  info-db               — Вывести структуру таблиц БД.", type: "output" }
      ]);
    } else if (cmd === "clear") {
      setTerminalLogs([]);
    } else if (cmd === "diagnose") {
      const diags = diagnosePrimixCode(activeFile.content);
      if (diags.length === 0) {
        setTerminalLogs(prev => [...prev, { text: "🎉 Отличный результат! Статический компилятор PX не выявил синтаксических ошибок.", type: "output" }]);
      } else {
        setTerminalLogs(prev => [
          ...prev,
          { text: `⚠️ Найдено ошибок: ${diags.length}`, type: "error" },
          ...diags.map(d => ({ text: `  Line ${d.line}: ${d.message} [severity: ${d.severity}]`, type: "error" as const }))
        ]);
      }
    } else if (cmd === "px-run") {
      startDebuggerVM();
    } else if (cmd === "px-stop") {
      if (vmState.isBooted) {
        stopDebuggerVM();
      } else {
        setTerminalLogs(prev => [...prev, { text: "Интерпретатор VM еще не запущен.", type: "error" }]);
      }
    } else if (cmd === "info-bridges") {
      if (vmState.isBooted && vmState.bridges.length > 0) {
        setTerminalLogs(prev => [
          ...prev,
          { text: "Список подключенных API Bridges:", type: "output" },
          ...vmState.bridges.map(b => ({ text: `  Мост: ${b.client} -> Протокол: ${b.protocol}`, type: "output" as const }))
        ]);
      } else {
        setTerminalLogs(prev => [...prev, { text: "Нет активных шлюзов (запустите VM для инициализации).", type: "error" }]);
      }
    } else if (cmd === "info-db") {
      if (vmState.isBooted && vmState.tables.length > 0) {
        setTerminalLogs(prev => [
          ...prev,
          { text: `Активные таблицы СУБД (${vmState.tables.length}):`, type: "output" },
          ...vmState.tables.map(t => ({ text: `  Таблица '${t.name}' (колонки: ${t.columns.join(", ")}) — Записей: ${t.rows.length}`, type: "output" as const }))
        ]);
      } else {
        setTerminalLogs(prev => [...prev, { text: "База данных выключена или пуста (запустите VM).", type: "error" }]);
      }
    } else {
      setTerminalLogs(prev => [...prev, { text: `Ошибка: px-команда '${cmd}' незарегистрирована. Введите 'help'`, type: "error" }]);
    }
  };

  // Chat with Gemini via our express proxy router
  const sendMessageToGemini = async (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      role: "user",
      text,
      timestamp: new Date().toLocaleTimeString()
    };

    setChatMessages(prev => [...prev, userMsg]);
    setUserInput("");
    setIsAiLoading(true);

    try {
      // Build system format payload mapping
      const historyPayload = chatMessages
        .filter(m => m.id !== "welcome") // skip fake greeting to avoid bloating history
        .map(m => ({
          role: m.role,
          text: m.text
        }));

      // Append file contents so Gemini understands current file state Context in Russian
      const updatedPrompt = `Контекст: Пользователь работает с файлом "${activeFile.name}" на платформе "${activeFile.platform}".
Текущее содержание в редакторе:
\`\`\`text
${activeFile.content}
\`\`\`

Сообщение пользователя: ${text}`;

      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: updatedPrompt,
          history: historyPayload
        })
      });

      const data = await response.json();

      if (data.error) {
        setChatMessages(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            role: "model",
            text: `💥 Ошибка компилятора ИИ: ${data.error}. Сообщение: ${data.text || ""}`,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
      } else {
        setChatMessages(prev => [
          ...prev,
          {
            id: Math.random().toString(),
            role: "model",
            text: data.text,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
      }
    } catch (e: any) {
      console.error(e);
      setChatMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          role: "model",
          text: "💥 Ошибка сети: не удалось связаться с сервером Gemini API. Убедитесь в активности сервера и наличии Интернет-соединения.",
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Helper trigger to handle instant AI queries
  const triggerCommandAI = (cmdType: "explain" | "fix" | "android" | "desktop" | "deploy") => {
    let text = "";
    if (cmdType === "explain") {
      text = `Пожалуйста, подробно объясни логику моего Primix (PX) кода в активном файле "${activeFile.name}". Опиши назначение объявленных таблиц, API эндпоинтов и реактивных вызовов watch.`;
    } else if (cmdType === "fix") {
      text = `Проверь код в моем файле на наличие логических уязвимостей, конфликтов или синтаксических ошибок. Если найдешь баги, исправь их и предоставь чистый оптимизированный Primix код.`;
    } else if (cmdType === "android") {
      text = `Сгенерируй полноценный код на языке Kotlin для интеграции Android APK приложения с текущей системой через Primix протокол API. Покажи как выполнять HTTP POST вызов моста bridge, отправлять транзакции в таблицы и обрабатывать события.`;
    } else if (cmdType === "desktop") {
      text = `Сгенерируй код на языке C# (или Python) для десктопного решения, оптимизированный под текущий запущенный шаблон (${activeFile.platform}). Настрой отправку сокетов к порту ${vmState.port || 8080}.`;
    } else if (cmdType === "deploy") {
      text = `Объясни, как развернуть и запустить мой готовый .pmx сервер на реальных продакшн серверах, используя созданный файл launch_server.js и менеджер процессов PM2. Предоставь подробную пошаговую инструкцию по сборке и автоматическому перезапуску.`;
    }

    setTerminalLogs(prev => [
      ...prev,
      { text: `[PX COPILOT] Sent command request to AI helper: ${cmdType}`, type: "system" }
    ]);
    sendMessageToGemini(text);
  };

  // Select platform file and load it in active editor
  const handleSelectFile = (file: ProjectFile) => {
    setActiveFilePath(file.path);
    setTerminalLogs(prev => [
      ...prev,
      { text: `Loaded file: /${file.name} for platform: ${file.platform.toUpperCase()}`, type: "system" }
    ]);
  };

  // Helper to copy file contents to clipboard
  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeFile.content);
    showToastMsg("Код скопирован в буфер обмена!");
  };

  return (
    <div className="flex flex-col h-screen select-none select-text text-sm bg-[#1e1e1e] text-[#cccccc]">
      {/* Dynamic Pop Toast Notification (Apple style) */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-2.5 bg-neutral-900/95 backdrop-blur border border-white/10 shadow-2xl shadow-black/80 text-gray-100 px-4 py-3 rounded-2xl text-[11px] font-semibold animate-pulse">
          <span className="h-2 w-2 rounded-full bg-[#34c759] animate-pulse"></span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Cupertino Window Control Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#1c1c1e] border-b border-white/5 text-xs h-12 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center p-1.5 rounded-lg bg-white/5 border border-white/5">
            <Cpu className="h-4 w-4 text-[#0071e3]" />
          </div>
          <div>
            <h1 className="text-xs font-semibold tracking-tight text-gray-300 flex items-center gap-3">
              <span className="font-bold text-gray-100 font-sans tracking-wide">Primix Native IDE</span>
              <span className="h-3 w-px bg-white/10"></span>
              <span className="text-gray-400 font-normal">Файл</span>
              <span className="text-gray-400 font-normal">Правка</span>
              <span className="text-gray-400 font-normal">Сборка</span>
              <span className="text-gray-400 font-normal font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded-full border border-white/5 text-blue-400">LSP Active</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5 text-gray-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[#34c759] animate-pulse"></span>
            <span className="font-mono text-[10px]">LSP: Live</span>
          </div>

          {/* Cloud Sync Status */}
          <div className="flex items-center gap-2.5 border-l border-white/5 pl-4 shrink-0">
            {isCloudSyncing ? (
              <div className="flex items-center gap-1.5 text-blue-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span className="font-sans text-[10px] font-bold">Облако: Синхронизация...</span>
              </div>
            ) : user ? (
              <div className="flex items-center gap-1.5 text-[#34c759]" title={`В сети как: ${user.email || 'Анонимный аккаунт'}`}>
                <Cloud className="h-3.5 w-3.5 text-[#34c759]" />
                <span className="font-sans text-[10px] font-bold">Облако: Активно</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-yellow-500/80">
                <CloudOff className="h-3.5 w-3.5" />
                <span className="font-sans text-[10px] font-bold">Облако: Офлайн</span>
              </div>
            )}
          </div>

          {/* Core Auth Controls */}
          <div className="flex items-center gap-2 border-l border-white/5 pl-4 shrink-0">
            {isAuthLoading ? (
              <span className="text-gray-500 text-[10px]">Инициализация...</span>
            ) : user ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-white/5 px-2.5 py-1 rounded-full text-blue-400 border border-white/5 font-bold font-mono">
                  🔑 {user.isAnonymous ? "Гость" : (user.email?.split("@")[0] || "Пользователь")}
                </span>
                <button
                  onClick={async () => {
                    await signOut(auth);
                    showToastMsg("Вы успешно вышли из облачного профиля");
                  }}
                  title="Выйти из аккаунта"
                  className="p-1.5 hover:bg-rose-500/10 hover:text-rose-400 text-gray-400 rounded-full transition-all active:scale-90"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={async () => {
                    try {
                      await signInAnonymously(auth);
                      showToastMsg("Вход гостя выполнен! Безопасное облачное автосохранение активно.", "success");
                    } catch (e: any) {
                      showToastMsg("Ошибка: " + e.message, "info");
                    }
                  }}
                  className="px-2.5 py-1 bg-[#34c759] hover:bg-[#30b552] duration-150 active:scale-95 text-white rounded-full text-[10px] font-bold flex items-center gap-1"
                >
                  <LogIn className="h-3 w-3" /> Войти Гостем
                </button>
                <button
                  onClick={async () => {
                    try {
                      await signInWithPopup(auth, googleProvider);
                      showToastMsg("Вход через Google выполнен!", "success");
                    } catch (e: any) {
                      showToastMsg("Google вход не завершен", "info");
                    }
                  }}
                  className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/5 duration-150 active:scale-95 text-gray-200 rounded-full text-[10px] font-bold flex items-center gap-1"
                >
                  Google
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Full Body Section */}
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Rail Tabs Panel (Cupertino Left Dock Style) */}
        <div className="flex flex-col justify-between items-center w-14 bg-[#161617] border-r border-white/5 py-3.5 h-full shrink-0 select-none">
          <div className="flex flex-col items-center gap-3.5 w-full">
            {/* Apple Window Control Dots */}
            <div className="flex gap-1 mb-2.5">
              <span className="w-2 h-2 rounded-full bg-[#ff5f56]"></span>
              <span className="w-2 h-2 rounded-full bg-[#ffbd2e]"></span>
              <span className="w-2 h-2 rounded-full bg-[#27c93f]"></span>
            </div>

            {/* Explorer Menu */}
            <button
              onClick={() => setActiveTab("explorer")}
              title="Папка с быстрыми файлами"
              className={`p-2 rounded-xl transition-all duration-150 active:scale-90 relative ${
                activeTab === "explorer"
                  ? "text-white bg-[#0071e3] shadow-md shadow-[#0071e3]/20"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              <Layers className="h-5 w-5" />
            </button>

            {/* AI Helper Menu */}
            <button
              onClick={() => setActiveTab("api")}
              title="ИИ-ассистент Gemini"
              className={`p-2 rounded-xl transition-all duration-150 active:scale-90 relative ${
                activeTab === "api"
                  ? "text-white bg-[#af52de] shadow-md shadow-[#af52de]/20"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              <Bot className="h-5 w-5" />
              <span className="absolute top-1 right-1 h-2 w-2 bg-[#ff3b30] rounded-full border border-[#161617] animate-pulse"></span>
            </button>

            {/* VM Debugger */}
            <button
              onClick={() => setActiveTab("debugger")}
              title="Отладочный полигон VM"
              className={`p-2 rounded-xl transition-all duration-150 active:scale-90 relative ${
                activeTab === "debugger"
                  ? "text-white bg-[#34c759] shadow-md shadow-[#34c759]/20"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              <Activity className="h-5 w-5" />
            </button>

            {/* Language Docs */}
            <button
              onClick={() => setActiveTab("docs")}
              title="Справочник синтаксиса PX"
              className={`p-2 rounded-xl transition-all duration-150 active:scale-90 relative ${
                activeTab === "docs"
                  ? "text-white bg-[#ff9500] shadow-md shadow-[#ff9500]/20"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              <BookOpen className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-col items-center w-full">
            <button
              onClick={() => triggerCommandAI("explain")}
              title="Инста-документирование ИИ"
              className="p-2 text-gray-400 hover:text-white transition-all hover:bg-white/5 rounded-xl active:scale-90"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Selected Tab Sidebar Content Panel (VS Code Style Left Column) */}
        <div className="w-72 bg-[#252526] border-r border-[#111111] flex flex-col h-full overflow-y-auto shrink-0 select-none">
          {/* TAB: EXPLORER / 5 FAST START TEMPLATES */}
          {activeTab === "explorer" && (
            <div className="p-4 flex flex-col h-full">
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
                <span className="text-[11px] uppercase tracking-wider font-bold text-gray-400 flex items-center gap-1.5 font-sans">
                  <Layers className="h-4 w-4 text-blue-500" /> ПРОЕКТНЫЕ КАРКАСЫ
                </span>
                <span className="text-[10px] bg-white/5 text-gray-350 border border-white/5 px-2 py-0.5 rounded-full font-mono font-medium">
                  {files.length} шабл.
                </span>
              </div>

              <p className="text-[11px] text-gray-400 mb-4 leading-relaxed font-sans">
                Выберите платформенный API-скрипт, вспомогательный мобильный HTML или файл автозапуска сервера:
              </p>

              {/* List of Cupertino Apple-style buttons */}
              <div className="flex flex-col gap-2 flex-1 overflow-y-auto pr-1">
                {files.map(file => (
                  <button
                    key={file.path}
                    onClick={() => handleSelectFile(file)}
                    className={`flex items-start gap-3 p-3 rounded-xl text-left transition-all duration-150 border ${
                      activeFilePath === file.path
                        ? "bg-[#0071e3]/10 border-[#0071e3]/40 shadow-sm shadow-black/10"
                        : "bg-white/5 border-transparent hover:bg-white/8 hover:border-white/5"
                    } active:scale-[0.98]`}
                  >
                    <div className="mt-0.5 p-1 bg-white/5 rounded-lg shrink-0">
                      {file.platform === "win7" && <FileCode className="h-3.5 w-3.5 text-sky-400" />}
                      {file.platform === "win10_11" && <Code className="h-3.5 w-3.5 text-blue-400" />}
                      {file.platform === "linux" && <Terminal className="h-3.5 w-3.5 text-emerald-400" />}
                      {file.platform === "macos" && <Layers className="h-3.5 w-3.5 text-[#ff5f56]" />}
                      {file.platform === "universal" && <Smartphone className="h-3.5 w-3.5 text-purple-400" />}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-bold ${activeFilePath === file.path ? "text-[#2f80ed]" : "text-gray-200"}`}>
                          {file.name}
                        </span>
                        <span className="text-[8px] uppercase font-mono border px-1.5 py-0.2 rounded-full text-gray-400 border-white/5 bg-white/5">
                          {file.platform === "custom" ? "prod" : file.platform}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500 truncate mt-0.5 font-sans">
                        {file.name.endsWith(".bat") && "Скрипт запуска Windows 7 (.bat)"}
                        {file.name.endsWith(".ps1") && "Скрипт запуска Windows 10/11 (.ps1)"}
                        {file.name.endsWith(".html") && "iOS / Android мобильный WebView"}
                        {file.name.endsWith(".js") && "Запуск сервера .pmx (Node.js)"}
                        {file.platform === "win7" && !file.name.endsWith(".bat") && "Winsock v2, SQLite, classic API"}
                        {file.platform === "win10_11" && !file.name.endsWith(".ps1") && "TLS 1.3, Async I/O, Telemetries"}
                        {file.platform === "linux" && "Daemon systemd, UNIX Socket pipe"}
                        {file.platform === "macos" && "Sandboxed core dispatch, secure"}
                        {file.platform === "universal" && !file.name.endsWith(".html") && "Docker, WebSocket sync, HTML5 view"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Diagnostics summaries */}
              <div className="border-t border-slate-800 pt-4 mt-4">
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-2 mb-2">
                  🛡️ РЕЗУЛЬТАТЫ СТАТИЧЕСКОГО LSP
                </span>
                {lspDiagnostics.length === 0 ? (
                  <div className="bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 p-2.5 rounded text-[11px] flex gap-2 items-center">
                    <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Синтаксических дефектов не обнаружено.</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
                    {lspDiagnostics.map((diag, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded text-[10px] border flex gap-1.5 items-start ${
                          diag.severity === "error"
                            ? "bg-rose-950/20 border-rose-500/30 text-rose-300"
                            : "bg-amber-950/20 border-amber-500/30 text-amber-300"
                        }`}
                      >
                        <span className="font-mono mt-0.5 bg-slate-900 px-1 py-0.2 rounded shrink-0">
                          L{diag.line}
                        </span>
                        <span>{diag.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: GEMINI COPILOT CHAT PANEL */}
          {activeTab === "api" && (
            <div className="p-4 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 flex items-center gap-2">
                  <Bot className="h-4 w-4 text-purple-400" /> ИИ-ПОМОЩНИК CO-PILOT
                </span>
                <span className="text-[10px] bg-slate-800 text-purple-400 border border-purple-950 px-1.5 py-0.5 rounded font-mono">
                  Gemini API
                </span>
              </div>

              {/* Prompt Quick Actions - Cupertino Pills Layout */}
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                <button
                  onClick={() => triggerCommandAI("explain")}
                  className="p-2 text-[10px] font-semibold bg-white/5 hover:bg-white/10 active:scale-95 text-gray-200 rounded-xl border border-white/5 transition-all text-left truncate flex items-center gap-1.5"
                >
                  <BookOpen className="h-3 w-3 text-blue-400 animate-pulse" /> Объяснить код
                </button>
                <button
                  onClick={() => triggerCommandAI("fix")}
                  className="p-2 text-[10px] font-semibold bg-white/5 hover:bg-white/10 active:scale-95 text-gray-200 rounded-xl border border-white/5 transition-all text-left truncate flex items-center gap-1.5"
                >
                  <Cpu className="h-3 w-3 text-emerald-400" /> Исправить баги
                </button>
                <button
                  onClick={() => triggerCommandAI("android")}
                  className="p-2 text-[10px] font-semibold bg-white/5 hover:bg-white/10 active:scale-95 text-gray-200 rounded-xl border border-white/5 transition-all text-left truncate flex items-center gap-1.5"
                >
                  <Smartphone className="h-3 w-3 text-purple-400" /> Android Kotlin
                </button>
                <button
                  onClick={() => triggerCommandAI("desktop")}
                  className="p-2 text-[10px] font-semibold bg-white/5 hover:bg-white/10 active:scale-95 text-gray-200 rounded-xl border border-white/5 transition-all text-left truncate flex items-center gap-1.5"
                >
                  <Layers className="h-3 w-3 text-gray-300" /> Desktop C#
                </button>
                <button
                  onClick={() => triggerCommandAI("deploy")}
                  className="col-span-2 p-2 text-[10px] font-bold bg-[#0071e3] hover:bg-[#147ce5] active:scale-95 text-white rounded-xl shadow-md transition-all text-center justify-center flex items-center gap-2"
                >
                  <Sparkles className="h-3 w-3" /> Запуск и Деплой на Сервер
                </button>
              </div>

              {/* Chat conversations boxes */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3 scrollbar">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-lg text-xs leading-relaxed max-w-[90%] break-words ${
                      msg.role === "user"
                        ? "bg-slate-800/80 text-slate-200 border border-slate-700 ml-auto"
                        : "bg-slate-900 text-slate-300 border border-purple-950/40 mr-auto"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 opacity-60 text-[9px] mb-1 font-mono tracking-wider">
                      {msg.role === "user" ? (
                        <span className="text-slate-400">ВЫ (PX DEV)</span>
                      ) : (
                        <span className="text-purple-400 font-bold flex items-center gap-0.5">
                          <Bot className="h-2.5 w-2.5 text-purple-400" /> GEMINI 3.5
                        </span>
                      )}
                      <span>•</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    {/* Preserve line breaks for code outputs */}
                    <div className="whitespace-pre-wrap font-sans font-normal selection:bg-purple-950">
                      {msg.text}
                    </div>
                  </div>
                ))}

                {isAiLoading && (
                  <div className="bg-slate-900 border border-purple-950/40 p-2.5 rounded-lg text-xs text-slate-400 animate-pulse flex items-center gap-2">
                    <RefreshCw className="h-3 w-3 text-purple-400 animate-spin" />
                    <span>Аннигиляция токенов... Думаю над Primix PX...</span>
                  </div>
                )}
              </div>

              {/* Chat Input form box */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  sendMessageToGemini(userInput);
                }}
                className="flex items-center gap-1.5 border border-white/5 p-1.5 rounded-xl bg-white/5 focus-within:border-[#bf5af2]/50 transition-all"
              >
                <input
                  type="text"
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  placeholder="Задать вопрос о Primix..."
                  className="bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none flex-1 px-1.5 py-1 font-sans"
                />
                <button
                  type="submit"
                  disabled={!userInput.trim() || isAiLoading}
                  className="p-1.5 px-2 bg-[#0071e3] hover:bg-[#147ce5] disabled:opacity-30 disabled:bg-white/5 text-white rounded-lg transition-all active:scale-90"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          )}

          {/* TAB: VIRTUAL RUNTIME WORKSPACE EMULATOR & DEBUGGER */}
          {activeTab === "debugger" && (
            <div className="p-4 flex flex-col h-full space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-400" /> ПОЛИГОН PX VM
                </span>
                <span className="text-[10px] bg-slate-800 text-emerald-400 border border-emerald-950 px-1.5 py-0.5 rounded font-mono">
                  СУБД & REST
                </span>
              </div>

              {/* Power State VM buttons */}
              <div className="flex items-center gap-2 select-none">
                {!vmState.isBooted ? (
                  <button
                    onClick={startDebuggerVM}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#34c759] hover:bg-[#30b552] text-white text-xs font-bold rounded-xl shadow-sm tracking-tight transition-all active:scale-[0.97] duration-150"
                  >
                    <Play className="h-4 w-4" /> Запустить Primix VM
                  </button>
                ) : (
                  <button
                    onClick={stopDebuggerVM}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#ff3b30] hover:bg-[#e03126] text-white text-xs font-bold rounded-xl shadow-sm tracking-tight transition-all active:scale-[0.97] duration-150"
                  >
                    <Square className="h-4 w-4 animate-pulse" /> Остановить VM
                  </button>
                )}
              </div>

              {/* VM Status overview */}
              <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg text-xs space-y-1.5 shadow-inner">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Система:</span>
                  <span className={`font-mono font-bold ${vmState.isBooted ? "text-emerald-400" : "text-rose-500"}`}>
                    {vmState.isBooted ? "● ONLINE" : "■ OFFLINE"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Службы сокета:</span>
                  <span className="font-mono text-slate-300">
                    {vmState.isBooted ? `0.0.0.0:${vmState.port}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Платформа:</span>
                  <span className="bg-slate-800 text-[10px] text-cyan-400 px-1.5 rounded-sm uppercase font-mono tracking-wider">
                    {activeFile.platform}
                  </span>
                </div>
              </div>

              {vmState.isBooted ? (
                <>
                  {/* Debugger Sub-Tabs Selectors */}
                  <div className="flex gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      onClick={() => setDebuggerSubTab("controls")}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 ${
                        debuggerSubTab === "controls"
                          ? "bg-slate-800/80 text-white shadow border border-white/5"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      🎛️ Интеракторы
                    </button>
                    <button
                      onClick={() => setDebuggerSubTab("chart")}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 ${
                        debuggerSubTab === "chart"
                          ? "bg-slate-800/80 text-white shadow border border-white/5"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-400 animate-pulse" /> Живой График
                    </button>
                  </div>

                  {debuggerSubTab === "controls" ? (
                    <>
                      {/* Database Emulator sub section */}
                      <div className="border border-slate-800/80 p-3 rounded-lg bg-slate-900/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                            <Database className="h-3.5 w-3.5 text-cyan-400" /> Имитатор СУБД (Relational)
                          </span>
                          {vmState.tables.length > 0 && (
                            <button
                              onClick={() => setShowAddRowForm(!showAddRowForm)}
                              className="p-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 text-[10px] flex items-center gap-1"
                            >
                              <Plus className="h-2.5 w-2.5 text-cyan-400" /> Добавить
                            </button>
                          )}
                        </div>

                        {vmState.tables.length === 0 ? (
                          <p className="text-[10px] text-slate-500 italic">Таблицы базы данных не обнаружены в скрипте.</p>
                        ) : (
                          <div className="space-y-3">
                            {/* Table Selector */}
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500">Выбор таблицы:</span>
                              <select
                                value={selectedSimTable}
                                onChange={e => {
                                  setSelectedSimTable(e.target.value);
                                  const tbl = vmState.tables.find(t => t.name === e.target.value);
                                  if (tbl) {
                                    const form: Record<string, string> = {};
                                    tbl.columns.forEach(col => {
                                      form[col] = "";
                                    });
                                    setNewRowData(form);
                                  }
                                }}
                                className="bg-slate-950 text-[11px] text-slate-300 py-1 px-1.5 rounded border border-slate-800 focus:outline-none flex-1"
                              >
                                {vmState.tables.map(t => (
                                  <option key={t.name} value={t.name}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Inline Data Entry Form */}
                            {showAddRowForm && (
                              <form onSubmit={handleAddRow} className="bg-slate-950 p-2.5 rounded border border-slate-800 space-y-2">
                                <span className="text-[10px] uppercase font-semibold text-cyan-400 tracking-wider">Новый кортеж в {selectedSimTable}</span>
                                <div className="space-y-1.5">
                                  {Object.keys(newRowData).map(col => (
                                    <div key={col} className="flex items-center gap-1.5 justify-between">
                                      <span className="text-[10px] text-slate-500 truncate font-mono max-w-24">{col}:</span>
                                      <input
                                        type="text"
                                        required
                                        value={newRowData[col]}
                                        onChange={e => setNewRowData(prev => ({ ...prev, [col]: e.target.value }))}
                                        placeholder={`значение`}
                                        className="bg-slate-900 border border-slate-800 focus:outline-none text-[11px] px-1.5 py-0.5 rounded text-slate-300 w-36"
                                      />
                                    </div>
                                  ))}
                                </div>
                                <div className="flex gap-2 justify-end pt-1">
                                  <button
                                    type="button"
                                    onClick={() => setShowAddRowForm(false)}
                                    className="px-2 py-0.5 text-[9px] bg-slate-800 text-slate-400 rounded hover:bg-slate-700"
                                  >
                                    Отмена
                                  </button>
                                  <button
                                    type="submit"
                                    className="px-2 py-0.5 text-[9px] bg-gradient-to-tr from-cyan-600 to-purple-600 text-white rounded font-medium"
                                  >
                                    Вставить
                                  </button>
                                </div>
                              </form>
                            )}

                            {/* Computed Table Matrix */}
                            {(() => {
                              const currentTbl = vmState.tables.find(t => t.name === selectedSimTable);
                              if (!currentTbl) return null;
                              return (
                                <div className="overflow-x-auto border border-slate-800 rounded bg-slate-950/40">
                                  <table className="w-full text-left text-[10px] font-mono border-collapse">
                                    <thead>
                                      <tr className="bg-slate-900/80 border-b border-slate-850">
                                        {currentTbl.columns.map(c => (
                                          <th key={c} className="p-1.5 px-2 text-slate-500 uppercase">{c}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {currentTbl.rows.length === 0 ? (
                                        <tr>
                                          <td colSpan={currentTbl.columns.length} className="p-2 text-center text-slate-600 italic">
                                            Таблица пуста.
                                          </td>
                                        </tr>
                                      ) : (
                                        currentTbl.rows.map((row, rIdx) => (
                                          <tr key={rIdx} className="border-b border-slate-900 hover:bg-slate-900/30">
                                            {currentTbl.columns.map(col => (
                                              <td key={col} className="p-1.5 px-2 text-slate-300 truncate max-w-28">
                                                {row[col] || "NULL"}
                                              </td>
                                            ))}
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      {/* API API REST Client sub section */}
                      <div className="border border-slate-800/80 p-3 rounded-lg bg-slate-900/40 space-y-2">
                        <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                          <Network className="h-3.5 w-3.5 text-purple-400" /> Имитатор API Клиента REST
                        </span>

                        {vmState.routes.length === 0 ? (
                          <p className="text-[10px] text-slate-500 italic">Веб-маршруты не определены в скрипте.</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex gap-1.5">
                              <select
                                value={selectedSimRoute}
                                onChange={e => {
                                  setSelectedSimRoute(e.target.value);
                                  setSimResponse(null);
                                }}
                                className="bg-slate-950 text-[11px] text-slate-300 py-1.5 px-1 rounded border border-slate-850 focus:outline-none flex-1 font-mono"
                              >
                                {vmState.routes.map(r => (
                                  <option key={r.path} value={r.path}>
                                    GET {r.path}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={executeSimulatedRequest}
                                className="p-1.5 px-3 bg-gradient-to-r from-purple-600 to-cyan-600 text-white rounded text-[11px] font-semibold active:opacity-90 transition flex items-center gap-1"
                              >
                                <Send className="h-3.5 w-3.5" /> Запрос
                              </button>
                            </div>

                            {/* HTTP Output Visualizer Card */}
                            {simResponse && (
                              <div className="bg-slate-950 border border-slate-850 p-2.5 rounded space-y-1.5">
                                <div className="flex items-center justify-between text-[9px] font-mono border-b border-slate-900 pb-1">
                                  <span className="text-emerald-400 font-bold">{simResponse.status}</span>
                                  <span className="text-slate-500">Время: {simResponse.time}</span>
                                </div>
                                <div className="text-[10px] text-slate-300 font-mono break-all py-1">
                                  {/* If welcome message starts with brace, render inside pre tag */}
                                  {simResponse.data.startsWith("{") ? (
                                    <pre className="font-mono text-[9px] text-slate-400 leading-tight bg-slate-900/50 p-1.5 rounded overflow-x-auto">
                                      {simResponse.data}
                                    </pre>
                                  ) : (
                                    <span>"{simResponse.data}"</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Memory registers / variables sliders list */}
                      {Object.keys(vmState.variables).length > 0 && (
                        <div className="border border-slate-800/80 p-3 rounded-lg bg-slate-900/40 space-y-2">
                          <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                            <Activity className="h-3.5 w-3.5 text-amber-500 animate-pulse" /> Реестры Реактивности и Свойств
                          </span>
                          <p className="text-[10px] text-slate-500 leading-snug">
                            Изменяйте сигнальные переменные ползунками для симуляции реактивных зависимостей (watch):
                          </p>

                          <div className="space-y-2 w-full pt-1">
                            {(Object.entries(vmState.variables) as [string, string][]).map(([vName, vVal]) => {
                              const isNumeric = !isNaN(parseFloat(vVal));
                              return (
                                <div key={vName} className="p-2 rounded bg-slate-950/60 border border-slate-850/50 space-y-1">
                                  <div className="flex justify-between items-center text-[10px] font-mono">
                                    <span className="text-slate-400">{vName}</span>
                                    <span className={`font-bold ${isNumeric ? "text-cyan-400" : "text-amber-400"}`}>
                                      {vVal}
                                    </span>
                                  </div>
                                  {isNumeric ? (
                                    <input
                                      type="range"
                                      min="0"
                                      max="150"
                                      value={parseFloat(vVal)}
                                      onChange={e => handleVariableChange(vName, e.target.value)}
                                      className="w-full accent-cyan-500 scale-95 origin-left"
                                    />
                                  ) : (
                                    <div className="flex gap-1 pt-0.5">
                                      {["Online", "Offline", "RESTRICTED", "BREACH", "OK", "ADMIN", "CLIENT"].includes(vVal) ? (
                                        <>
                                          {vVal === "Online" || vVal === "Offline" ? (
                                            ["Online", "Offline"].map(opt => (
                                              <button
                                                key={opt}
                                                onClick={() => handleVariableChange(vName, opt)}
                                                className={`px-1.5 py-0.5 rounded text-[8px] border font-semibold ${
                                                  vVal === opt
                                                    ? "bg-cyan-500/10 border-cyan-450 text-cyan-200"
                                                    : "bg-slate-900 border-slate-800 text-slate-500"
                                                }`}
                                              >
                                                {opt}
                                              </button>
                                            ))
                                          ) : ["RESTRICTED", "BREACH", "OK", "ADMIN", "CLIENT"].includes(vVal) ? (
                                            ["OK", "BREACH", "RESTRICTED", "ADMIN", "CLIENT"].map(opt => (
                                              <button
                                                key={opt}
                                                onClick={() => handleVariableChange(vName, opt)}
                                                className={`px-1 py-0.5 rounded text-[8px] border font-semibold ${
                                                  vVal === opt
                                                    ? "bg-purple-500/10 border-purple-450 text-purple-200"
                                                    : "bg-slate-900 border-slate-800 text-slate-500"
                                                }`}
                                              >
                                                {opt}
                                              </button>
                                            ))
                                          ) : null}
                                        </>
                                      ) : (
                                        <input
                                          type="text"
                                          value={vVal}
                                          onChange={e => handleVariableChange(vName, e.target.value)}
                                          className="bg-slate-900 border border-slate-800 text-[10px] px-1 py-0.5 focus:outline-none rounded text-slate-300 w-full font-mono"
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Living Visual Recharts Chart Tab Content */
                    <div className="border border-slate-800/80 p-4 rounded-xl bg-slate-900/40 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                            <TrendingUp className="h-4 w-4 text-emerald-400 animate-pulse" /> Наблюдение в реальном времени
                          </span>
                          <span className="text-[10px] text-slate-500 mt-0.5">Линейный график флуктуаций значений</span>
                        </div>
                        
                        {/* Toggle Telemetry Stream */}
                        <button
                          onClick={() => setIsLiveTelemetryEmulation(!isLiveTelemetryEmulation)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 shadow transition-all duration-150 active:scale-95 ${
                            isLiveTelemetryEmulation
                              ? "bg-[#34c759] text-white animate-pulse"
                              : "bg-[#2c2c2e] text-slate-400 hover:text-slate-200 border border-white/5"
                          }`}
                        >
                          {isLiveTelemetryEmulation ? (
                            <>
                              <span className="h-2 w-2 rounded-full bg-white animate-ping"></span>
                              Стоп Стример
                            </>
                          ) : (
                            <>
                              <Play className="h-2.5 w-2.5" />
                              Старт Стример
                            </>
                          )}
                        </button>
                      </div>

                      {/* Dynamic chart canvas using Recharts */}
                      <div className="h-56 w-full bg-[#09090b] rounded-xl border border-slate-850/80 p-2 pt-4 flex flex-col items-center justify-center relative select-none">
                        {watchHistory.length < 2 && (
                          <div className="absolute inset-0 bg-[#09090b]/95 rounded-xl flex flex-col items-center justify-center text-center p-4 z-10 border border-slate-850/80">
                            <RefreshCw className="h-6 w-6 text-emerald-400 animate-spin mb-1.5" />
                            <span className="text-[10px] text-slate-400 font-bold">Ожидание данных телеметрии...</span>
                            <span className="text-[9px] text-slate-500 mt-0.5">Измените переменные или включите стример</span>
                          </div>
                        )}
                        
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={watchHistory} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                            <XAxis 
                              dataKey="timestamp" 
                              stroke="rgba(255,255,255,0.25)" 
                              fontSize={8} 
                              tickLine={false} 
                            />
                            <YAxis 
                              stroke="rgba(255,255,255,0.25)" 
                              fontSize={8} 
                              tickLine={false}
                              domain={['auto', 'auto']}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#0d0d0d",
                                borderColor: "rgba(255,255,255,0.1)",
                                borderRadius: "8px",
                                fontSize: "10px",
                                color: "#e2e8f0"
                              }}
                            />
                            <Legend 
                              verticalAlign="bottom" 
                              height={20} 
                              iconSize={7}
                              iconType="circle"
                              wrapperStyle={{ fontSize: '9px', color: '#94a3b8', paddingTop: 10 }}
                            />
                            {(() => {
                              // Extract numeric variables
                              const numericVarNames = Object.entries(vmState.variables)
                                .filter(([k, v]) => !isNaN(parseFloat(v as string)))
                                .map(([k]) => k);
                                
                              const lineColors = ["#34c759", "#00a2ff", "#ff9500", "#af52de", "#ff2d55", "#ffcc00"];
                              return numericVarNames.map((varName, idx) => (
                                <Line
                                  key={varName}
                                  type="monotone"
                                  dataKey={varName}
                                  stroke={lineColors[idx % lineColors.length]}
                                  strokeWidth={2}
                                  dot={{ r: 1.5, strokeWidth: 1 }}
                                  activeDot={{ r: 4 }}
                                  name={varName}
                                  animationDuration={200}
                                />
                              ));
                            })()}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="p-3 bg-slate-950/70 border border-slate-850 rounded-lg text-[10px] text-slate-400 leading-relaxed font-sans">
                        <p className="font-semibold text-slate-300 mb-1">💡 Как это работает:</p>
                        Каждая сигнальная PMX-переменная (например, <span className="font-mono text-cyan-400">cpu_usage</span>) отслеживается в реальном времени. Включение <span className="text-emerald-500 font-bold">Стримера</span> симулирует непрерывную нагрузку и строит график флуктуации watch-триггеров.
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 py-8 border border-slate-850 rounded-lg bg-slate-900/10">
                  <Cpu className="h-10 w-10 text-slate-600 mb-2 animate-bounce" />
                  <span className="font-semibold text-slate-400 text-xs">VM Интерпретатор выключен</span>
                  <p className="text-[10px] text-slate-500 mt-1 max-w-44">
                    Запустите виртуальную среду кликом выше, чтобы активировать локальную базу данных, симуляцию API и реактивные тесты.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB: LANGUAGE REFERENCE SCHEETS */}
          {activeTab === "docs" && (
            <div className="p-4 flex flex-col h-full space-y-4 text-slate-300 leading-relaxed text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-amber-500" /> СПРАВОЧНИК ЯЗЫКА PX
                </span>
                <span className="text-[10px] bg-slate-800 text-amber-400 border border-amber-950 px-1.5 py-0.5 rounded font-mono">
                  Синтаксис
                </span>
              </div>

              <div className="space-y-3.5 overflow-y-auto max-h-[75vh] pr-1">
                <div>
                  <h4 className="font-semibold text-slate-100 flex items-center gap-1.5 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span> ИНИЦИАЛИЗАЦИЯ
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Скрипт Primix компилируется сверху вниз. Каждая сборка API микросервиса объявляет входную точку:
                  </p>
                  <pre className="mt-1.5 p-2 bg-slate-950 text-slate-300 rounded font-mono text-[10px] border border-slate-850">
                    port 8080 # Биндинг сокета
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-100 flex items-center gap-1.5 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-400"></span> СУБД И ТАБЛИЦЫ
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1">
                    PX создает b-дерево структуру данных во внешней In-Memory SQLite СУБД декларативно:
                  </p>
                  <pre className="mt-1.5 p-2 bg-slate-950 text-slate-300 rounded font-mono text-[10px] border border-slate-850">
                    table users (id, name, state)
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-100 flex items-center gap-1.5 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> МАРШРУТЫ И РОУТИНГ API
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Прием GET запросов. Поддерживает форматирование под JSON ответов:
                  </p>
                  <pre className="mt-1.5 p-2 bg-slate-950 text-slate-300 rounded font-mono text-[10px] border border-slate-850">
                    path /api/v1 -&gt; welcome "OK"
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-100 flex items-center gap-1.5 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse"></span> РЕАКТИВНЫЙ MONITOR
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Принудительное слежение за переменной. watch регистрирует слушателя в VM:
                  </p>
                  <pre className="mt-1.5 p-2 bg-slate-950 text-slate-300 rounded font-mono text-[10px] border border-slate-850">
                    watch cpu_usage -&gt; trigger Alarm
                  </pre>
                </div>

                <div className="p-2.5 bg-slate-950/40 border border-slate-855 rounded-lg text-[10px] text-slate-400">
                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                    🧠 Особенности Bridge:
                  </span>
                  Множественные мосты <code className="font-mono text-cyan-400">bridge android -&gt; protocol</code> транслируют REST вызовы в события Kotlin и Java при упаковке APK.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Central Workspace Code Editor Column (VS Code Center Pane) */}
        <div className="flex-1 flex flex-col h-full bg-[#1e1e1e] border-r border-[#111111]">
          {/* Editor Header Tab Bar - Cupertino Style */}
          <div className="flex items-center justify-between bg-[#161617] h-10 border-b border-white/5 px-4 shrink-0 select-none">
            <div className="flex items-center h-full">
              <span className="bg-[#1e1e1e] h-full text-white text-[11px] px-4 font-mono font-bold flex items-center gap-1.5 border-r border-white/5">
                <FileText className="h-3.5 w-3.5 text-[#0071e3]" /> {activeFile.name}
              </span>
              <span className="text-[9px] text-[#a1a1a6] ml-3 px-2 py-0.5 rounded-full font-bold font-mono border border-white/5 bg-white/5">
                PX Syntax
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyCode}
                title="Копировать исходный px-код"
                className="px-3 py-1 bg-white/5 hover:bg-white/10 active:scale-95 text-gray-200 border border-white/5 rounded-full transition-all text-[10px] font-bold flex items-center gap-1"
              >
                <Copy className="h-3 w-3 text-[#0071e3]" /> Скопировать PX
              </button>
              
              {!vmState.isBooted ? (
                <button
                  onClick={startDebuggerVM}
                  className="px-3 py-1 bg-[#34c759] hover:bg-[#30b552] text-white rounded-full text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1"
                >
                  <Play className="h-3 w-3 fill-current" /> Запустить
                </button>
              ) : (
                <button
                  onClick={stopDebuggerVM}
                  className="px-3 py-1 bg-[#ff3b30] hover:bg-[#e03126] text-white rounded-full text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1"
                >
                  <Square className="h-3 w-3 fill-current" /> Стоп
                </button>
              )}
            </div>
          </div>

          {/* Core Monaco Editor Frame container */}
          <div className="flex-1 min-h-0 relative bg-[#1e1e1e]">
            <MonacoEditor
              height="100%"
              language="primix"
              theme="vs-dark"
              value={activeFile.content}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                fontSize: 13,
                fontFamily: "JetBrains Mono, Menlo, Monaco, monospace",
                minimap: { enabled: true },
                automaticLayout: true,
                cursorBlinking: "linear",
                tabSize: 4,
                wordWrap: "on",
                lineNumbers: "on",
                scrollbar: {
                  vertical: "visible",
                  horizontal: "visible"
                },
                roundedSelection: true,
                renderLineHighlight: "all"
              }}
            />
          </div>
          <div className="h-64 border-t border-[#111111] bg-[#1e1e1e] flex flex-col">
            <div className="flex items-center justify-between px-3 h-8 bg-[#2d2d2d] border-b border-[#111111] text-[11px]">
              <div className="flex items-center gap-4">
                <span className="font-bold text-[#cccccc] uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-[#007acc]" /> Терминал Среды Разработки
                </span>
                <span className="text-[10px] bg-[#1e1e1e] text-slate-400 px-1.5 py-0.2 rounded font-mono border border-[#3c3c3c]">
                  bash-px
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setTerminalLogs([])}
                  className="text-slate-400 hover:text-slate-200 text-[10px] font-mono hover:underline"
                >
                  Очистить логи
                </button>
              </div>
            </div>

            {/* Simulated Streams Shell logs terminal */}
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed space-y-1 bg-[#1e1e1e] text-[#cccccc] scrollbar select-text">
              {terminalLogs.map((log, lIdx) => (
                <div
                  key={lIdx}
                  className={`${
                    log.type === "input"
                      ? "text-[#808080]"
                      : log.type === "error"
                      ? "text-rose-400"
                      : log.type === "system"
                      ? "text-purple-400"
                      : "text-slate-200"
                  }`}
                >
                  {log.text}
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>

            {/* Shell Line Command input panel */}
            <form onSubmit={handleTerminalSubmit} className="flex items-center bg-[#1e1e1e] px-3 py-1 border-t border-[#111111] h-8 shrink-0 gap-1.5">
              <span className="text-[#007acc] font-mono text-xs select-none">user@primix-core:~$</span>
              <input
                type="text"
                value={terminalCommand}
                onChange={e => setTerminalCommand(e.target.value)}
                placeholder="Введите шелл команду (help, clear, diagnose, px-run)..."
                className="bg-transparent focus:outline-none flex-1 text-slate-200 font-mono text-[11px] placeholder-slate-600"
              />
            </form>
          </div>
        </div>

        {/* Live VM Event Listener Stream Dashboard (VS Code Right Column) */}
        <div className="w-80 bg-[#252526] border-l border-[#111111] flex flex-col h-full overflow-hidden shrink-0 select-none">
          <div className="p-2 bg-[#2d2d2d] border-b border-[#111111] h-8 flex items-center justify-between shrink-0 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-[#007acc]" /> ТРЕЙСИНГ ОТЛАДКИ В РЕАЛЬНОМ ВРЕМЕНИ
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#007acc] animate-pulse"></span>
          </div>

          {/* Virtual CPU Event monitor flow stack */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2 font-mono text-[10px] scrollbar bg-[#1e1e1e] select-text">
            {vmState.isBooted ? (
              vmState.customLogs.length === 0 ? (
                <div className="text-slate-500 italic text-center pt-8 bg-[#1e1e1e]">VM готова. Выполните API запросы или измените данные для записи логов...</div>
              ) : (
                vmState.customLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded border leading-normal bg-[#252526]/50 ${
                      log.type === "success"
                        ? "border-emerald-950/60 text-emerald-300"
                        : log.type === "warning"
                        ? "border-amber-950/60 text-amber-300"
                        : log.type === "error"
                        ? "border-rose-950/60 text-rose-300"
                        : log.type === "event"
                        ? "border-cyan-950/60 text-cyan-300"
                        : "border-slate-800 text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[8px] opacity-50 mb-1">
                      <span>TIMESTAMP: {log.timestamp}</span>
                      <span className="font-bold">{log.type.toUpperCase()}</span>
                    </div>
                    <div className="break-words leading-tight pr-1 font-mono ">{log.message}</div>
                  </div>
                ))
              )
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-4 py-16 text-slate-600 bg-[#1e1e1e]">
                <ShieldAlert className="h-10 w-10 text-slate-700/85 mb-3" />
                <span className="font-bold text-xs">Трассировка прервана</span>
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed max-w-44">
                  Запустите виртуальную среду VM кнопкой "Запустить", чтобы транслировать сигналы, события базы данных и отладочные метрики.
                </p>
              </div>
            )}
            <div ref={vmLendingLogsRef} />
          </div>

          {/* Foot status indicators for bridge adapters */}
          <div className="p-2 border-t border-[#111111] bg-[#252526] text-slate-400 text-[10px] space-y-1 shrink-0 select-none">
            <span className="font-semibold text-slate-400 flex items-center gap-1 text-[9px] uppercase border-b border-[#111111] pb-1">
              🔋 СТАТУС ПОРТА ВВОДА/ВЫВОДА (COMPILER BRIDGES):
            </span>
            {vmState.isBooted && vmState.bridges.length > 0 ? (
              <div className="grid grid-cols-2 gap-1 font-mono">
                {vmState.bridges.map(b => (
                  <div key={b.client} className="p-1 px-1.5 rounded bg-[#1e1e1e] border border-[#3c3c3c] flex items-center justify-between text-[9px]">
                    <span className="text-slate-400 truncate w-16">{b.client}</span>
                    <span className="text-[#007acc] font-bold">READY</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[9px] text-slate-500 italic">Слушатели пакетов отключены.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
