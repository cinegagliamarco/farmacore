import { Injectable, NotFoundException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EXCHANGE_NAME, allStepQueueNames } from '../../queue/constants';

export interface DlqMessage {
  routingKey: string;
  body: unknown;
  redelivered: boolean;
  headers: Record<string, unknown>;
}

/**
 * Peek/replay dead-lettered messages. Operates on real queue names
 * (`allStepQueueNames()` — v1 single-queue, v2 dispatch/batch, per-origin)
 * so every step's DLQ is reachable, not just the v1 ones.
 */
@Injectable()
export class DlqService {
  constructor(private readonly amqp: AmqpConnection) {}

  public listQueues(): string[] {
    return allStepQueueNames();
  }

  public async peek(queue: string, limit = 50): Promise<DlqMessage[]> {
    this.assertQueue(queue);
    const channel = this.amqp.channel;
    const out: DlqMessage[] = [];
    for (let i = 0; i < limit; i++) {
      const msg = await channel.get(`${queue}.dlq`, { noAck: false });
      if (!msg) break;
      out.push({
        routingKey: msg.fields.routingKey,
        body: JSON.parse(msg.content.toString()),
        redelivered: msg.fields.redelivered,
        headers: (msg.properties.headers as Record<string, unknown>) ?? {},
      });
      channel.nack(msg, false, true);
    }
    return out;
  }

  public async replay(queue: string, max = 100): Promise<{ replayed: number }> {
    this.assertQueue(queue);
    const channel = this.amqp.channel;
    let replayed = 0;
    for (let i = 0; i < max; i++) {
      const msg = await channel.get(`${queue}.dlq`, { noAck: false });
      if (!msg) break;
      const body = JSON.parse(msg.content.toString()) as Record<
        string,
        unknown
      >;
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
  }

  private assertQueue(queue: string): void {
    if (!allStepQueueNames().includes(queue))
      throw new NotFoundException(`Unknown queue ${queue}`);
  }
}
