import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { Channel, ChannelModel, GetMessage } from 'amqplib';
import { EXCHANGE_NAME, allStepQueueNames } from '../../queue/constants';

export interface DlqMessage {
  routingKey: string;
  body: unknown;
  redelivered: boolean;
  headers: Record<string, unknown>;
}

const MAX_MESSAGES = 200;

/** Parsed JSON body, or the raw string when a (foreign/corrupt) message
 *  isn't JSON — diagnostics must never crash on payload shape. */
function parseBody(msg: GetMessage): Record<string, unknown> | string {
  const raw = msg.content.toString();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
}

/**
 * Peek/replay dead-lettered messages. Operates on real queue names
 * (`allStepQueueNames()` — v1 single-queue, v2 dispatch/batch, per-origin)
 * so every step's DLQ is reachable, not just the v1 ones.
 *
 * Each operation opens its own channel: on the shared publish channel a
 * concurrent peek/replay pair would have its unacked deliveries swept by
 * peek's nack(allUpTo) and the following ack on a requeued tag would
 * close the channel (PRECONDITION_FAILED), breaking publishes until
 * reconnect.
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(private readonly amqp: AmqpConnection) {}

  public listQueues(): string[] {
    return allStepQueueNames();
  }

  // golevelup types `connection` as amqplib's bare Connection, but at
  // runtime it hands out the ChannelModel that amqp-connection-manager
  // emits — the object that owns createChannel().
  private createChannel(): Promise<Channel> {
    return (this.amqp.connection as unknown as ChannelModel).createChannel();
  }

  public async peek(queue: string, limit = 50): Promise<DlqMessage[]> {
    this.assertQueue(queue);
    const cap = Math.min(limit, MAX_MESSAGES);
    const channel = await this.createChannel();
    try {
      const msgs: GetMessage[] = [];
      while (msgs.length < cap) {
        const msg = await channel.get(`${queue}.dlq`, { noAck: false });
        if (!msg) break;
        msgs.push(msg);
      }
      // Nacking inside the loop requeues to the head of the queue, so the next
      // get() would fetch the same message again. Hold everything unacked and
      // requeue in one shot (allUpTo) after the scan.
      if (msgs.length > 0) channel.nack(msgs[msgs.length - 1], true, true);
      return msgs.map((msg) => ({
        routingKey: msg.fields.routingKey,
        body: parseBody(msg),
        redelivered: msg.fields.redelivered,
        headers: (msg.properties.headers as Record<string, unknown>) ?? {},
      }));
    } finally {
      // The channel may already be errored/closed; a throwing close would
      // mask the real failure.
      await channel.close().catch(() => undefined);
    }
  }

  public async replay(queue: string, max = 100): Promise<{ replayed: number }> {
    this.assertQueue(queue);
    const cap = Math.min(max, MAX_MESSAGES);
    const channel = await this.createChannel();
    try {
      let replayed = 0;
      for (let i = 0; i < cap; i++) {
        const msg = await channel.get(`${queue}.dlq`, { noAck: false });
        if (!msg) break;
        const body = parseBody(msg);
        if (typeof body === 'string') {
          // Non-JSON message at the head: requeue it and stop instead of
          // erroring out unacked (which would close the channel and brick
          // every subsequent replay on the same message).
          this.logger.warn(
            `replay(${queue}) stopped: non-JSON message at DLQ head (routingKey=${msg.fields.routingKey})`,
          );
          channel.nack(msg, false, true);
          break;
        }
        const replayedBody = { ...body, attempt: 1 };
        await this.amqp.publish(
          EXCHANGE_NAME,
          msg.fields.routingKey,
          replayedBody,
          {
            persistent: true,
          },
        );
        channel.ack(msg);
        replayed++;
      }
      return { replayed };
    } finally {
      await channel.close().catch(() => undefined);
    }
  }

  private assertQueue(queue: string): void {
    if (!allStepQueueNames().includes(queue))
      throw new NotFoundException(`Unknown queue ${queue}`);
  }
}
