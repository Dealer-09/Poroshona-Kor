/**
 * Remove ALL synthetic training data created by seed-synthetic.ts.
 *
 * Synthetic users are tagged with the `@synthetic.autopilot.local` email domain.
 * Deleting them cascades to their Sessions → SessionEvents / AutopilotScores /
 * Interventions / SessionEmbeddings (FK onDelete: Cascade). MoodEntry has no
 * cascade from User/Session, so it is deleted explicitly first.
 *
 *   cd apps/api && node scripts/purge-synthetic.cjs
 */
require('dotenv/config');
const { Client } = require('pg');

const DOMAIN = '@synthetic.autopilot.local';

(async () => {
  const c = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });
  await c.connect();
  try {
    const ids = (
      await c.query(`SELECT id FROM "User" WHERE email LIKE $1`, [`%${DOMAIN}`])
    ).rows.map((r) => r.id);
    if (ids.length === 0) {
      console.log('No synthetic users found — nothing to purge.');
      return;
    }
    const n = async (sql) => (await c.query(sql, [ids])).rowCount;
    await c.query('BEGIN');
    const moods = await n(`DELETE FROM "MoodEntry" WHERE "userId" = ANY($1)`);
    // cascades AutopilotScore / Intervention / SessionEmbedding / SessionEvent
    const sessions = await n(`DELETE FROM "Session" WHERE "userId" = ANY($1)`);
    const users = await n(`DELETE FROM "User" WHERE id = ANY($1)`);
    await c.query('COMMIT');
    console.log(
      `Purged: ${users} synthetic users, ${sessions} sessions (+ cascaded events/scores/interventions/embeddings), ${moods} mood entries.`,
    );
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('PURGE FAILED:', e.message);
  process.exit(1);
});
