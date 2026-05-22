import { Injectable, NotFoundException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EXCHANGE_NAME, STEP_QUEUES } from '../../queue/constants';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';

export interface DlqMessage {
  routingKey: string;
  body: unknown;
  redelivered: boolean;
  headers: Record<string, unknown>;
}

@Injectable()
export class DlqService {
  constructor(private readonly amqp: AmqpConnection) {}

  public async peek(step: PipelineStep, limit = 50): Promise<DlqMessage[]> {
    this.assertStep(step);
    const channel = this.amqp.channel;
    const out: DlqMessage[] = [];
    for (let i = 0; i < limit; i++) {
      const msg = await channel.get(`${step}.dlq`, { noAck: false });
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

  public async replay(
    step: PipelineStep,
    max = 100,
  ): Promise<{ replayed: number }> {
    this.assertStep(step);
    const channel = this.amqp.channel;
    let replayed = 0;
    for (let i = 0; i < max; i++) {
      const msg = await channel.get(`${step}.dlq`, { noAck: false });
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

  private assertStep(step: PipelineStep): void {
    if (!STEP_QUEUES.includes(step))
      throw new NotFoundException(`Unknown step ${step}`);
  }
}
