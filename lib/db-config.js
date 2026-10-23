// pg connection-string SSL flags otherwise replace the explicit TLS configuration.
// Always validate the server certificate, including URLs injected by integrations.
export function databaseConfig(env = process.env) {
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw Error("DATABASE_URL ausente ou inválida.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw Error("DATABASE_URL deve apontar para PostgreSQL.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (env.PGSSL === "disable" && !local)
    throw Error("PGSSL=disable é permitido somente em PostgreSQL local.");
  for (const key of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: env.PGSSL === "disable" ? false : { rejectUnauthorized: true },
    enableChannelBinding: true,
    connectionTimeoutMillis: 10000,
  };
}
