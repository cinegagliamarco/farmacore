import dataSource from '../src/database/data-source';

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const result = await dataSource.runMigrations({ transaction: 'each' });
    console.log(`Applied ${result.length} migration(s):`);
    for (const m of result) console.log('  -', m.name);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
