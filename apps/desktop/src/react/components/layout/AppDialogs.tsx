import type { ConnectionDeepLinkDraft } from "@/lib/connectionDeepLink";

interface AppDialogsProps {
  showConnectionDialog: boolean;
  connectionPrefill?: ConnectionDeepLinkDraft | null;
  showSettingsDialog: boolean;
  settingsInitialTab?: string;
  appVersion?: string;
  showDangerDialog: boolean;
  dangerSql: string;
  suppressDangerConfirm: boolean;
  onUpdateConnectionDialog: (open: boolean) => void;
  onUpdateSettingsDialog: (open: boolean) => void;
  onUpdateDangerDialog: (open: boolean) => void;
  onUpdateSuppressDangerConfirm: (value: boolean) => void;
  onDangerConfirm: () => void;
  onConnectStarted: (name: string) => void;
  onConnectSucceeded: (name: string) => void;
  onConnectFailed: (message: string) => void;
  onOpenDriverStore: () => void;
  t: (key: string) => string;
}

// Placeholder - ConnectionDialog and other dialogs need migration
// This component will be fully implemented when those are migrated

export function AppDialogs({
  showConnectionDialog,
  showSettingsDialog,
  showDangerDialog,
  onUpdateConnectionDialog,
  onUpdateSettingsDialog,
  onUpdateDangerDialog,
  onDangerConfirm,
  onConnectStarted,
  onConnectSucceeded,
  onConnectFailed,
  onOpenDriverStore,
  t,
}: AppDialogsProps) {
  return null; // Placeholder - dialogs will be migrated in future tasks
}
