"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/react/components/ui/dialog";
import { Button } from "@/react/components/ui/button";
import { Input } from "@/react/components/ui/input";
import { Label } from "@/react/components/ui/label";
import { Badge } from "@/react/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/react/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/react/components/ui/tabs";
import { Switch } from "@/react/components/ui/switch";
import { Progress } from "@/react/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/react/components/ui/tooltip";
import { ScrollArea } from "@/react/components/ui/scroll-area";
import { DatabaseIcon } from "@/react/components/icons/DatabaseIcon";
import { useToast } from "@/hooks/useToast";
import { useSettingsStore } from "@/react/stores/settingsStore";
import * as api from "@/lib/api";
import { isTauriRuntime } from "@/lib/tauriRuntime";

interface DriverStoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateNotificationsEnabled?: boolean;
}

interface DriverStorePathInfo {
  plugins_dir: string;
  agents_dir: string;
}

interface AgentDriverInfo {
  db_type: string;
  label: string;
  version: string;
  installed_version: string | null;
  installed: boolean;
  update_available: boolean;
  jre: string;
  jre_installed: boolean;
}

interface JdbcDriverInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  bundle_id: string | null;
}

interface JdbcMavenBundleInfo {
  id: string;
  coordinate: string;
  artifacts: { name: string; size: number }[];
  repositories: string[];
}

interface JdbcPluginStatus {
  installed: boolean;
  version: string;
  update_available: boolean;
}

interface DriverRuntimeSummary {
  running_count: number;
  total_memory_bytes: number;
  health: "healthy" | "degraded" | "unhealthy";
}

interface DriverRuntimeInfo {
  id: string;
  label: string;
  kind: "plugin" | "agent";
  source: "connection" | "daemon";
  status: "running" | "stopped" | "error";
}

interface DriverStoreUsage {
  total_bytes: number;
  jre_bytes: number;
  agent_driver_bytes: number;
  jdbc_plugin_bytes: number;
  jdbc_driver_bytes: number;
  jres: { id: string; bytes: number }[];
}

const isWeb = !isTauriRuntime();

export function DriverStoreDialog({
  open,
  onOpenChange,
  updateNotificationsEnabled = true,
}: DriverStoreDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const settingsStore = useSettingsStore();

  // Driver store path state
  const [legacyDriverStoreDir, setLegacyDriverStoreDir] = useState<string | null>(null);
  const [pluginStoreDir, setPluginStoreDir] = useState<string | null>(null);
  const [agentStoreDir, setAgentStoreDir] = useState<string | null>(null);
  const [driverStoreDirMigrating, setDriverStoreDirMigrating] = useState<string | null>(null);
  const [currentDriverStorePath, setCurrentDriverStorePath] = useState<DriverStorePathInfo | null>(null);

  // Agent drivers state
  const [drivers, setDrivers] = useState<AgentDriverInfo[]>([]);
  const [agentDriverSearch, setAgentDriverSearch] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [upgradingAll, setUpgradingAll] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [queuedDriverInstalls, setQueuedDriverInstalls] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Java runtime state
  const [javaRuntimeConfig, setJavaRuntimeConfig] = useState({ mode: "managed" as "managed" | "system" | "custom", custom_java_path: null as string | null });
  const [customJavaPath, setCustomJavaPath] = useState("");
  const [savingJavaRuntime, setSavingJavaRuntime] = useState(false);

  // JDBC drivers state
  const [jdbcDrivers, setJdbcDrivers] = useState<JdbcDriverInfo[]>([]);
  const [jdbcMavenBundles, setJdbcMavenBundles] = useState<JdbcMavenBundleInfo[]>([]);
  const [jdbcDriverSearch, setJdbcDriverSearch] = useState("");
  const [isLoadingJdbcDrivers, setIsLoadingJdbcDrivers] = useState(false);
  const [jdbcPluginStatus, setJdbcPluginStatus] = useState<JdbcPluginStatus | null>(null);
  const [isInstallingJdbcPlugin, setIsInstallingJdbcPlugin] = useState(false);

  // Runtime state
  const [driverStoreUsage, setDriverStoreUsage] = useState<DriverStoreUsage | null>(null);
  const [runtimeSummary, setRuntimeSummary] = useState<DriverRuntimeSummary | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null);

  // Dialog tab
  const [driverStoreTab, setDriverStoreTab] = useState("agent");

  // Load driver store path
  useEffect(() => {
    if (!open || isWeb) return;
    async function loadDriverStorePath() {
      try {
        const path = await api.getDriverStorePath();
        setCurrentDriverStorePath(path);
      } catch {
        setCurrentDriverStorePath(null);
      }
    }
    loadDriverStorePath();
    setLegacyDriverStoreDir(settingsStore.desktopSettings.driver_store_dir ?? null);
    setPluginStoreDir(settingsStore.desktopSettings.plugin_store_dir ?? null);
    setAgentStoreDir(settingsStore.desktopSettings.agent_store_dir ?? null);
  }, [open, settingsStore.desktopSettings]);

  // Load agents
  useEffect(() => {
    if (!open) return;
    refreshAgents();
  }, [open]);

  // Load JDBC plugin status
  useEffect(() => {
    if (!open) return;
    loadJdbcPluginStatus();
    loadJdbcDrivers();
  }, [open]);

  // Emit update count
  useEffect(() => {
    if (!updateNotificationsEnabled) return;
    const count = drivers.filter(d => d.update_available).length + (jdbcPluginStatus?.update_available ? 1 : 0);
    // TODO: emit update-count-change
  }, [drivers, jdbcPluginStatus, updateNotificationsEnabled]);

  const refreshAgents = async () => {
    setRefreshing(true);
    try {
      const agentDrivers = await api.listInstalledAgents();
      setDrivers(agentDrivers);
      await loadDriverStoreUsage();
    } finally {
      setRefreshing(false);
    }
  };

  const loadDriverStoreUsage = async () => {
    try {
      const usage = await api.getDriverStoreUsage();
      setDriverStoreUsage(usage);
    } catch {
      setDriverStoreUsage(null);
    }
  };

  const loadJdbcPluginStatus = async () => {
    try {
      const status = await api.jdbcPluginStatus();
      setJdbcPluginStatus(status);
    } catch (e: any) {
      toast(String(e?.message || e), 5000);
    }
  };

  const loadJdbcDrivers = async () => {
    setIsLoadingJdbcDrivers(true);
    try {
      const [drivers, bundles] = await Promise.all([api.listJdbcDrivers(), api.listJdbcMavenBundles()]);
      setJdbcDrivers(drivers);
      setJdbcMavenBundles(bundles);
    } catch (e: any) {
      toast(String(e?.message || e), 5000);
    } finally {
      setIsLoadingJdbcDrivers(false);
      await loadDriverStoreUsage();
    }
  };

  const filteredAgentDrivers = useMemo(() => {
    const query = agentDriverSearch.trim().toLowerCase();
    if (!query) return drivers;
    return drivers.filter(driver =>
      [driver.label, driver.db_type, driver.version, driver.installed_version, driver.jre]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [drivers, agentDriverSearch]);

  const filteredJdbcDrivers = useMemo(() => {
    const query = jdbcDriverSearch.trim().toLowerCase();
    const items = [
      ...jdbcMavenBundles.map(bundle => ({
        kind: "maven" as const,
        id: `maven:${bundle.id}`,
        title: bundle.coordinate,
        subtitle: `${bundle.artifacts.length} JARs - ${bundle.repositories.join(", ")}`,
        source: t("driverStore.jdbcSourceMaven"),
        size: bundle.artifacts.reduce((total, artifact) => total + Number(artifact.size || 0), 0),
      })),
      ...jdbcDrivers
        .filter(driver => !driver.bundle_id)
        .map(driver => ({
          kind: "manual" as const,
          id: `manual:${driver.path}`,
          title: driver.name,
          subtitle: driver.path,
          source: t("driverStore.jdbcSourceManual"),
          size: driver.size,
        })),
    ];
    if (!query) return items;
    return items.filter(item =>
      [item.title, item.subtitle, String(item.size)].join(" ").toLowerCase().includes(query)
    );
  }, [jdbcDrivers, jdbcMavenBundles, jdbcDriverSearch, t]);

  const usageSummary = useMemo(() => {
    if (!driverStoreUsage) return [];
    return [
      { key: "total", label: t("driverStore.usageTotalLabel"), bytes: driverStoreUsage.total_bytes },
      { key: "jre", label: t("driverStore.usageManagedJre"), bytes: driverStoreUsage.jre_bytes },
      { key: "agent", label: t("driverStore.usageAgentDrivers"), bytes: driverStoreUsage.agent_driver_bytes },
      { key: "jdbc-plugin", label: t("driverStore.usageJdbcPlugin"), bytes: driverStoreUsage.jdbc_plugin_bytes },
      { key: "jdbc-driver", label: t("driverStore.usageJdbcDriverJars"), bytes: driverStoreUsage.jdbc_driver_bytes },
    ];
  }, [driverStoreUsage, t]);

  const runtimeOverview = useMemo(() => {
    if (!runtimeSummary) return [];
    return [
      { key: "running", label: t("driverStore.runtimeRunning"), value: String(runtimeSummary.running_count ?? 0) },
      { key: "memory", label: t("driverStore.runtimeMemory"), value: formatBytes(runtimeSummary.total_memory_bytes) },
      { key: "health", label: t("driverStore.runtimeHealth"), value: t(`driverStore.runtimeHealth_${runtimeSummary.health ?? "healthy"}`) },
    ];
  }, [runtimeSummary, t]);

  async function installDriver(dbType: string) {
    if (installing !== null || upgradingAll) return;
    const label = drivers.find(d => d.db_type === dbType)?.label ?? dbType;
    setInstalling(dbType);
    try {
      await api.installAgent(dbType);
      await refreshAgents();
      toast(t("driverStore.driverInstallSuccess", { label }));
    } catch (e: any) {
      toast(t("driverStore.driverInstallFailed", { label, error: e }));
    } finally {
      setInstalling(null);
    }
  }

  async function uninstallDriver(dbType: string) {
    const label = drivers.find(d => d.db_type === dbType)?.label ?? dbType;
    try {
      await api.uninstallAgent(dbType);
      await refreshAgents();
      toast(t("driverStore.driverUninstallSuccess", { label }));
    } catch (e: any) {
      toast(t("driverStore.driverUninstallFailed", { label, error: e }));
    }
  }

  async function upgradeAll() {
    setUpgradingAll(true);
    try {
      const result = await api.upgradeAllAgents();
      await refreshAgents();
      if (result.failed.length > 0) {
        toast(t("driverStore.upgradeAllPartial", { count: result.upgraded, failed: result.failed.join(", ") }));
      } else {
        toast(t("driverStore.upgradeAllSuccess", { count: result.upgraded }));
      }
    } catch (e: any) {
      toast(t("driverStore.upgradeAllFailed", { error: e }));
    } finally {
      setUpgradingAll(false);
    }
  }

  async function saveJavaRuntimeConfig() {
    setSavingJavaRuntime(true);
    try {
      const config = await api.setAgentJavaRuntimeConfig({
        mode: javaRuntimeConfig.mode,
        custom_java_path: javaRuntimeConfig.mode === "custom" ? customJavaPath.trim() || null : null,
      });
      setJavaRuntimeConfig(config);
      setCustomJavaPath(config.custom_java_path ?? "");
      toast(t("driverStore.javaRuntimeSaved"));
    } catch (e: any) {
      toast(t("driverStore.javaRuntimeSaveFailed", { error: e }));
    } finally {
      setSavingJavaRuntime(false);
    }
  }

  async function installJdbcPlugin() {
    if (isInstallingJdbcPlugin) return;
    setIsInstallingJdbcPlugin(true);
    try {
      const status = await api.installJdbcPlugin();
      setJdbcPluginStatus(status);
      toast(t("settings.jdbcPluginInstallSuccess"));
      await loadJdbcDrivers();
    } catch (e: any) {
      toast(String(e?.message || e), 5000);
    } finally {
      setIsInstallingJdbcPlugin(false);
    }
  }

  const canInstallOrUpdateDriver = (dbType: string) => {
    const driver = drivers.find(d => d.db_type === dbType);
    return Boolean(driver && (!driver.installed || driver.update_available));
  };

  const updatableCount = drivers.filter(d => d.update_available).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("driverStore.title")}</DialogTitle>
        </DialogHeader>

        <Tabs value={driverStoreTab} onValueChange={setDriverStoreTab} className="flex-1 min-h-0">
          <TabsList>
            <TabsTrigger value="agent">{t("driverStore.tabAgent")}</TabsTrigger>
            <TabsTrigger value="jdbc">{t("driverStore.tabJdbc")}</TabsTrigger>
            <TabsTrigger value="storage">{t("driverStore.tabStorage")}</TabsTrigger>
            <TabsTrigger value="runtime">{t("driverStore.tabRuntime")}</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0 mt-4">
            <TabsContent value="agent" className="m-0">
              <div className="space-y-4">
                {/* Search and Actions */}
                <div className="flex items-center gap-4">
                  <Input
                    placeholder={t("driverStore.searchPlaceholder")}
                    value={agentDriverSearch}
                    onChange={e => setAgentDriverSearch(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={refreshAgents}
                    disabled={refreshing}
                  >
                    {refreshing ? t("common.refreshing") : t("common.refresh")}
                  </Button>
                  {updatableCount > 0 && (
                    <Button
                      variant="default"
                      onClick={upgradeAll}
                      disabled={upgradingAll}
                    >
                      {t("driverStore.upgradeAll")}
                    </Button>
                  )}
                </div>

                {/* Driver List */}
                <div className="space-y-2">
                  {filteredAgentDrivers.map(driver => (
                    <div
                      key={driver.db_type}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <DatabaseIcon dbType={driver.db_type} className="w-8 h-8" />
                        <div>
                          <div className="font-medium">{driver.label}</div>
                          <div className="text-sm text-muted-foreground">
                            {driver.version}
                            {driver.installed_version && driver.installed_version !== driver.version && (
                              <span className="ml-2 text-yellow-500">
                                → {driver.installed_version}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {driver.update_available && (
                          <Badge variant="default">{t("driverStore.updateAvailable")}</Badge>
                        )}
                        {driver.installed ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => uninstallDriver(driver.db_type)}
                          >
                            {t("common.uninstall")}
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => installDriver(driver.db_type)}
                            disabled={installing !== null}
                          >
                            {installing === driver.db_type ? t("driverStore.installing") : t("common.install")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {filteredAgentDrivers.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("driverStore.noDriversFound")}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="jdbc" className="m-0">
              <div className="space-y-4">
                {/* JDBC Plugin Status */}
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{t("driverStore.jdbcPlugin")}</div>
                      <div className="text-sm text-muted-foreground">
                        {jdbcPluginStatus?.installed
                          ? t("driverStore.jdbcPluginInstalled", { version: jdbcPluginStatus.version })
                          : t("driverStore.jdbcPluginNotInstalled")}
                      </div>
                    </div>
                    <Button
                      variant={jdbcPluginStatus?.installed ? "outline" : "default"}
                      onClick={installJdbcPlugin}
                      disabled={isInstallingJdbcPlugin}
                    >
                      {isInstallingJdbcPlugin ? t("driverStore.installing") : t("common.install")}
                    </Button>
                  </div>
                </div>

                {/* Search */}
                <Input
                  placeholder={t("driverStore.searchPlaceholder")}
                  value={jdbcDriverSearch}
                  onChange={e => setJdbcDriverSearch(e.target.value)}
                />

                {/* JDBC Driver List */}
                <div className="space-y-2">
                  {filteredJdbcDrivers.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="text-sm text-muted-foreground">{item.subtitle}</div>
                      </div>
                      <Badge variant="outline">{item.source}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="storage" className="m-0">
              <div className="space-y-4">
                {/* Usage Summary */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {usageSummary.map(item => (
                    <div key={item.key} className="p-3 border rounded-lg text-center">
                      <div className="text-2xl font-bold">{formatBytes(item.bytes)}</div>
                      <div className="text-sm text-muted-foreground">{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* Runtime Overview */}
                {runtimeOverview.length > 0 && (
                  <div className="grid grid-cols-3 gap-4">
                    {runtimeOverview.map(item => (
                      <div key={item.key} className="p-3 border rounded-lg text-center">
                        <div className="text-2xl font-bold">{item.value}</div>
                        <div className="text-sm text-muted-foreground">{item.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="runtime" className="m-0">
              <div className="space-y-4">
                <div className="text-center py-8 text-muted-foreground">
                  {t("driverStore.runtimeComingSoon")}
                </div>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}