"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/react/components/ui/dialog";
import { Button } from "@/react/components/ui/button";
import { Input } from "@/react/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/react/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/react/components/ui/tabs";
import { Switch } from "@/react/components/ui/switch";
import { Label } from "@/react/components/ui/label";
import { DatabaseIcon } from "@/react/components/icons/DatabaseIcon";
import type { ConnectionConfig, DatabaseType } from "@/types/database";
import type { ConnectionDeepLinkDraft } from "@/lib/connectionDeepLink";
import { useConnectionStore } from "@/react/stores/connectionStore";
import { useToast } from "@/hooks/useToast";
import { uuid } from "@/lib/utils";
import * as api from "@/lib/api";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: ConnectionDeepLinkDraft | null;
  editConfig?: ConnectionConfig;
}

type DbOption = { value: string; label: string };
type DialogStep = "select" | "config";
type ConfigTab = "connection" | "advanced" | "tls" | "transport";

interface ConnectionForm {
  name: string;
  db_type: DatabaseType;
  driver_profile: string;
  driver_label: string;
  url_params: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
  color: string;
  transport_layers: any[];
  connect_timeout_secs: number;
  query_timeout_secs: number;
  idle_timeout_secs: number;
  keepalive_interval_secs: number;
  ssl: boolean;
  ca_cert_path: string;
  client_cert_path: string;
  client_key_path: string;
  sysdba: boolean;
  oracle_connection_type: "service_name" | "sid";
  connection_string?: string;
  jdbc_driver_class?: string;
  jdbc_driver_paths: string[];
  redis_connection_mode: "standalone" | "sentinel" | "cluster";
  redis_sentinel_master: string;
  redis_sentinel_nodes: string;
  redis_sentinel_username: string;
  redis_sentinel_password: string;
  redis_sentinel_tls: boolean;
  redis_cluster_nodes: string;
  redis_key_separator: string;
  etcd_endpoints: string;
  gbase_server: string;
  informix_server: string;
  external_config?: unknown;
  read_only: boolean;
  visible_databases?: string[];
}

const driverProfiles: Record<string, { type: DatabaseType; port: number; user: string; label: string }> = {
  mysql: { type: "mysql", port: 3306, user: "root", label: "MySQL" },
  postgres: { type: "postgres", port: 5432, user: "postgres", label: "PostgreSQL" },
  redis: { type: "redis", port: 6379, user: "", label: "Redis" },
  sqlite: { type: "sqlite", port: 0, user: "", label: "SQLite" },
  mongodb: { type: "mongodb", port: 27017, user: "", label: "MongoDB" },
  sqlserver: { type: "sqlserver", port: 1433, user: "sa", label: "SQL Server" },
  oracle: { type: "oracle", port: 1521, user: "system", label: "Oracle" },
  mariadb: { type: "mysql", port: 3306, user: "root", label: "MariaDB" },
  tidb: { type: "mysql", port: 4000, user: "root", label: "TiDB" },
  clickhouse: { type: "clickhouse", port: 8123, user: "default", label: "ClickHouse" },
  duckdb: { type: "duckdb", port: 0, user: "", label: "DuckDB" },
  postgres: { type: "postgres", port: 5432, user: "postgres", label: "PostgreSQL" },
};

const dbOptions: DbOption[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "mongodb", label: "MongoDB" },
  { value: "redis", label: "Redis" },
  { value: "oracle", label: "Oracle" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "mariadb", label: "MariaDB" },
  { value: "tidb", label: "TiDB" },
  { value: "clickhouse", label: "ClickHouse" },
  { value: "duckdb", label: "DuckDB" },
];

const colorOptions = [
  { value: "", class: "bg-transparent border-dashed", labelKey: "connection.colorNone" },
  { value: "#22c55e", class: "bg-green-500", labelKey: "connection.colorGreen" },
  { value: "#eab308", class: "bg-yellow-500", labelKey: "connection.colorYellow" },
  { value: "#f97316", class: "bg-orange-500", labelKey: "connection.colorOrange" },
  { value: "#ef4444", class: "bg-red-500", labelKey: "connection.colorRed" },
  { value: "#3b82f6", class: "bg-blue-500", labelKey: "connection.colorBlue" },
  { value: "#a855f7", class: "bg-purple-500", labelKey: "connection.colorPurple" },
];

function defaultForm(): ConnectionForm {
  return {
    name: "",
    db_type: "mysql",
    driver_profile: "mysql",
    driver_label: "MySQL",
    url_params: "",
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    password: "",
    database: undefined,
    color: "",
    transport_layers: [],
    connect_timeout_secs: 5,
    query_timeout_secs: 30,
    idle_timeout_secs: 60,
    keepalive_interval_secs: 0,
    ssl: false,
    ca_cert_path: "",
    client_cert_path: "",
    client_key_path: "",
    sysdba: false,
    oracle_connection_type: "service_name",
    connection_string: undefined,
    jdbc_driver_class: undefined,
    jdbc_driver_paths: [],
    redis_connection_mode: "standalone",
    redis_sentinel_master: "",
    redis_sentinel_nodes: "",
    redis_sentinel_username: "",
    redis_sentinel_password: "",
    redis_sentinel_tls: false,
    redis_cluster_nodes: "",
    redis_key_separator: ":",
    etcd_endpoints: "",
    gbase_server: "",
    informix_server: "",
    external_config: undefined,
    read_only: false,
    visible_databases: undefined,
  };
}

export function ConnectionDialog({
  open,
  onOpenChange,
  prefill,
  editConfig,
}: ConnectionDialogProps) {
  const { t } = useTranslation();
  const connectionStore = useConnectionStore();
  const { toast } = useToast();

  const [dialogStep, setDialogStep] = useState<DialogStep>("select");
  const [configTab, setConfigTab] = useState<ConfigTab>("connection");
  const [selectedType, setSelectedType] = useState("mysql");
  const [form, setForm] = useState<ConnectionForm>(defaultForm());
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Load edit config when provided
  useEffect(() => {
    if (editConfig) {
      setEditingId(editConfig.id);
      setForm({
        name: editConfig.name,
        db_type: editConfig.db_type,
        driver_profile: editConfig.driver_profile || editConfig.db_type,
        driver_label: editConfig.driver_label || editConfig.db_type,
        url_params: editConfig.url_params || "",
        host: editConfig.host,
        port: editConfig.port,
        username: editConfig.username,
        password: editConfig.password,
        database: editConfig.database,
        color: editConfig.color || "",
        transport_layers: editConfig.transport_layers || [],
        connect_timeout_secs: editConfig.connect_timeout_secs || 5,
        query_timeout_secs: editConfig.query_timeout_secs ?? 30,
        idle_timeout_secs: editConfig.idle_timeout_secs ?? 60,
        keepalive_interval_secs: editConfig.keepalive_interval_secs ?? 0,
        ssl: editConfig.ssl || false,
        ca_cert_path: editConfig.ca_cert_path || "",
        client_cert_path: editConfig.client_cert_path || "",
        client_key_path: editConfig.client_key_path || "",
        sysdba: editConfig.sysdba || false,
        oracle_connection_type: editConfig.oracle_connection_type || "service_name",
        connection_string: editConfig.connection_string,
        jdbc_driver_class: editConfig.jdbc_driver_class,
        jdbc_driver_paths: editConfig.jdbc_driver_paths || [],
        redis_connection_mode: (editConfig as any).redis_connection_mode || "standalone",
        redis_sentinel_master: (editConfig as any).redis_sentinel_master || "",
        redis_sentinel_nodes: (editConfig as any).redis_sentinel_nodes || "",
        redis_sentinel_username: (editConfig as any).redis_sentinel_username || "",
        redis_sentinel_password: (editConfig as any).redis_sentinel_password || "",
        redis_sentinel_tls: (editConfig as any).redis_sentinel_tls || false,
        redis_cluster_nodes: (editConfig as any).redis_cluster_nodes || "",
        redis_key_separator: (editConfig as any).redis_key_separator ?? ":",
        etcd_endpoints: (editConfig as any).etcd_endpoints || "",
        gbase_server: (editConfig as any).gbase_server || "",
        informix_server: (editConfig as any).informix_server || "",
        external_config: editConfig.external_config,
        read_only: editConfig.read_only || false,
        visible_databases: editConfig.visible_databases,
      });
      setSelectedType(editConfig.driver_profile || editConfig.db_type);
      setDialogStep("config");
    } else {
      setEditingId(null);
      setForm(defaultForm());
      setSelectedType("mysql");
      setDialogStep("select");
    }
  }, [editConfig, open]);

  // Handle prefill from deep link
  useEffect(() => {
    if (prefill && open) {
      const profile = driverProfiles[prefill.driverProfile] || driverProfiles.mysql;
      setForm((prev) => ({
        ...prev,
        name: prefill.name || "",
        db_type: prefill.dbType,
        driver_profile: prefill.driverProfile,
        driver_label: prefill.driverLabel || profile.label,
        host: prefill.host || prev.host,
        port: prefill.port || profile.port,
        username: prefill.username || prev.username,
        password: prefill.password || prev.password,
        database: prefill.database,
        url_params: prefill.urlParams || "",
        ssl: prefill.ssl || false,
        connection_string: prefill.connectionString,
      }));
      setSelectedType(prefill.driverProfile);
      setDialogStep("config");
    }
  }, [prefill, open]);

  function applyProfile(type: string) {
    const profile = driverProfiles[type];
    if (!profile) return;

    setSelectedType(type);
    setForm((prev) => ({
      ...prev,
      db_type: profile.type,
      driver_profile: type,
      driver_label: profile.label,
      port: profile.port,
      username: profile.user,
      host: type === "sqlite" || type === "duckdb" ? "" : prev.host,
    }));
  }

  function handleDbSelect(value: string) {
    applyProfile(value);
    setDialogStep("config");
    setConfigTab("connection");
  }

  async function testConnection() {
    setIsTesting(true);
    setTestResult(null);
    try {
      const config = buildConnectionConfig();
      const msg = await api.testConnection(config);
      setTestResult({ ok: true, message: msg });
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || String(e) });
    } finally {
      setIsTesting(false);
    }
  }

  function buildConnectionConfig(): ConnectionConfig {
    return {
      id: editingId || uuid(),
      name: form.name || `${form.driver_label}_${Math.random().toString(36).slice(2, 6)}`,
      db_type: form.db_type,
      driver_profile: form.driver_profile,
      driver_label: form.driver_label,
      url_params: form.url_params,
      host: form.host,
      port: form.port,
      username: form.username,
      password: form.password,
      database: form.database,
      color: form.color || undefined,
      transport_layers: form.transport_layers,
      connect_timeout_secs: form.connect_timeout_secs,
      query_timeout_secs: form.query_timeout_secs,
      idle_timeout_secs: form.idle_timeout_secs,
      keepalive_interval_secs: form.keepalive_interval_secs,
      ssl: form.ssl || undefined,
      ca_cert_path: form.ca_cert_path || undefined,
      client_cert_path: form.client_cert_path || undefined,
      client_key_path: form.client_key_path || undefined,
      sysdba: form.sysdba || undefined,
      oracle_connection_type: form.db_type === "oracle" ? form.oracle_connection_type : undefined,
      connection_string: form.connection_string,
      jdbc_driver_class: form.jdbc_driver_class,
      jdbc_driver_paths: form.jdbc_driver_paths,
      redis_connection_mode: form.db_type === "redis" ? form.redis_connection_mode : undefined,
      redis_sentinel_master: form.db_type === "redis" ? form.redis_sentinel_master : undefined,
      redis_sentinel_nodes: form.db_type === "redis" ? form.redis_sentinel_nodes : undefined,
      redis_sentinel_username: form.db_type === "redis" ? form.redis_sentinel_username : undefined,
      redis_sentinel_password: form.db_type === "redis" ? form.redis_sentinel_password : undefined,
      redis_sentinel_tls: form.db_type === "redis" ? form.redis_sentinel_tls : undefined,
      redis_cluster_nodes: form.db_type === "redis" ? form.redis_cluster_nodes : undefined,
      redis_key_separator: form.db_type === "redis" ? form.redis_key_separator : undefined,
      etcd_endpoints: form.db_type === "etcd" ? form.etcd_endpoints : undefined,
      read_only: form.read_only || undefined,
      visible_databases: form.visible_databases,
    };
  }

  async function save() {
    setIsSaving(true);
    try {
      const config = buildConnectionConfig();
      if (editingId) {
        await connectionStore.updateConnection(config);
        toast(t("connection.saved"), 2000);
      } else {
        await connectionStore.addConnection(config);
        toast(t("connection.added"), 2000);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast(t("connection.saveFailed", { message: e?.message || String(e) }), 5000);
    } finally {
      setIsSaving(false);
    }
  }

  const isJdbcConnection = form.db_type === "jdbc";
  const isH2Connection = form.db_type === "h2";
  const supportsTls = ["mysql", "postgres", "redis", "clickhouse"].includes(form.db_type);
  const showDatabaseField = !["sqlite", "duckdb", "access"].includes(form.db_type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingId ? t("connection.editConnection") : t("connection.newConnection")}
          </DialogTitle>
        </DialogHeader>

        {dialogStep === "select" ? (
          /* Database Selection Step */
          <div className="grid grid-cols-4 gap-3 py-4">
            {dbOptions.map((option) => (
              <button
                key={option.value}
                className="flex flex-col items-center gap-2 rounded-lg border p-3 hover:bg-accent hover:border-primary transition-colors"
                onClick={() => handleDbSelect(option.value)}
              >
                <DatabaseIcon dbType={option.value} className="h-8 w-8" />
                <span className="text-xs">{option.label}</span>
              </button>
            ))}
          </div>
        ) : (
          /* Configuration Step */
          <Tabs value={configTab} onValueChange={(v) => setConfigTab(v as ConfigTab)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="connection">{t("connection.tabConnection")}</TabsTrigger>
              <TabsTrigger value="advanced">{t("connection.tabAdvanced")}</TabsTrigger>
              <TabsTrigger value="tls">{t("connection.tabTls")}</TabsTrigger>
              <TabsTrigger value="transport">{t("connection.tabTransport")}</TabsTrigger>
            </TabsList>

            {/* Connection Tab */}
            <TabsContent value="connection" className="space-y-4">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name">{t("connection.name")}</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("connection.namePlaceholder")}
                />
              </div>

              {/* Type Display */}
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <DatabaseIcon dbType={selectedType} className="h-8 w-8" />
                <div>
                  <div className="font-medium">{form.driver_label}</div>
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setDialogStep("select")}
                  >
                    {t("connection.changeType")}
                  </button>
                </div>
              </div>

              {/* Host & Port */}
              {!["sqlite", "duckdb", "access"].includes(form.db_type) && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="host">{t("connection.host")}</Label>
                    <Input
                      id="host"
                      value={form.host}
                      onChange={(e) => setForm({ ...form, host: e.target.value })}
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="port">{t("connection.port")}</Label>
                    <Input
                      id="port"
                      type="number"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              )}

              {/* SQLite/DuckDB File Path */}
              {["sqlite", "duckdb", "access"].includes(form.db_type) && (
                <div className="space-y-2">
                  <Label htmlFor="database">{t("connection.databaseFile")}</Label>
                  <Input
                    id="database"
                    value={form.database || ""}
                    onChange={(e) => setForm({ ...form, database: e.target.value })}
                    placeholder="/path/to/database.db"
                  />
                </div>
              )}

              {/* Username & Password */}
              {form.db_type !== "sqlite" && form.db_type !== "duckdb" && form.db_type !== "access" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">{t("connection.username")}</Label>
                    <Input
                      id="username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">{t("connection.password")}</Label>
                    <Input
                      id="password"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Database */}
              {showDatabaseField && (
                <div className="space-y-2">
                  <Label htmlFor="database">
                    {form.db_type === "oracle" ? t("connection.serviceName") : t("connection.database")}
                  </Label>
                  <Input
                    id="database"
                    value={form.database || ""}
                    onChange={(e) => setForm({ ...form, database: e.target.value })}
                  />
                </div>
              )}

              {/* Connection String (for MongoDB, etc.) */}
              {form.db_type === "mongodb" && (
                <div className="space-y-2">
                  <Label htmlFor="connection_string">{t("connection.connectionString")}</Label>
                  <Input
                    id="connection_string"
                    value={form.connection_string || ""}
                    onChange={(e) => setForm({ ...form, connection_string: e.target.value })}
                    placeholder="mongodb://user:password@host:port/database"
                  />
                </div>
              )}

              {/* Color */}
              <div className="space-y-2">
                <Label>{t("connection.color")}</Label>
                <div className="flex items-center gap-2">
                  {colorOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`h-6 w-6 rounded-full border-2 ${option.class} ${
                        form.color === option.value ? "border-foreground" : "border-transparent"
                      }`}
                      onClick={() => setForm({ ...form, color: option.value })}
                      title={t(option.labelKey)}
                    />
                  ))}
                  <Input
                    className="w-20 h-6"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    placeholder="#000"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Advanced Tab */}
            <TabsContent value="advanced" className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="connect_timeout">{t("connection.connectTimeout")}</Label>
                  <Input
                    id="connect_timeout"
                    type="number"
                    value={form.connect_timeout_secs}
                    onChange={(e) => setForm({ ...form, connect_timeout_secs: parseInt(e.target.value) || 5 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="query_timeout">{t("connection.queryTimeout")}</Label>
                  <Input
                    id="query_timeout"
                    type="number"
                    value={form.query_timeout_secs}
                    onChange={(e) => setForm({ ...form, query_timeout_secs: parseInt(e.target.value) || 30 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="idle_timeout">{t("connection.idleTimeout")}</Label>
                  <Input
                    id="idle_timeout"
                    type="number"
                    value={form.idle_timeout_secs}
                    onChange={(e) => setForm({ ...form, idle_timeout_secs: parseInt(e.target.value) || 60 })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="url_params">{t("connection.urlParams")}</Label>
                <Input
                  id="url_params"
                  value={form.url_params}
                  onChange={(e) => setForm({ ...form, url_params: e.target.value })}
                  placeholder="key=value&key2=value2"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="read_only"
                  checked={form.read_only}
                  onCheckedChange={(checked) => setForm({ ...form, read_only: checked })}
                />
                <Label htmlFor="read_only">{t("connection.readOnly")}</Label>
              </div>
            </TabsContent>

            {/* TLS Tab */}
            <TabsContent value="tls" className="space-y-4">
              {supportsTls ? (
                <>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="ssl"
                      checked={form.ssl}
                      onCheckedChange={(checked) => setForm({ ...form, ssl: checked })}
                    />
                    <Label htmlFor="ssl">{t("connection.useSSL")}</Label>
                  </div>

                  {form.ssl && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="ca_cert">{t("connection.caCertPath")}</Label>
                        <Input
                          id="ca_cert"
                          value={form.ca_cert_path}
                          onChange={(e) => setForm({ ...form, ca_cert_path: e.target.value })}
                          placeholder="/path/to/ca.pem"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="client_cert">{t("connection.clientCertPath")}</Label>
                          <Input
                            id="client_cert"
                            value={form.client_cert_path}
                            onChange={(e) => setForm({ ...form, client_cert_path: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="client_key">{t("connection.clientKeyPath")}</Label>
                          <Input
                            id="client_key"
                            value={form.client_key_path}
                            onChange={(e) => setForm({ ...form, client_key_path: e.target.value })}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("connection.tlsNotSupported", { type: form.db_type })}
                </p>
              )}
            </TabsContent>

            {/* Transport Tab */}
            <TabsContent value="transport" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("connection.transportLayerInfo")}
              </p>
              {/* SSH Tunnel and Proxy configuration would go here */}
              <p className="text-xs text-muted-foreground">
                {t("connection.transportNotImplemented")}
              </p>
            </TabsContent>
          </Tabs>
        )}

        {/* Test Result */}
        {testResult && (
          <div
            className={`rounded-lg p-3 text-sm ${
              testResult.ok ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"
            }`}
          >
            {testResult.ok ? t("connection.testSuccess") : testResult.message}
          </div>
        )}

        <DialogFooter>
          {dialogStep === "config" && (
            <Button
              variant="outline"
              onClick={() => setDialogStep("select")}
            >
              {t("dangerDialog.cancel")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={testConnection}
            disabled={isTesting}
          >
            {isTesting ? t("common.loading") : t("connection.test")}
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving ? t("common.loading") : t("connection.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
