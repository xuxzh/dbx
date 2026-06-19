import { Database } from "lucide-react";

interface DatabaseIconProps {
  dbType: string;
  className?: string;
}

const assetIcons: Record<string, string> = {
  mysql: "mysql",
  postgres: "postgres",
  postgresql: "postgres",
  sqlite: "sqlite",
  rqlite: "rqlite.png",
  turso: "turso.png",
  redis: "redis",
  mongodb: "mongodb",
  mongodb_legacy: "mongodb",
  clickhouse: "clickhouse",
  duckdb: "duckdb",
  mariadb: "mariadb",
  tidb: "tidb",
  elasticsearch: "elasticsearch",
  oracle: "oracle",
  "oracle-10g": "oracle",
  "oracle-legacy": "oracle",
  oracle_10g: "oracle",
  oracle_legacy: "oracle",
  sqlserver: "sqlserver",
  access: "access.png",
  oceanbase: "oceanbase",
  opengauss: "opengauss",
  gaussdb: "gaussdb",
  questdb: "questdb",
  kwdb: "kwdb",
  kingbase: "kingbase",
  highgo: "highgo.png",
  goldendb: "goldendb.png",
  databend: "databend",
  vastbase: "vastbase.png",
  yashandb: "yashandb.png",
  snowflake: "snowflake",
  h2: "h2",
  dm: "dm",
  dameng: "dm",
  presto: "presto",
  hive: "hive",
  apache_kylin: "apache_kylin",
  sundb: "sundb",
  trino: "presto",
  kylin: "apache_kylin",
  cockroachdb: "cockroachdb",
  db2: "db2",
  bigquery: "bigquery",
  cassandra: "cassandra",
  doris: "doris",
  manticoresearch: "manticoresearch.png",
  selectdb: "selectdb",
  tdengine: "tdengine",
  starrocks: "starrocks",
  redshift: "redshift",
  neo4j: "neo4j",
  informix: "informix",
  databricks: "databricks.webp",
  saphana: "saphana.webp",
  teradata: "teradata.webp",
  vertica: "vertica.webp",
  firebird: "firebird.webp",
  exasol: "exasol.webp",
  gbase: "gbase.webp",
  gbase8a: "gbase.webp",
  gbase8s: "gbase.webp",
  tdsql: "tdsql.webp",
  polardb: "polardb.webp",
  greatsql: "greatsql.webp",
  xugu: "xugu.png",
  iotdb: "iotdb",
  etcd: "etcd",
  mq: "pulsar",
  pulsar: "pulsar",
  iris: "iris.png",
  influxdb: "influxdb",
};

const letterIcons: Record<string, { letter: string; color: string }> = {};

export function DatabaseIcon({ dbType, className }: DatabaseIconProps) {
  const normalizedType = dbType.toLowerCase().replace(/[\s-]+/g, "_");
  const assetName = assetIcons[normalizedType];
  const letter = letterIcons[normalizedType];

  if (assetName) {
    const assetSrc = assetName.includes(".")
      ? `/icons/database/${assetName}`
      : `/icons/database/${assetName}.svg`;
    return (
      <img
        src={assetSrc}
        alt=""
        className={`database-logo object-contain ${className || ""}`}
        aria-hidden="true"
      />
    );
  }

  if (letter) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className={className}
      >
        <circle cx="12" cy="12" r="12" fill={letter.color} />
        <text
          x="12"
          y="16.5"
          textAnchor="middle"
          fill="white"
          fontSize="14"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          {letter.letter}
        </text>
      </svg>
    );
  }

  return <Database className={className || "text-blue-400"} />;
}
