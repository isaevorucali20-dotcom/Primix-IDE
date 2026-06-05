export interface ProjectFile {
  name: string;
  path: string;
  content: string;
  platform: "win7" | "win10_11" | "linux" | "macos" | "universal" | "custom";
}

export interface DiagnosticError {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface PXTable {
  name: string;
  columns: string[];
  rows: Record<string, string>[];
}

export interface PXRoute {
  path: string;
  action: string;
}

export interface PXBridge {
  client: string;
  protocol: string;
}

export interface PXWatch {
  variable: string;
  action: string;
}

export interface PXVMState {
  isBooted: boolean;
  port: number | null;
  tables: PXTable[];
  routes: PXRoute[];
  bridges: PXBridge[];
  watches: PXWatch[];
  customLogs: Array<{ timestamp: string; type: "info" | "success" | "warning" | "error" | "event"; message: string }>;
  variables: Record<string, string>; // live simulated values
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
}
