import { DiagnosticError, PXVMState, PXTable, PXRoute, PXBridge, PXWatch } from "../types";

/**
 * Parses Primix (PX) script code and returns real-time diagnostics (LSP errors/warnings).
 */
export function diagnosePrimixCode(code: string): DiagnosticError[] {
  const diagnostics: DiagnosticError[] = [];
  const lines = code.split("\n");

  let portCount = 0;
  let inBlock = false;
  let blockLineStart = 0;

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Skip empty lines or comments
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    // 1. Validate block closures
    if (trimmed.startsWith("block ") && trimmed.includes("{")) {
      if (inBlock) {
        diagnostics.push({
          line: lineNum,
          column: 1,
          message: "Синтаксическая ошибка: Предыдущий block не закрыт фигурной скобкой '}'.",
          severity: "error",
        });
      }
      inBlock = true;
      blockLineStart = lineNum;
    }

    if (trimmed === "}") {
      if (!inBlock) {
        diagnostics.push({
          line: lineNum,
          column: 1,
          message: "Синтаксическая ошибка: Лишняя закрывающая фигурная скобка '}'.",
          severity: "error",
        });
      }
      inBlock = false;
    }

    // 2. Validate Port Configuration
    if (trimmed.startsWith("port ")) {
      portCount++;
      const parts = trimmed.split(/\s+/);
      const portVal = parts[1];
      if (!portVal) {
        diagnostics.push({
          line: lineNum,
          column: 6,
          message: "Конфигурация ядра: Укажите номер сетевого порта (например: port 8080).",
          severity: "error",
        });
      } else {
        const portNum = parseInt(portVal, 10);
        if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
          diagnostics.push({
            line: lineNum,
            column: 6,
            message: `Ошибка порта: '${portVal}' не является корректным номером TCP порта (1-65535).`,
            severity: "error",
          });
        }
      }
      if (portCount > 1) {
        diagnostics.push({
          line: lineNum,
          column: 1,
          message: "Конфликт конфигурации: Порт не может быть инициализирован дважды в одной сборке VM.",
          severity: "error",
        });
      }
    }

    // 3. Validate Table statements
    if (trimmed.startsWith("table ")) {
      const parentheseOpen = trimmed.indexOf("(");
      const parentheseClose = trimmed.indexOf(")");

      if (parentheseOpen === -1) {
        diagnostics.push({
          line: lineNum,
          column: 7,
          message: "Правило синтаксиса: Колонки таблицы должны быть объявлены в круглых скобках, пример: table users (id, name).",
          severity: "error",
        });
      } else if (parentheseClose === -1) {
        diagnostics.push({
          line: lineNum,
          column: parentheseOpen + 1,
          message: "Синтаксическая ошибка: Ожидалась закрывающая скобка ')' в конце объявления колонок таблицы.",
          severity: "error",
        });
      } else {
        const colsContent = trimmed.substring(parentheseOpen + 1, parentheseClose).trim();
        if (!colsContent) {
          diagnostics.push({
            line: lineNum,
            column: parentheseOpen + 1,
            message: "Ошибка структуры: Таблица не может иметь пустое количество колонок.",
            severity: "warning",
          });
        }
      }
    }

    // 4. Validate routes / paths
    if (trimmed.startsWith("path ")) {
      if (!trimmed.includes("->")) {
        diagnostics.push({
          line: lineNum,
          column: trimmed.indexOf("path") + 5,
          message: "Синтаксический оператор: Маршрут 'path' требует наличия стрелочного оператора '->' для адресации действия.",
          severity: "error",
        });
      } else {
        const parts = trimmed.split("->");
        const actionPart = parts[1]?.trim() || "";
        if (!actionPart) {
          diagnostics.push({
            line: lineNum,
            column: trimmed.indexOf("->") + 2,
            message: "Ошибка адресации: Маршрут должен выполнять ответ welcome или вызов триггера (например: path /ping -> welcome \"pong\").",
            severity: "error",
          });
        } else if (actionPart.startsWith("welcome") && !actionPart.includes('"')) {
          diagnostics.push({
            line: lineNum,
            column: trimmed.indexOf("welcome"),
            message: "Валидация типов данных: При возвращении welcome строки ответа должны быть обернуты в двойные кавычки.",
            severity: "warning",
          });
        }
      }
    }

    // 5. Validate watch syntax
    if (trimmed.startsWith("watch ")) {
      if (!trimmed.includes("->")) {
        diagnostics.push({
          line: lineNum,
          column: 6,
          message: "Синтаксис Watcher: Наблюдатель 'watch' требует оператора '->' для вызова триггера (пример: watch cpu_usage -> trigger ActiveCooling_Adjustment).",
          severity: "error",
        });
      }
    }

    // 6. Validate bridge declarations
    if (trimmed.startsWith("bridge ")) {
      if (!trimmed.includes("->")) {
        diagnostics.push({
          line: lineNum,
          column: 7,
          message: "Синтаксис Bridge: Определение моста обмена данными требует оператора '->' (пример: bridge android_client -> websocket).",
          severity: "error",
        });
      }
    }

    // 7. General syntax check for unknown first tokens (with strict exclusion of block inner assignments)
    if (!inBlock && trimmed !== "}" && !trimmed.startsWith("port ") && !trimmed.startsWith("table ") && !trimmed.startsWith("path ") && !trimmed.startsWith("block ") && !trimmed.startsWith("bridge ") && !trimmed.startsWith("watch ") && !trimmed.startsWith("match ") && !trimmed.includes("=") && !trimmed.startsWith("trigger ")) {
      const firstToken = trimmed.split(/\s+/)[0];
      if (firstToken && firstToken !== "case" && firstToken !== "->") {
        diagnostics.push({
          line: lineNum,
          column: 1,
          message: `Неопознанная конструкция или ключевое слово '${firstToken}'. Пожалуйста, проверьте синтаксис языка Primix.`,
          severity: "warning",
        });
      }
    }
  });

  // If file finishes and block is still unclosed
  if (inBlock) {
    diagnostics.push({
      line: blockLineStart,
      column: 1,
      message: "Синтаксическая ошибка: Область 'block { ... }' осталась незакрытой в конце файла. Убедитесь в наличии символа '}'.",
      severity: "error",
    });
  }

  // Warning if no network port is configured
  if (portCount === 0 && lines.join("").trim().length > 0) {
    diagnostics.push({
      line: 1,
      column: 1,
      message: "Предупреждение архитектуры: Сетевой порт не определен. Добавьте 'port 8080' для запуска прослушивания сокетов VM.",
      severity: "info",
    });
  }

  return diagnostics;
}

/**
 * Processes script contents and compiles into a virtual, mock environment runnable state
 */
export function compilePrimixCode(code: string): Omit<PXVMState, "isBooted" | "customLogs"> {
  const tables: PXTable[] = [];
  const routes: PXRoute[] = [];
  const bridges: PXBridge[] = [];
  const watches: PXWatch[] = [];
  let port: number | null = null;
  const variables: Record<string, string> = {};

  const lines = code.split("\n");

  // Track if we are inside a block
  let currentBlockName = "";
  let insideBlock = false;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    // Isolate variables inside blocks or variables overall
    if (trimmed.startsWith("port ")) {
      const parsedVal = trimmed.split(/\s+/)[1];
      if (parsedVal) {
        const val = parseInt(parsedVal, 10);
        if (!isNaN(val)) port = val;
      }
    }

    // Capture tables
    if (trimmed.startsWith("table ")) {
      const match = trimmed.match(/table\s+([a-zA-Z_$][\w_$]*)\s*\(([^)]+)\)/);
      if (match) {
        const tableName = match[1];
        const cols = match[2].split(",").map(c => c.trim());
        
        // Add table to static structure with 2 prefilled database tuples for extreme interactive realism!
        const prefilledRows: Record<string, string>[] = [];
        if (tableName === "users") {
          prefilledRows.push(
            { id: "1", name: "Алексей Иванов", status: "Active", role: "Developer" },
            { id: "2", name: "Мария Смирнова", status: "Offline", role: "Administrator" }
          );
        } else if (tableName === "telemetry") {
          prefilledRows.push(
            { timestamp: new Date().toLocaleTimeString(), cpu_usage: "24%", memory_usage: "45%", sys_status: "Green" },
            { timestamp: new Date(Date.now() - 30000).toLocaleTimeString(), cpu_usage: "12%", memory_usage: "40%", sys_status: "Idle" }
          );
        } else if (tableName === "active_processes" || tableName === "local_store") {
          prefilledRows.push(
            { id: "1", key: "auth_token", value: "px_jwt_9918a", sync_state: "OK", updated_at: "Just Now" }
          );
        }

        tables.push({
          name: tableName,
          columns: cols,
          rows: prefilledRows,
        });
      }
    }

    // Capture routes
    if (trimmed.startsWith("path ")) {
      const parts = trimmed.split("->");
      const pathRaw = parts[0]?.replace("path", "").trim();
      let actionRaw = parts[1]?.trim() || "";
      
      // Clean string quotes for welcome
      if (actionRaw.startsWith("welcome ")) {
        actionRaw = actionRaw.replace("welcome ", "").replace(/"/g, "").trim();
      }

      if (pathRaw) {
        routes.push({
          path: pathRaw,
          action: actionRaw,
        });
      }
    }

    // Capture bridges
    if (trimmed.startsWith("bridge ")) {
      const parts = trimmed.split("->");
      const clientRaw = parts[0]?.replace("bridge", "").trim();
      const protocolRaw = parts[1]?.trim() || "";
      if (clientRaw && protocolRaw) {
        bridges.push({
          client: clientRaw,
          protocol: protocolRaw,
        });
      }
    }

    // Capture watches
    if (trimmed.startsWith("watch ")) {
      const parts = trimmed.split("->");
      const varRaw = parts[0]?.replace("watch", "").trim();
      const actionRaw = parts[1]?.trim() || "";
      if (varRaw && actionRaw) {
        watches.push({
          variable: varRaw,
          action: actionRaw,
        });
        
        // Add watch variables to global simulated register lists
        if (!(varRaw in variables)) {
          // prefill responsive mock default variables values
          if (varRaw === "cpu_usage") variables[varRaw] = "24";
          else if (varRaw === "memory_usage") variables[varRaw] = "45";
          else if (varRaw === "connection_status") variables[varRaw] = "Online";
          else if (varRaw === "system_load_15m") variables[varRaw] = "1.15";
          else if (varRaw === "heap_utilization") variables[varRaw] = "512MB";
          else variables[varRaw] = "0";
        }
      }
    }

    // Block logic and variable parsing
    if (trimmed.startsWith("block ") && trimmed.includes("{")) {
      insideBlock = true;
      currentBlockName = trimmed.replace("block", "").split("{")[0].trim();
    }
    if (trimmed === "}") {
      insideBlock = false;
      currentBlockName = "";
    }

    // Capture inner variables declared with equation sign
    if (trimmed.includes("=")) {
      const splitAssign = trimmed.split("=");
      const vName = splitAssign[0]?.trim();
      let vVal = splitAssign[1]?.trim().replace(/"/g, "") || "";
      if (vName) {
        const fullVarName = insideBlock ? `${currentBlockName}.${vName}` : vName;
        variables[fullVarName] = vVal;
      }
    }
  });

  return {
    port,
    tables,
    routes,
    bridges,
    watches,
    variables,
  };
}
