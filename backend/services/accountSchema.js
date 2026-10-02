function migrateAccounts(db) {
  db.transaction(() => {
    for (const [table, additions] of Object.entries({
      users: {auth_version:"INTEGER NOT NULL DEFAULT 0",avatar_data:"TEXT",last_seen_at:"INTEGER"},
      feedback: {additional_comment:"TEXT NOT NULL DEFAULT ''"}
    })) {
      const columns = new Set(db.prepare("PRAGMA table_info("+table+")").all().map(row=>row.name));
      for (const [name,type] of Object.entries(additions)) {
        if (!columns.has(name)) db.exec("ALTER TABLE "+table+" ADD COLUMN "+name+" "+type);
      }
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL,used_at INTEGER,issued_by INTEGER REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS request_limits (
        bucket TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_audit (
        id INTEGER PRIMARY KEY,actor_id INTEGER REFERENCES users(id),
        subject_id INTEGER REFERENCES users(id),action TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS orders_completed_report ON orders(status,completed_at);
      CREATE INDEX IF NOT EXISTS orders_user_report ON orders(user_id,created_at);
    `);
  })();
}
module.exports={migrateAccounts};
