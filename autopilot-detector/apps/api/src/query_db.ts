import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== LATEST 5 SESSIONS ===");
  const sessions = await prisma.session.findMany({
    orderBy: { startedAt: 'desc' },
    take: 5,
    include: {
      scores: {
        orderBy: { timestamp: 'desc' },
        take: 1
      },
      interventions: {
        orderBy: { triggeredAt: 'desc' }
      }
    }
  });

  for (const s of sessions) {
    console.log(`\nSession ID: ${s.id}`);
    console.log(`Intent: ${s.declaredIntent} | App: ${s.appOpened}`);
    console.log(`Page: "${s.pageTitle}" (${s.pageCategory})`);
    console.log(`Latest Score: ${s.scores[0]?.score ?? 'None'}`);
    console.log(`Interventions (${s.interventions.length}):`);
    for (const i of s.interventions) {
      console.log(`  - [${i.type}] ${i.message} (Triggered at: ${i.triggeredAt})`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
