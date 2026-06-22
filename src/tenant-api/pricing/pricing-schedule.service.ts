import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  PricingScheduleEntity,
  ScheduleItem,
} from '../../database/entities/tenant/pricing-schedule.entity';
import { CreateScheduleDto } from './dto/schedule.dto';

export interface ScheduleView {
  id: string;
  runAt: string;
  status: string;
  applyRunId: string | null;
  itemCount: number;
  createdAt: string;
}

export interface DueSchedule {
  id: string;
  requestedBy: string | null;
  items: ScheduleItem[];
}

interface ScheduleRow {
  id: string;
  runAt: Date;
  status: string;
  applyRunId: string | null;
  items: ScheduleItem[];
  createdAt: Date;
}

const toView = (r: ScheduleRow): ScheduleView => ({
  id: r.id,
  runAt: new Date(r.runAt).toISOString(),
  status: r.status,
  applyRunId: r.applyRunId,
  itemCount: Array.isArray(r.items) ? r.items.length : 0,
  createdAt: new Date(r.createdAt).toISOString(),
});

/**
 * CRUD dos agendamentos de aplicação (one-shot). `claimDue`/`markFired` são o
 * caminho do cron — separados do apply para o service não depender dele.
 */
@Injectable()
export class PricingScheduleService {
  public async create(
    em: EntityManager,
    requestedBy: string,
    dto: CreateScheduleDto,
  ): Promise<ScheduleView> {
    const [row]: ScheduleRow[] = await em.query(
      `INSERT INTO pricing_schedule (run_at, requested_by, items)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, run_at AS "runAt", status,
                 apply_run_id AS "applyRunId", items, created_at AS "createdAt"`,
      [dto.runAt, requestedBy, JSON.stringify(dto.items)],
    );
    return toView(row);
  }

  public async list(em: EntityManager): Promise<ScheduleView[]> {
    const rows: ScheduleRow[] = await em.query(
      `SELECT id, run_at AS "runAt", status, apply_run_id AS "applyRunId",
              items, created_at AS "createdAt"
         FROM pricing_schedule
        WHERE deleted_at IS NULL
        ORDER BY run_at DESC`,
    );
    return rows.map(toView);
  }

  public async get(em: EntityManager, id: string): Promise<ScheduleView> {
    const rows: ScheduleRow[] = await em.query(
      `SELECT id, run_at AS "runAt", status, apply_run_id AS "applyRunId",
              items, created_at AS "createdAt"
         FROM pricing_schedule WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`schedule ${id} not found`);
    return toView(rows[0]);
  }

  public async cancel(
    em: EntityManager,
    id: string,
  ): Promise<{ id: string; cancelled: boolean }> {
    // Guard atômico de status: se o cron já travou + disparou (FOR UPDATE SKIP
    // LOCKED), este UPDATE espera o lock e então afeta 0 linhas (status='fired')
    // — não sobrescreve um agendamento já disparado para 'cancelled'. Usa o
    // repositório (`.affected`) em vez de UPDATE..RETURNING (que com em.query
    // volta [rows, count] e confundiria a contagem).
    const res = await em
      .getRepository(PricingScheduleEntity)
      .update({ id, status: 'pending' }, { status: 'cancelled' });
    if (res.affected) return { id, cancelled: true };
    const current = await this.get(em, id); // 404 se não existir
    throw new ConflictException(
      `schedule ${id} is ${current.status} and cannot be cancelled`,
    );
  }

  /** Agendamentos vencidos e ainda pendentes, travados (SKIP LOCKED) para esta
   *  transação — só uma réplica de API pega cada um. */
  public async claimDue(em: EntityManager): Promise<DueSchedule[]> {
    return em.query(
      `SELECT id, requested_by AS "requestedBy", items
         FROM pricing_schedule
        WHERE status = 'pending' AND deleted_at IS NULL AND run_at <= now()
        ORDER BY run_at ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED`,
    );
  }

  public async markFired(
    em: EntityManager,
    id: string,
    applyRunId: string,
  ): Promise<void> {
    await em.query(
      `UPDATE pricing_schedule
          SET status='fired', apply_run_id=$2, fired_at=now(), updated_at=now()
        WHERE id=$1`,
      [id, applyRunId],
    );
  }
}
