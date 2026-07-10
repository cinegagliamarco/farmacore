import 'dotenv/config';
import { connect } from 'amqplib';
import { allStepQueueNames } from '../src/queue/constants';

// One-off deploy step for releases that change queue ARGUMENTS (e.g. the
// DLX wiring fix): RabbitMQ queue args are immutable, so redeclaring an
// existing queue with different args fails with PRECONDITION_FAILED and
// consumers never attach. This deletes the main queues (empty ones only,
// unless --force) so the worker redeclares them with the new args on its
// next boot. `.dlq` queues keep their args and may hold messages — left
// untouched. Uses raw amqplib on purpose: booting the Nest app would
// redeclare the queues before we could delete them.
//
// ORDER MATTERS: stop the worker FIRST, then run this, then deploy the
// new worker. While a main queue is deleted, a publish to the topic
// exchange is unroutable but still confirmed — the outbox would mark the
// row published and the message is gone (run stalls, nothing to replay).
// Stopping the worker also stops the outbox publisher, so rows just
// accumulate and drain after the restart.
//
// Usage: npm run queues:recreate [-- --force]
async function main(): Promise<void> {
  const url = process.env.AMQP_URL;
  if (!url) throw new Error('AMQP_URL must be set');
  const force = process.argv.includes('--force');

  const conn = await connect(url);
  let deleted = 0;
  let skipped = 0;
  for (const q of allStepQueueNames()) {
    // Channel per queue: a refused delete (non-empty without --force)
    // closes the channel it ran on.
    const ch = await conn.createChannel();
    ch.on('error', () => undefined);
    try {
      const res = await ch.deleteQueue(q, { ifEmpty: !force });
      console.log(`deleted ${q} (${res.messageCount} message(s))`);
      deleted++;
      await ch.close();
    } catch {
      console.warn(
        `skipped ${q}: not empty — rerun with --force to drop its messages`,
      );
      skipped++;
    }
  }
  await conn.close();
  console.log(
    `${deleted} deleted, ${skipped} skipped. Restart the worker to redeclare the new topology.`,
  );
  if (skipped > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
