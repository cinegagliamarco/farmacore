import { Logger, NotFoundException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DlqService } from './dlq.service';
import { EXCHANGE_NAME, MIGRATE_TENANT_QUEUE } from '../../queue/constants';

const buildMsg = (body: unknown, deliveryTag: number) => ({
  fields: {
    routingKey: 'acme.migrate-tenant',
    redelivered: false,
    deliveryTag,
  },
  properties: { headers: { 'x-first-death-queue': 'q' } },
  content: Buffer.from(JSON.stringify(body)),
});

describe('DlqService', () => {
  let channel: {
    get: jest.Mock;
    nack: jest.Mock;
    ack: jest.Mock;
    close: jest.Mock;
  };
  let amqp: { publish: jest.Mock; connection: { createChannel: jest.Mock } };
  let service: DlqService;

  beforeEach(() => {
    channel = {
      get: jest.fn().mockResolvedValue(false),
      nack: jest.fn(),
      ack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    amqp = {
      publish: jest.fn().mockResolvedValue(undefined),
      connection: { createChannel: jest.fn().mockResolvedValue(channel) },
    };
    service = new DlqService(amqp as unknown as AmqpConnection);
  });

  it('peek fetches up to limit on a dedicated channel, nacks ONCE with (last, allUpTo, requeue) and parses bodies', async () => {
    const m1 = buildMsg({ pipelineRunId: 'r1' }, 1);
    const m2 = buildMsg({ pipelineRunId: 'r2' }, 2);
    channel.get.mockResolvedValueOnce(m1).mockResolvedValueOnce(m2);

    const out = await service.peek(MIGRATE_TENANT_QUEUE, 2);

    // Dedicated channel per operation, closed at the end — never the
    // shared publish channel.
    expect(amqp.connection.createChannel).toHaveBeenCalledTimes(1);
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(channel.get).toHaveBeenCalledTimes(2);
    expect(channel.get).toHaveBeenCalledWith(`${MIGRATE_TENANT_QUEUE}.dlq`, {
      noAck: false,
    });
    // One shot: nacking per message would requeue to the head and loop.
    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(m2, true, true);
    expect(out).toEqual([
      {
        routingKey: 'acme.migrate-tenant',
        body: { pipelineRunId: 'r1' },
        redelivered: false,
        headers: { 'x-first-death-queue': 'q' },
      },
      {
        routingKey: 'acme.migrate-tenant',
        body: { pipelineRunId: 'r2' },
        redelivered: false,
        headers: { 'x-first-death-queue': 'q' },
      },
    ]);
  });

  it('peek stops when the queue drains mid-scan', async () => {
    const m1 = buildMsg({ pipelineRunId: 'r1' }, 1);
    channel.get.mockResolvedValueOnce(m1); // next get -> false
    const out = await service.peek(MIGRATE_TENANT_QUEUE, 50);
    expect(out).toHaveLength(1);
    expect(channel.nack).toHaveBeenCalledWith(m1, true, true);
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it('peek caps the limit at 200', async () => {
    channel.get.mockResolvedValue(buildMsg({ pipelineRunId: 'r' }, 1));
    const out = await service.peek(MIGRATE_TENANT_QUEUE, 10_000);
    expect(out).toHaveLength(200);
    expect(channel.get).toHaveBeenCalledTimes(200);
  });

  it('replay acks each message and republishes with attempt reset to 1', async () => {
    const m1 = buildMsg({ pipelineRunId: 'r1', attempt: 3 }, 1);
    const m2 = buildMsg({ pipelineRunId: 'r2', attempt: 5 }, 2);
    channel.get.mockResolvedValueOnce(m1).mockResolvedValueOnce(m2);

    const out = await service.replay(MIGRATE_TENANT_QUEUE);

    expect(out).toEqual({ replayed: 2 });
    expect(amqp.publish).toHaveBeenCalledWith(
      EXCHANGE_NAME,
      'acme.migrate-tenant',
      { pipelineRunId: 'r1', attempt: 1 },
      { persistent: true },
    );
    expect(channel.ack).toHaveBeenCalledTimes(2);
    expect(channel.ack).toHaveBeenCalledWith(m1);
    expect(channel.ack).toHaveBeenCalledWith(m2);
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it('replay stops at a non-JSON message: requeues it, keeps earlier replays', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const m1 = buildMsg({ pipelineRunId: 'r1', attempt: 3 }, 1);
    const m2 = { ...buildMsg({}, 2), content: Buffer.from('not-json') };
    channel.get.mockResolvedValueOnce(m1).mockResolvedValueOnce(m2);

    const out = await service.replay(MIGRATE_TENANT_QUEUE);

    expect(out).toEqual({ replayed: 1 });
    // The poison message goes back to the head unacked-requeued — erroring
    // out instead would close the channel and brick every later replay.
    expect(channel.nack).toHaveBeenCalledWith(m2, false, true);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(m1);
    expect(amqp.publish).toHaveBeenCalledTimes(1);
    expect(channel.close).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('rejects unknown queues before touching the broker', async () => {
    await expect(service.peek('not-a-queue')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(amqp.connection.createChannel).not.toHaveBeenCalled();
  });
});
